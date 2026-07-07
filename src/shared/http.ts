import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

/** Mismo regex de validación que usa el frontend. */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_VIAJEROS = 1;
export const MAX_VIAJEROS = 10;

export function json(
  statusCode: number,
  body: unknown,
  headers?: Record<string, string>
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

export function badRequest(error: string): APIGatewayProxyResultV2 {
  return json(400, { error });
}

export function parseBody<T>(event: APIGatewayProxyEventV2): T | null {
  if (!event.body) {
    return null;
  }

  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Valida la lista de viajeros (1–10, todos con nombre). Devuelve el error o null. */
export function validarViajeros(viajeros: unknown): string | null {
  if (!Array.isArray(viajeros) || viajeros.length < MIN_VIAJEROS) {
    return 'Debe haber al menos un viajero';
  }

  if (viajeros.length > MAX_VIAJEROS) {
    return `Máximo ${MAX_VIAJEROS} viajeros por reserva`;
  }

  if (!viajeros.every(isNonEmptyString)) {
    return 'Todos los viajeros deben tener nombre';
  }

  return null;
}
