import { Reserva } from './types';

/**
 * Correo de confirmación al cliente, en las dos versiones que exige un buen
 * email: HTML (diseño de marca) + texto plano (fallback y entregabilidad).
 *
 * Restricciones de clientes de correo (Gmail/Outlook): nada de CSS externo,
 * ni <style>, ni fuentes custom, ni SVG — solo tablas y estilos inline con
 * fuentes de sistema. Los colores son los design tokens de la landing.
 */

const COLOR = {
  rojo: '#f23540',
  amarillo: '#feda40',
  crema: '#fef0dc',
  azul: '#1d86f9',
  aqua: '#15bebe',
  ink: '#1a1a1a',
  gris: '#6b7280',
};

const FUENTE = "'Segoe UI', Arial, Helvetica, sans-serif";

function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function eur(monto: number): string {
  return `EUR ${monto.toFixed(2)}`;
}

function filaResumen(etiqueta: string, valor: string, valorColor = COLOR.ink): string {
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-family:${FUENTE};font-size:14px;color:${COLOR.gris};">${etiqueta}</td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-family:${FUENTE};font-size:14px;font-weight:bold;color:${valorColor};">${valor}</td>
    </tr>`;
}

export function emailConfirmacionReserva(reserva: Reserva): {
  asunto: string;
  texto: string;
  html: string;
} {
  const nombre = reserva.contacto.nombreCompleto;
  const viajeros = reserva.viajeros;
  const pagadoTodo = reserva.saldoPendiente <= 0;

  const asunto = `Confirmación de tu reserva — ${reserva.planNombre}`;

  const saldoTexto = pagadoTodo
    ? 'Tu viaje ya está pagado en su totalidad. ¡Nos vemos pronto!'
    : `Saldo pendiente: ${eur(reserva.saldoPendiente)} (te contactaremos con el link de pago de cada cuota).`;

  const texto = [
    `Hola ${nombre},`,
    '',
    '¡Gracias por reservar tu lugar en Random Trips! Este es el resumen de tu reserva:',
    '',
    `Plan: ${reserva.planNombre}`,
    `Viajeros: ${viajeros.join(', ')}`,
    `Pagado hoy: ${eur(reserva.montoPagado)}`,
    `Total del viaje: ${eur(reserva.montoTotal)}`,
    saldoTexto,
    '',
    `Número de reserva: ${reserva.id}`,
    '',
    'Cualquier duda, escríbenos por WhatsApp o responde a este correo.',
    '',
    'El equipo de Random Trips',
  ].join('\n');

  const bloqueSaldo = pagadoTodo
    ? `
      <tr>
        <td style="padding:16px 20px;background-color:#e7f9f9;border-radius:12px;">
          <p style="margin:0;font-family:${FUENTE};font-size:14px;font-weight:bold;color:${COLOR.aqua};">
            Tu viaje ya está pagado en su totalidad. ¡Nos vemos pronto!
          </p>
        </td>
      </tr>`
    : `
      <tr>
        <td style="padding:16px 20px;background-color:${COLOR.crema};border-radius:12px;">
          <p style="margin:0 0 4px;font-family:${FUENTE};font-size:14px;font-weight:bold;color:${COLOR.rojo};">
            Saldo pendiente: ${eur(reserva.saldoPendiente)}
          </p>
          <p style="margin:0;font-family:${FUENTE};font-size:13px;color:${COLOR.gris};">
            Te contactaremos con el link de pago de cada cuota. No tienes que hacer nada por ahora.
          </p>
        </td>
      </tr>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(asunto)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.crema};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLOR.crema};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">

          <!-- Header de marca -->
          <tr>
            <td style="background-color:${COLOR.rojo};border-radius:20px 20px 0 0;padding:28px 32px;text-align:center;">
              <p style="margin:0;font-family:${FUENTE};font-size:24px;font-weight:800;color:#ffffff;letter-spacing:3px;">RANDOM&nbsp;TRIPS</p>
              <p style="margin:6px 0 0;font-family:${FUENTE};font-size:12px;color:${COLOR.amarillo};letter-spacing:2px;text-transform:uppercase;">República Dominicana</p>
            </td>
          </tr>

          <!-- Cuerpo -->
          <tr>
            <td style="background-color:#ffffff;padding:36px 32px;">
              <h1 style="margin:0 0 6px;font-family:${FUENTE};font-size:24px;color:${COLOR.ink};">¡Reserva confirmada!</h1>
              <p style="margin:0 0 24px;font-family:${FUENTE};font-size:15px;line-height:1.6;color:${COLOR.gris};">
                Hola <strong style="color:${COLOR.ink};">${escapeHtml(nombre)}</strong>, gracias por reservar tu lugar.
                Este es el resumen de tu reserva:
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                ${filaResumen('Plan', escapeHtml(reserva.planNombre), COLOR.azul)}
                ${filaResumen(
                  viajeros.length === 1 ? 'Viajero' : `Viajeros (${viajeros.length})`,
                  escapeHtml(viajeros.join(', '))
                )}
                ${filaResumen('Pagado hoy', eur(reserva.montoPagado), COLOR.aqua)}
                ${filaResumen('Total del viaje', eur(reserva.montoTotal))}
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                ${bloqueSaldo}
              </table>

              <p style="margin:0 0 4px;font-family:${FUENTE};font-size:12px;text-transform:uppercase;letter-spacing:1px;color:${COLOR.gris};">Número de reserva</p>
              <p style="margin:0 0 28px;font-family:Consolas,Menlo,monospace;font-size:13px;color:${COLOR.ink};">${reserva.id}</p>

              <p style="margin:0;font-family:${FUENTE};font-size:14px;line-height:1.6;color:${COLOR.gris};">
                Cualquier duda, escríbenos por WhatsApp o responde a este correo.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:${COLOR.azul};border-radius:0 0 20px 20px;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-family:${FUENTE};font-size:13px;font-weight:bold;color:#ffffff;">El equipo de Random Trips</p>
              <p style="margin:4px 0 0;font-family:${FUENTE};font-size:12px;color:rgba(255,255,255,0.75);">El corazón del Caribe · 8 días y 7 noches</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { asunto, texto, html };
}
