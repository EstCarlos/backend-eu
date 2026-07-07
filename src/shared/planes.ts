import { Plan } from './types';

/**
 * Catálogo de planes — FUENTE DE VERDAD de los precios.
 * El total de cada orden PayPal se recalcula aquí; nunca se confía en el
 * monto que mande el cliente. Debe mantenerse alineado con la UI del
 * frontend (random-trips-web/lib/data/planes.ts).
 */
// TODO: precios y contenido reales — placeholders hasta que Random Trips los confirme.
export const planes: Plan[] = [
  {
    id: 'plan-1',
    nombre: 'Plan 1',
    precioPorPersona: 899,
    incluye: [
      'Alojamiento compartido',
      'Transporte durante todo el recorrido',
      'Actividades del itinerario',
    ],
  },
  {
    id: 'plan-2',
    nombre: 'Plan 2',
    precioPorPersona: 1199,
    destacado: true,
    incluye: [
      'Alojamiento privado',
      'Transporte durante todo el recorrido',
      'Actividades del itinerario',
      'Clase de surf',
    ],
  },
  {
    id: 'plan-3',
    nombre: 'Plan 3',
    precioPorPersona: 1499,
    incluye: [
      'Alojamiento privado premium',
      'Transporte durante todo el recorrido',
      'Actividades del itinerario',
      'Clase de surf',
      'Degustaciones gastronómicas',
    ],
  },
];

export function getPlanById(id: string): Plan | undefined {
  return planes.find((plan) => plan.id === id);
}

export function calcularTotal(planId: string, cantidadViajeros: number): number {
  const plan = getPlanById(planId);

  if (!plan) {
    throw new Error(`Plan desconocido: ${planId}`);
  }

  if (!Number.isInteger(cantidadViajeros) || cantidadViajeros < 1) {
    throw new Error('La cantidad de viajeros debe ser un entero mayor o igual a 1');
  }

  return plan.precioPorPersona * cantidadViajeros;
}
