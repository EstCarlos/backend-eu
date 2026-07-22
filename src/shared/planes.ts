import { Plan } from './types';

/**
 * Catálogo de planes — FUENTE DE VERDAD de los precios (todos en USD).
 * El monto de cada orden PayPal se recalcula aquí; nunca se confía en el
 * monto que mande el cliente. Debe mantenerse alineado con la UI del
 * frontend (random-trips-web/lib/data/planes.ts).
 */
export const planes: Plan[] = [
  {
    id: 'plan-1',
    nombre: 'Plan 1',
    badge: 'Mejor Precio',
    precioPorPersona: 1371,
    incluye: [
      'Un solo pago',
      'Reserva confirmada inmediatamente',
      'El mejor precio disponible.',
    ],
  },
  {
    id: 'plan-2',
    nombre: 'Plan 2',
    grande: true,
    precioPorPersona: 1446,
    reserva: 230,
    saldo: 1216,
    cuotas: {
      pagos: [
        { fecha: '12 agosto', monto: 405 },
        { fecha: '26 agosto', monto: 405 },
        { fecha: '9 septiembre', monto: 406 },
      ],
    },
    incluye: ['Más flexibilidad para organizar tus pagos.'],
  },
  {
    id: 'plan-3',
    nombre: 'Plan 3',
    badge: 'Mayor Flexibilidad',
    destacado: true,
    precioPorPersona: 1521,
    reserva: 230,
    saldo: 1291,
    cuotas: {
      pagos: [
        { fecha: '12 agosto', monto: 259 },
        { fecha: '26 agosto', monto: 258 },
        { fecha: '2 septiembre', monto: 258 },
        { fecha: '9 septiembre', monto: 258 },
        { fecha: '16 septiembre', monto: 258 },
      ],
    },
    incluye: ['La opción ideal si prefieres realizar pagos más pequeños.'],
  },
];

export function getPlanById(id: string): Plan | undefined {
  return planes.find((plan) => plan.id === id);
}

function validarCantidadViajeros(cantidadViajeros: number): void {
  if (!Number.isInteger(cantidadViajeros) || cantidadViajeros < 1) {
    throw new Error('La cantidad de viajeros debe ser un entero mayor o igual a 1');
  }
}

/** Precio total del viaje en USD (precio por persona × viajeros). */
export function calcularTotal(planId: string, cantidadViajeros: number): number {
  const plan = getPlanById(planId);

  if (!plan) {
    throw new Error(`Plan desconocido: ${planId}`);
  }

  validarCantidadViajeros(cantidadViajeros);

  return plan.precioPorPersona * cantidadViajeros;
}

/**
 * Lo que se cobra HOY en el checkout, en USD: el total en planes de pago
 * único, o el depósito de reserva (por persona) en planes con cuotas.
 * El saldo restante se cobra después por cuotas con links de pago.
 */
export function calcularPagoInicial(planId: string, cantidadViajeros: number): number {
  const plan = getPlanById(planId);

  if (!plan) {
    throw new Error(`Plan desconocido: ${planId}`);
  }

  validarCantidadViajeros(cantidadViajeros);

  return (plan.reserva ?? plan.precioPorPersona) * cantidadViajeros;
}
