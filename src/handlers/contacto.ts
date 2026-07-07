import { randomUUID } from 'node:crypto';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../shared/ddb';
import { EMAIL_REGEX, isNonEmptyString, json, parseBody } from '../shared/http';
import { notificarEquipo } from '../shared/ses';
import { Mensaje } from '../shared/types';

type ContactoBody = {
  nombre?: string;
  email?: string;
  mensaje?: string;
};

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody<ContactoBody>(event);

  const nombre = body?.nombre?.trim() ?? '';
  const email = body?.email?.trim() ?? '';
  const mensaje = body?.mensaje?.trim() ?? '';

  if (
    !isNonEmptyString(nombre) ||
    !EMAIL_REGEX.test(email) ||
    !isNonEmptyString(mensaje)
  ) {
    return json(400, { error: 'Completa nombre, correo válido y mensaje' });
  }

  const item: Mensaje = {
    id: randomUUID(),
    fecha: new Date().toISOString(),
    nombre,
    email,
    mensaje,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `MENSAJE#${item.id}`,
          SK: 'META',
          GSI1PK: 'MENSAJE',
          GSI1SK: item.fecha,
          tipo: 'MENSAJE',
          ...item,
        },
      })
    );
  } catch (error) {
    console.error('Error guardando el mensaje:', error);
    return json(500, { error: 'No se pudo enviar el mensaje' });
  }

  await notificarEquipo(
    `Nuevo mensaje de contacto — ${nombre}`,
    `Nombre: ${nombre}\nEmail: ${email}\nFecha: ${item.fecha}\n\n${mensaje}`
  );

  return json(200, { ok: true });
}
