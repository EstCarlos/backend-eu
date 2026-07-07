/**
 * Tipos del dominio. Mismos shapes que el frontend (random-trips-web):
 * lib/reservas/store.ts, lib/mensajes/store.ts y lib/data/planes.ts.
 * No cambiar sin coordinar con el frontend.
 */

export type Plan = {
  id: string;
  nombre: string;
  precioPorPersona: number;
  destacado?: boolean;
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
  montoTotal: number;
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
