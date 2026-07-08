/**
 * Tipos del dominio. Mismos shapes que el frontend (random-trips-web):
 * lib/reservas/store.ts, lib/mensajes/store.ts y lib/data/planes.ts.
 * No cambiar sin coordinar con el frontend.
 */

export type Plan = {
  id: string;
  nombre: string;
  /** Precio total del viaje por persona, en EUR */
  precioPorPersona: number;
  /** Depósito inicial por persona en EUR — solo en planes con cuotas */
  reserva?: number;
  /** Saldo restante por persona tras la reserva, en EUR */
  saldo?: number;
  /** Cuotas mensuales en EUR que cubren el saldo (se cobran por link de pago) */
  cuotas?: {
    cantidad: number;
    monto: number;
  };
  badge?: string;
  destacado?: boolean;
  grande?: boolean;
  incluye: string[];
};

export type Contacto = {
  nombreCompleto: string;
  email: string;
  telefono: string;
};

export type Reserva = {
  id: string;
  fecha: string;
  planId: string;
  planNombre: string;
  /** Precio total del viaje (EUR) — lo que el cliente pagará en conjunto */
  montoTotal: number;
  /** Lo efectivamente cobrado en el checkout (EUR): total en pago único, o depósito en planes con cuotas */
  montoPagado: number;
  /** Saldo pendiente (EUR) que se cobrará por cuotas con links de pago */
  saldoPendiente: number;
  paypalOrderId: string;
  contacto: Contacto;
  viajeros: string[];
};

export type Mensaje = {
  id: string;
  fecha: string;
  nombre: string;
  email: string;
  mensaje: string;
};
