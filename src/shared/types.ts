/**
 * Tipos del dominio. Mismos shapes que el frontend (random-trips-web):
 * lib/reservas/store.ts, lib/mensajes/store.ts y lib/data/planes.ts.
 * No cambiar sin coordinar con el frontend.
 */

export type Plan = {
  id: string;
  nombre: string;
  /** Precio total del viaje por persona, en USD */
  precioPorPersona: number;
  /** Depósito inicial por persona en USD — solo en planes con cuotas */
  reserva?: number;
  /** Saldo restante por persona tras la reserva, en USD */
  saldo?: number;
  /** Cuotas en USD que cubren el saldo (se cobran por link de pago) */
  cuotas?: {
    pagos: Array<{ fecha: string; monto: number }>;
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

/**
 * Estado de seguimiento de la reserva, gestionado a mano por el staff desde el
 * panel admin. No lo toca el flujo de checkout: una reserva recién pagada nace
 * como 'nueva'.
 */
export type EstadoReserva = 'nueva' | 'contactada' | 'link_enviado' | 'pagada_completa';

/** Pago de una cuota cobrado fuera del checkout (link de pago) y registrado a mano. */
export type Pago = {
  fecha: string;
  /** USD cobrados en este pago */
  monto: number;
  /** Medio usado: 'paypal', 'transferencia', 'efectivo'… (texto libre) */
  metodo: string;
  nota?: string;
};

export type Reserva = {
  id: string;
  fecha: string;
  planId: string;
  planNombre: string;
  /** Precio total del viaje (USD) — lo que el cliente pagará en conjunto */
  montoTotal: number;
  /** Lo efectivamente cobrado en el checkout (USD): total en pago único, o depósito en planes con cuotas */
  montoPagado: number;
  /** Saldo pendiente (USD): montoTotal - montoPagado - Σpagos. Se recalcula al registrar pagos. */
  saldoPendiente: number;
  paypalOrderId: string;
  contacto: Contacto;
  viajeros: string[];
  // --- Seguimiento (panel admin; opcionales para no romper reservas existentes) ---
  /** Estado de seguimiento. Ausente en reservas viejas → se trata como 'nueva'. */
  estado?: EstadoReserva;
  /** Notas internas del staff. */
  notas?: string;
  /** Cuotas cobradas a mano tras el checkout. Ausente → []. */
  pagos?: Pago[];
  /** Quién y cuándo hizo la última edición desde el panel (auditoría). */
  ultimaEdicion?: { por: string; fecha: string };
  /**
   * Contador para detección de ediciones concurrentes (optimistic locking del
   * PATCH admin): cada edición exitosa lo incrementa. Ausente = 0.
   */
  version?: number;
};

export type Mensaje = {
  id: string;
  fecha: string;
  nombre: string;
  email: string;
  mensaje: string;
};
