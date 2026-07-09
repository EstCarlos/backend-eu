import { itemToReserva } from '../src/shared/admin';

const base = {
  PK: 'RESERVA#abc',
  SK: 'META',
  GSI1PK: 'RESERVA',
  GSI1SK: '2026-07-07T05:58:55.038Z',
  tipo: 'RESERVA',
  id: 'abc',
  fecha: '2026-07-07T05:58:55.038Z',
  planId: 'plan-1',
  planNombre: 'Plan 1',
  paypalOrderId: 'ORDER-1',
  contacto: { nombreCompleto: 'Test', email: 'test@example.com', telefono: '123' },
  viajeros: ['Test'],
};

describe('itemToReserva', () => {
  test('reserva antigua sin campos de pago: defaults numéricos, nunca NaN', () => {
    // Reproduce el bug real: reserva legacy solo con montoTotal (sin
    // montoPagado/saldoPendiente) hacía NaN el recálculo de saldo del PATCH.
    const reserva = itemToReserva({ ...base, montoTotal: 899 });

    expect(reserva.montoPagado).toBe(0);
    expect(reserva.saldoPendiente).toBe(899);
    expect(reserva.estado).toBe('nueva');
    expect(reserva.pagos).toEqual([]);
    expect(Number.isFinite(reserva.montoTotal - reserva.montoPagado - reserva.saldoPendiente)).toBe(
      true
    );
  });

  test('respeta los campos cuando ya existen', () => {
    const reserva = itemToReserva({
      ...base,
      montoTotal: 1132,
      montoPagado: 200,
      saldoPendiente: 832,
      estado: 'contactada',
      pagos: [{ fecha: '2026-07-09T00:00:00.000Z', monto: 100, metodo: 'transferencia' }],
    });

    expect(reserva.montoPagado).toBe(200);
    expect(reserva.saldoPendiente).toBe(832);
    expect(reserva.estado).toBe('contactada');
    expect(reserva.pagos).toHaveLength(1);
  });

  test('deriva el saldo de total - pagado - pagos cuando falta', () => {
    const reserva = itemToReserva({
      ...base,
      montoTotal: 1000,
      montoPagado: 200,
      pagos: [{ fecha: '2026-07-09T00:00:00.000Z', monto: 300, metodo: 'efectivo' }],
    });

    expect(reserva.saldoPendiente).toBe(500);
  });

  test('quita las claves internas de DynamoDB', () => {
    const reserva = itemToReserva({ ...base, montoTotal: 899 });

    expect(reserva).not.toHaveProperty('PK');
    expect(reserva).not.toHaveProperty('SK');
    expect(reserva).not.toHaveProperty('GSI1PK');
    expect(reserva).not.toHaveProperty('GSI1SK');
    expect(reserva).not.toHaveProperty('tipo');
  });
});
