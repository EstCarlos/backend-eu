import {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../shared/ddb';
import { json } from '../shared/http';
import { itemToReserva } from '../shared/admin';

/**
 * GET /admin/reservas — lista todas las reservas para el panel del staff.
 *
 * Query sobre GSI1 (GSI1PK=RESERVA, ordenado por GSI1SK=fecha), más recientes
 * primero. Pagina en memoria por si el resultado supera 1 MB (holgado para el
 * volumen de un viaje, pero correcto si crece). Protegido por el authorizer
 * Cognito en la ApiStack.
 */
export async function handler(
  _event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': 'RESERVA' },
          ScanIndexForward: false,
          ExclusiveStartKey: lastKey,
        })
      );

      items.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return json(200, { reservas: items.map(itemToReserva) });
  } catch (error) {
    console.error('Error listando reservas:', error);
    return json(500, { error: 'No se pudieron cargar las reservas' });
  }
}
