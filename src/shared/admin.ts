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

  return {
    ...reserva,
    estado: reserva.estado ?? 'nueva',
    pagos: reserva.pagos ?? [],
  };
}
