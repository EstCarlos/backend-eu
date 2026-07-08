import { Plan } from './types';

/**
 * Catálogo de planes — FUENTE DE VERDAD de los precios (todos en EUR).
 * El monto de cada orden PayPal se recalcula aquí; nunca se confía en el
 * monto que mande el cliente. Debe mantenerse alineado con la UI del
 * frontend (random-trips-web/lib/data/planes.ts).
 */
export const planes: Plan[] = [
  {
    id: 'plan-1',
    nombre: 'Plan 1',
    badge: 'Mejor Precio',
    precioPorPersona: 1032,
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
    precioPorPersona: 1132,
    reserva: 200,
    saldo: 932,
    cuotas: { cantidad: 3, monto: 310.67 },
    incluye: ['Más flexibilidad para organizar tus pagos.'],
  },
  {
    id: 'plan-3',
    nombre: 'Plan 3',
    badge: 'Mayor Flexibilidad',
    destacado: true,
    precioPorPersona: 1182,
    reserva: 200,
    saldo: 982,
    cuotas: { cantidad: 5, monto: 196.4 },
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

/** Precio total del viaje en EUR (precio por persona × viajeros). */
export function calcularTotal(planId: string, cantidadViajeros: number): number {
  const plan = getPlanById(planId);

  if (!plan) {
    throw new Error(`Plan desconocido: ${planId}`);
  }

  validarCantidadViajeros(cantidadViajeros);

  return plan.precioPorPersona * cantidadViajeros;
}

/**
 * Lo que se cobra HOY en el checkout, en EUR: el total en planes de pago
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
