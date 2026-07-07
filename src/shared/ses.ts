import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL ?? '';

const ses = new SESv2Client({});

/**
 * Aviso por email al equipo. Best-effort deliberado: para cuando se llama,
 * la reserva/mensaje ya está persistido en DynamoDB, así que un fallo de SES
 * (sandbox, cuota, identidad sin verificar) no debe romper el request.
 */
export async function notificarEquipo(asunto: string, texto: string): Promise<void> {
  if (!NOTIFICATION_EMAIL) {
    return;
  }

  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: NOTIFICATION_EMAIL,
        Destination: { ToAddresses: [NOTIFICATION_EMAIL] },
        Content: {
          Simple: {
            Subject: { Data: asunto, Charset: 'UTF-8' },
            Body: { Text: { Data: texto, Charset: 'UTF-8' } },
          },
        },
      })
    );
  } catch (error) {
    console.error('No se pudo enviar la notificación SES:', error);
  }
}
