import { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { Reserva } from './types';

/**
 * Email del staff autenticado, leído de las claims del JWT de Cognito que el
 * authorizer expone. Se usa para auditar quién editó cada reserva.
 */
export function getAuthEmail(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const email = claims.email ?? claims['cognito:username'] ?? claims.sub;
  return typeof email === 'string' && email.length > 0 ? email : 'desconocido';
}

/**
 * Item de DynamoDB (con PK/SK/GSI/tipo) → Reserva del dominio, aplicando los
 * defaults de seguimiento a reservas creadas antes de existir estos campos.
 */
export function itemToReserva(item: Record<string, unknown>): Reserva {
  const { PK, SK, GSI1PK, GSI1SK, tipo, ...rest } = item as Record<string, unknown>;
  void PK;
  void SK;
  void GSI1PK;
  void GSI1SK;
  void tipo;

  const reserva = rest as unknown as Reserva;

  // Reservas creadas antes de existir los campos de pago pueden no traerlos:
  // sin estos defaults el recálculo de saldo del PATCH produce NaN y DynamoDB
  // rechaza la escritura ("Special numeric value NaN is not allowed").
  const montoTotal = reserva.montoTotal ?? 0;
  const montoPagado = reserva.montoPagado ?? 0;
  const pagos = reserva.pagos ?? [];
  const saldoPendiente =
    typeof reserva.saldoPendiente === 'number' && Number.isFinite(reserva.saldoPendiente)
      ? reserva.saldoPendiente
      : montoTotal - montoPagado - pagos.reduce((suma, p) => suma + p.monto, 0);

  return {
    ...reserva,
    montoTotal,
    montoPagado,
    saldoPendiente,
    estado: reserva.estado ?? 'nueva',
    pagos,
  };
}
