import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { json, parseBody, validarViajeros } from '../shared/http';
import { getPlanById } from '../shared/planes';
import { createOrder } from '../shared/paypal';

type CreateOrderBody = {
  planId?: string;
  viajeros?: string[];
};

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody<CreateOrderBody>(event);

  const plan = body?.planId ? getPlanById(body.planId) : undefined;

  if (!plan) {
    return json(400, { error: 'Plan inválido' });
  }

  const errorViajeros = validarViajeros(body?.viajeros);

  if (errorViajeros) {
    return json(400, { error: errorViajeros });
  }

  try {
    const orden = await createOrder(plan.id, body!.viajeros!.length);
    return json(200, { id: orden.id });
  } catch (error) {
    console.error('Error creando la orden de PayPal:', error);
    return json(502, { error: 'No se pudo crear la orden de PayPal' });
  }
}
