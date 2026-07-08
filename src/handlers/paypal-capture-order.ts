import { randomUUID } from 'node:crypto';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { ddb, TABLE_NAME } from '../shared/ddb';
import { EMAIL_REGEX, isNonEmptyString, json, parseBody, validarViajeros } from '../shared/http';
import { calcularPagoInicial, calcularTotal, getPlanById } from '../shared/planes';
import {
  captureOrder,
  InstrumentDeclinedError,
  OrderAlreadyCapturedError,
} from '../shared/paypal';
import { notificarEquipo } from '../shared/ses';
import { Reserva } from '../shared/types';

type CaptureBody = {
  orderId?: string;
  planId?: string;
  viajeros?: string[];
  contacto?: {
    nombreCompleto?: string;
    email?: string;
    telefono?: string;
  };
};

/**
 * Captura el pago en PayPal y persiste la reserva de forma idempotente:
 * junto a la reserva se escribe un lock PK=PAYPAL#<orderId> con condición
 * attribute_not_exists, en la misma transacción. Si el cliente reintenta el
 * capture (doble click, retry de red), se devuelve la reserva ya creada en
 * lugar de duplicarla o fallar.
 */
export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody<CaptureBody>(event);

  const orderId = body?.orderId?.trim() ?? '';
  const plan = body?.planId ? getPlanById(body.planId) : undefined;

  if (!isNonEmptyString(orderId) || !plan || validarViajeros(body?.viajeros)) {
    return json(400, { error: 'Datos de reserva inválidos' });
  }

  const nombreCompleto = body?.contacto?.nombreCompleto?.trim() ?? '';
  const email = body?.contacto?.email?.trim() ?? '';
  const telefono = body?.contacto?.telefono?.trim() ?? '';

  if (!isNonEmptyString(nombreCompleto) || !EMAIL_REGEX.test(email) || !isNonEmptyString(telefono)) {
    return json(400, { error: 'Faltan datos del titular de la reserva' });
  }

  const viajeros = body!.viajeros!.map((v) => v.trim());

  let paypalOrderId: string;

  try {
    const captura = await captureOrder(orderId);

    if (captura.status !== 'COMPLETED') {
      return json(402, { error: `El pago no se completó (estado: ${captura.status})` });
    }

    paypalOrderId = captura.id;
  } catch (error) {
    if (error instanceof OrderAlreadyCapturedError) {
      // Reintento de una orden ya cobrada: buscar la reserva existente.
      const existente = await buscarReservaPorOrden(orderId);

      if (existente) {
        return json(200, { ok: true, reservaId: existente });
      }
    }

    if (error instanceof InstrumentDeclinedError) {
      // Rechazo del banco, no error del sistema: el frontend reinicia el
      // checkout (actions.restart()) para que el cliente use otro método.
      return json(402, {
        error: 'La tarjeta fue rechazada por el banco. Intenta con otra tarjeta u otro método de pago.',
        code: 'INSTRUMENT_DECLINED',
      });
    }

    console.error('Error capturando la orden de PayPal:', error);
    return json(502, { error: 'No se pudo confirmar el pago' });
  }

  const montoTotal = calcularTotal(plan.id, viajeros.length);
  const montoPagado = calcularPagoInicial(plan.id, viajeros.length);

  const reserva: Reserva = {
    id: randomUUID(),
    fecha: new Date().toISOString(),
    planId: plan.id,
    planNombre: plan.nombre,
    montoTotal,
    montoPagado,
    saldoPendiente: montoTotal - montoPagado,
    paypalOrderId,
    contacto: { nombreCompleto, email, telefono },
    viajeros,
  };

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: `PAYPAL#${paypalOrderId}`,
                SK: 'META',
                tipo: 'PAYPAL_LOCK',
                reservaId: reserva.id,
                fecha: reserva.fecha,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: `RESERVA#${reserva.id}`,
                SK: 'META',
                GSI1PK: 'RESERVA',
                GSI1SK: reserva.fecha,
                tipo: 'RESERVA',
                ...reserva,
              },
            },
          },
        ],
      })
    );
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      const existente = await buscarReservaPorOrden(paypalOrderId);

      if (existente) {
        return json(200, { ok: true, reservaId: existente });
      }
    }

    // El pago YA se cobró: dejar rastro claro en logs para reconciliar a mano.
    console.error(
      `PAGO CAPTURADO SIN RESERVA GUARDADA — paypalOrderId=${paypalOrderId}:`,
      error
    );
    return json(502, { error: 'No se pudo confirmar el pago' });
  }

  await notificarEquipo(
    `Nueva reserva pagada — ${reserva.planNombre} (${viajeros.length} viajero(s))`,
    [
      `Reserva: ${reserva.id}`,
      `Plan: ${reserva.planNombre} (${reserva.planId})`,
      `Pagado hoy: EUR ${reserva.montoPagado.toFixed(2)}`,
      `Total del viaje: EUR ${reserva.montoTotal.toFixed(2)}`,
      `Saldo pendiente (cobrar por links de pago): EUR ${reserva.saldoPendiente.toFixed(2)}`,
      `PayPal Order: ${reserva.paypalOrderId}`,
      `Titular: ${nombreCompleto} — ${email} — ${telefono}`,
      `Viajeros: ${viajeros.join(', ')}`,
      `Fecha: ${reserva.fecha}`,
    ].join('\n')
  );

  return json(200, { ok: true, reservaId: reserva.id });
}

async function buscarReservaPorOrden(paypalOrderId: string): Promise<string | null> {
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `PAYPAL#${paypalOrderId}`, SK: 'META' },
      })
    );

    return (result.Item?.reservaId as string | undefined) ?? null;
  } catch (error) {
    console.error('Error buscando la reserva por orden PayPal:', error);
    return null;
  }
}
