import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { json } from '../shared/http';
import { planes } from '../shared/planes';

/** GET /planes — catálogo de planes (fuente de verdad de precios). */
export async function handler(): Promise<APIGatewayProxyResultV2> {
  return json(200, planes, { 'cache-control': 'public, max-age=300' });
}
