import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL ?? '';
// Remitente sobre el dominio verificado en SES (notifications@randomtrips.co);
// el destinatario (NOTIFICATION_EMAIL) es el buzón real del equipo.
const SES_FROM = process.env.SES_FROM || NOTIFICATION_EMAIL;
// Nombre de display que ve el cliente en su bandeja (en vez de solo
// "notifications"). El correo real de envío no cambia, solo la etiqueta.
const SES_FROM_CON_NOMBRE = SES_FROM ? `Random Trips Bahía <${SES_FROM}>` : SES_FROM;

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
        FromEmailAddress: SES_FROM_CON_NOMBRE,
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

/**
 * Confirmación al cliente que reservó. Best-effort igual que notificarEquipo:
 * la reserva ya está persistida cuando se llama, así que un fallo de SES no
 * debe romper la respuesta del checkout.
 */
export async function notificarCliente(
  email: string,
  asunto: string,
  texto: string,
  html?: string
): Promise<void> {
  if (!email) {
    return;
  }

  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: SES_FROM_CON_NOMBRE,
        Destination: { ToAddresses: [email] },
        Content: {
          Simple: {
            Subject: { Data: asunto, Charset: 'UTF-8' },
            Body: {
              // Texto siempre presente: fallback de clientes viejos y mejor
              // reputación de entrega que un HTML sin alternativa de texto.
              Text: { Data: texto, Charset: 'UTF-8' },
              ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}),
            },
          },
        },
      })
    );
  } catch (error) {
    console.error('No se pudo enviar la confirmación al cliente:', error);
  }
}
