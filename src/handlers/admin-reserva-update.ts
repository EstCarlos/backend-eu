import {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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

/** Redondeo a céntimos para evitar arrastre de coma flotante en importes EUR. */
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

  let nuevoPago: Pago | undefined;

  if (body.pago !== undefined) {
    const monto = redondear(Number(body.pago.monto));
    const metodo = body.pago.metodo?.trim() ?? '';

    if (!Number.isFinite(monto) || monto <= 0 || !isNonEmptyString(metodo)) {
      return json(400, { error: 'El pago necesita un monto positivo y un método' });
    }

    nuevoPago = {
      fecha: new Date().toISOString(),
      monto,
      metodo,
      nota: body.pago.nota?.trim() || undefined,
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

  const pagos = nuevoPago ? [...(reserva.pagos ?? []), nuevoPago] : reserva.pagos ?? [];
  const totalPagos = pagos.reduce((suma, p) => suma + p.monto, 0);
  const saldoPendiente = redondear(reserva.montoTotal - reserva.montoPagado - totalPagos);

  let estado: EstadoReserva = body.estado ?? reserva.estado ?? 'nueva';
  // Si el saldo queda saldado y no se forzó explícitamente otro estado, cerrar.
  if (saldoPendiente <= 0 && body.estado === undefined) {
    estado = 'pagada_completa';
  }

  const notas = body.notas !== undefined ? body.notas : reserva.notas;
  const ultimaEdicion = { por: getAuthEmail(event), fecha: new Date().toISOString() };

  // ExpressionAttributeNames en todo por higiene (evita chocar con reservados).
  const names: Record<string, string> = {
    '#estado': 'estado',
    '#pagos': 'pagos',
    '#saldo': 'saldoPendiente',
    '#edit': 'ultimaEdicion',
  };
  const values: Record<string, unknown> = {
    ':estado': estado,
    ':pagos': pagos,
    ':saldo': saldoPendiente,
    ':edit': ultimaEdicion,
  };
  const sets = ['#estado = :estado', '#pagos = :pagos', '#saldo = :saldo', '#edit = :edit'];

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
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })
    );

    return json(200, { reserva: itemToReserva(result.Attributes ?? {}) });
  } catch (error) {
    console.error('Error actualizando la reserva:', error);
    return json(500, { error: 'No se pudo actualizar la reserva' });
  }
}
