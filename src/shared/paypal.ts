import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';
import { calcularPagoInicial, getPlanById } from './planes';

/**
 * Cliente PayPal Orders v2 (OAuth client_credentials → create → capture).
 * Portado de random-trips-web/lib/paypal/client.ts; la única diferencia es
 * que las credenciales salen de SSM Parameter Store (SecureString) en vez
 * de variables de entorno, con cache a nivel de módulo entre invocaciones.
 */

const PAYPAL_API_BASE = process.env.PAYPAL_API_BASE ?? 'https://api-m.sandbox.paypal.com';
const CLIENT_ID_PARAM = process.env.PAYPAL_CLIENT_ID_PARAM ?? '';
const CLIENT_SECRET_PARAM = process.env.PAYPAL_CLIENT_SECRET_PARAM ?? '';

const ssm = new SSMClient({});

let cachedCredentials: { clientId: string; clientSecret: string } | undefined;

async function getCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const result = await ssm.send(
    new GetParametersCommand({
      Names: [CLIENT_ID_PARAM, CLIENT_SECRET_PARAM],
      WithDecryption: true,
    })
  );

  const byName = new Map(result.Parameters?.map((p) => [p.Name, p.Value]));
  const clientId = byName.get(CLIENT_ID_PARAM);
  const clientSecret = byName.get(CLIENT_SECRET_PARAM);

  if (!clientId || !clientSecret) {
    throw new Error(
      `Faltan los parámetros SSM de PayPal (${CLIENT_ID_PARAM}, ${CLIENT_SECRET_PARAM})`
    );
  }

  cachedCredentials = { clientId, clientSecret };
  return cachedCredentials;
}

async function getAccessToken(): Promise<string> {
  const { clientId, clientSecret } = await getCredentials();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`No se pudo obtener el token de PayPal (${response.status})`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

export async function createOrder(
  planId: string,
  cantidadViajeros: number
): Promise<{ id: string }> {
  const plan = getPlanById(planId);

  if (!plan) {
    throw new Error(`Plan desconocido: ${planId}`);
  }

  // En planes con cuotas solo se cobra el depósito de reserva; el saldo
  // se cobra después con links de pago (una cuota mensual por link).
  const pagoInicial = calcularPagoInicial(planId, cantidadViajeros);
  const accessToken = await getAccessToken();

  const concepto = plan.reserva
    ? `Random Trips — Reserva ${plan.nombre} x ${cantidadViajeros} viajero(s)`
    : `Random Trips — ${plan.nombre} x ${cantidadViajeros} viajero(s)`;

  const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          description: concepto,
          amount: {
            currency_code: 'EUR',
            value: pagoInicial.toFixed(2),
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Error creando la orden de PayPal (${response.status}): ${body}`);
  }

  return (await response.json()) as { id: string };
}

export type CaptureResult = {
  id: string;
  status: string;
  purchase_units: Array<{
    payments?: {
      captures?: Array<{ amount: { value: string; currency_code: string } }>;
    };
  }>;
};

/** Lanzado cuando PayPal responde que la orden ya fue capturada antes. */
export class OrderAlreadyCapturedError extends Error {
  constructor(public readonly orderId: string) {
    super(`La orden ${orderId} ya fue capturada`);
  }
}

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();

    if (response.status === 422 && body.includes('ORDER_ALREADY_CAPTURED')) {
      throw new OrderAlreadyCapturedError(orderId);
    }

    throw new Error(`Error capturando la orden de PayPal (${response.status}): ${body}`);
  }

  return (await response.json()) as CaptureResult;
}
