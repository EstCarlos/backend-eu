import {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ddb, TABLE_NAME } from '../shared/ddb';
import { isNonEmptyString, json, parseBody } from '../shared/http';
import { getAuthEmail, itemToReserva } from '../shared/admin';
import { EstadoReserva, Pago } from '../shared/types';

type UpdateBody = {
  estado?: EstadoReserva;
  notas?: string;
  pago?: {
    monto?: number;
    metodo?: string;
    nota?: string;
  };
};

const ESTADOS: EstadoReserva[] = ['nueva', 'contactada', 'link_enviado', 'pagada_completa'];

// Topes de sanidad: evitan que un typo o un pegote accidental engorde el item
// o deje el saldo negativo (que la UI mostraría como "Saldado").
const MAX_NOTAS = 2000;
const MAX_METODO = 100;
const MAX_NOTA_PAGO = 500;

/** Redondeo a céntimos para evitar arrastre de coma flotante en importes USD. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * PATCH /admin/reservas/{id} — seguimiento manual del staff.
 *
 * Acepta cualquier combinación de: cambiar `estado`, editar `notas`, o
 * registrar un `pago` (cuota cobrada fuera del checkout). Al registrar un pago
 * recalcula `saldoPendiente = montoTotal - montoPagado - Σpagos`; si el saldo
 * llega a 0 y no se forzó otro estado, marca la reserva como pagada_completa.
 * Read-modify-write sobre el único item de la reserva (baja concurrencia: 2-3
 * personas de staff). Protegido por el authorizer Cognito en la ApiStack.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id?.trim() ?? '';

  if (!isNonEmptyString(id)) {
    return json(400, { error: 'Falta el id de la reserva' });
  }

  const body = parseBody<UpdateBody>(event) ?? {};

  if (body.estado !== undefined && !ESTADOS.includes(body.estado)) {
    return json(400, { error: 'Estado inválido' });
  }

  if (body.notas !== undefined && typeof body.notas !== 'string') {
    return json(400, { error: 'Notas inválidas' });
  }

  if (typeof body.notas === 'string' && body.notas.length > MAX_NOTAS) {
    return json(400, { error: `Las notas no pueden superar ${MAX_NOTAS} caracteres` });
  }

  let nuevoPago: Pago | undefined;

  if (body.pago !== undefined) {
    const monto = redondear(Number(body.pago.monto));
    const metodo = body.pago.metodo?.trim() ?? '';
    const notaPago = body.pago.nota?.trim() || undefined;

    if (!Number.isFinite(monto) || monto <= 0 || !isNonEmptyString(metodo)) {
      return json(400, { error: 'El pago necesita un monto positivo y un método' });
    }

    if (metodo.length > MAX_METODO || (notaPago?.length ?? 0) > MAX_NOTA_PAGO) {
      return json(400, { error: 'Método o nota del pago demasiado largos' });
    }

    nuevoPago = {
      fecha: new Date().toISOString(),
      monto,
      metodo,
      nota: notaPago,
    };
  }

  if (body.estado === undefined && body.notas === undefined && nuevoPago === undefined) {
    return json(400, { error: 'No hay cambios que aplicar' });
  }

  const key = { PK: `RESERVA#${id}`, SK: 'META' };

  const existente = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));

  if (!existente.Item) {
    return json(404, { error: 'Reserva no encontrada' });
  }

  const reserva = itemToReserva(existente.Item);

  const pagosExistentes = reserva.pagos ?? [];
  const saldoAntes = redondear(
    reserva.montoTotal - reserva.montoPagado - pagosExistentes.reduce((s, p) => s + p.monto, 0)
  );

  if (nuevoPago && nuevoPago.monto > saldoAntes) {
    return json(400, {
      error: `El pago (${nuevoPago.monto.toFixed(2)}) supera el saldo pendiente (${saldoAntes.toFixed(2)})`,
    });
  }

  const pagos = nuevoPago ? [...pagosExistentes, nuevoPago] : pagosExistentes;
  const totalPagos = pagos.reduce((suma, p) => suma + p.monto, 0);
  const saldoPendiente = redondear(reserva.montoTotal - reserva.montoPagado - totalPagos);

  let estado: EstadoReserva = body.estado ?? reserva.estado ?? 'nueva';
  // Si el saldo queda saldado y no se forzó explícitamente otro estado, cerrar.
  if (saldoPendiente <= 0 && body.estado === undefined) {
    estado = 'pagada_completa';
  }

  const notas = body.notas !== undefined ? body.notas : reserva.notas;
  const ultimaEdicion = { por: getAuthEmail(event), fecha: new Date().toISOString() };
  const versionActual = reserva.version ?? 0;

  // ExpressionAttributeNames en todo por higiene (evita chocar con reservados).
  const names: Record<string, string> = {
    '#estado': 'estado',
    '#pagos': 'pagos',
    '#saldo': 'saldoPendiente',
    '#edit': 'ultimaEdicion',
    '#version': 'version',
  };
  const values: Record<string, unknown> = {
    ':estado': estado,
    ':pagos': pagos,
    ':saldo': saldoPendiente,
    ':edit': ultimaEdicion,
    ':versionActual': versionActual,
    ':nuevaVersion': versionActual + 1,
  };
  const sets = [
    '#estado = :estado',
    '#pagos = :pagos',
    '#saldo = :saldo',
    '#edit = :edit',
    '#version = :nuevaVersion',
  ];

  if (notas !== undefined) {
    names['#notas'] = 'notas';
    values[':notas'] = notas;
    sets.push('#notas = :notas');
  }

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: key,
        UpdateExpression: `SET ${sets.join(', ')}`,
        // Optimistic locking: si otra edición entró entre nuestra lectura y
        // esta escritura, la versión ya no coincide y DynamoDB rechaza el
        // write en lugar de pisar los cambios del otro (p. ej. perder un pago
        // recién registrado). attribute_not_exists cubre reservas sin version.
        ConditionExpression: 'attribute_not_exists(#version) OR #version = :versionActual',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })
    );

    return json(200, { reserva: itemToReserva(result.Attributes ?? {}) });
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return json(409, {
        error:
          'Otra persona modificó esta reserva al mismo tiempo. Recarga y vuelve a intentarlo.',
      });
    }

    console.error('Error actualizando la reserva:', error);
    return json(500, { error: 'No se pudo actualizar la reserva' });
  }
}
