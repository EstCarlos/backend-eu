import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const sendMock = jest.fn();

jest.mock('../src/shared/ddb', () => ({
  TABLE_NAME: 'test-table',
  ddb: { send: (...args: unknown[]) => sendMock(...args) },
}));

import { handler } from '../src/handlers/admin-reserva-update';

type Respuesta = { statusCode: number; body: string };

function evento(
  body: unknown,
  id = 'r1',
  email = 'staff@randomtrips.co'
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    pathParameters: { id },
    body: JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { authorizer: { jwt: { claims: { email } } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const item = {
  PK: 'RESERVA#r1',
  SK: 'META',
  GSI1PK: 'RESERVA',
  GSI1SK: '2026-07-08T00:00:00.000Z',
  tipo: 'RESERVA',
  id: 'r1',
  fecha: '2026-07-08T00:00:00.000Z',
  planId: 'plan-2',
  planNombre: 'Plan 2',
  montoTotal: 1000,
  montoPagado: 200,
  saldoPendiente: 800,
  paypalOrderId: 'ORDER-1',
  contacto: { nombreCompleto: 'Titular Test', email: 'titular@example.com', telefono: '123' },
  viajeros: ['Titular Test'],
  version: 3,
};

/** Mockea Get→item y Update→eco de los valores enviados; captura el UpdateCommand. */
function mockTabla(getItem: Record<string, unknown> | undefined) {
  let updateInput: UpdateCommand['input'] | undefined;

  sendMock.mockImplementation((cmd: unknown) => {
    if (cmd instanceof GetCommand) {
      return Promise.resolve({ Item: getItem });
    }
    if (cmd instanceof UpdateCommand) {
      updateInput = cmd.input;
      const v = cmd.input.ExpressionAttributeValues ?? {};
      return Promise.resolve({
        Attributes: {
          ...getItem,
          estado: v[':estado'],
          pagos: v[':pagos'],
          saldoPendiente: v[':saldo'],
          ultimaEdicion: v[':edit'],
          version: v[':nuevaVersion'],
          ...(v[':notas'] !== undefined ? { notas: v[':notas'] } : {}),
        },
      });
    }
    throw new Error('Comando inesperado');
  });

  return () => updateInput;
}

beforeEach(() => sendMock.mockReset());

describe('admin-reserva-update', () => {
  test('404 si la reserva no existe', async () => {
    mockTabla(undefined);
    const res = (await handler(evento({ notas: 'x' }))) as Respuesta;
    expect(res.statusCode).toBe(404);
  });

  test('400 con estado inválido', async () => {
    const res = (await handler(evento({ estado: 'volando' }))) as Respuesta;
    expect(res.statusCode).toBe(400);
  });

  test('400 sin cambios que aplicar', async () => {
    const res = (await handler(evento({}))) as Respuesta;
    expect(res.statusCode).toBe(400);
  });

  test('400 con pago sin monto positivo o sin método', async () => {
    for (const pago of [{ monto: 0, metodo: 'efectivo' }, { monto: 50, metodo: '  ' }]) {
      const res = (await handler(evento({ pago }))) as Respuesta;
      expect(res.statusCode).toBe(400);
    }
  });

  test('400 si el pago supera el saldo pendiente', async () => {
    mockTabla(item); // saldo real: 1000 - 200 = 800
    const res = (await handler(evento({ pago: { monto: 900, metodo: 'transferencia' } }))) as Respuesta;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('supera el saldo');
  });

  test('400 con notas de más de 2000 caracteres', async () => {
    const res = (await handler(evento({ notas: 'x'.repeat(2001) }))) as Respuesta;
    expect(res.statusCode).toBe(400);
  });

  test('registrar pago recalcula saldo, cierra estado y sube la versión', async () => {
    const getUpdate = mockTabla(item);
    const res = (await handler(evento({ pago: { monto: 800, metodo: 'transferencia' } }))) as Respuesta;

    expect(res.statusCode).toBe(200);
    const input = getUpdate()!;
    const v = input.ExpressionAttributeValues!;
    expect(v[':saldo']).toBe(0);
    expect(v[':estado']).toBe('pagada_completa');
    expect(v[':nuevaVersion']).toBe(4);
    expect((v[':edit'] as { por: string }).por).toBe('staff@randomtrips.co');
    expect(input.ConditionExpression).toContain('#version = :versionActual');
  });

  test('reserva legacy sin montoPagado ni version: no produce NaN y estrena version 1', async () => {
    const { montoPagado, saldoPendiente, version, ...legacy } = item;
    void montoPagado;
    void saldoPendiente;
    void version;
    const getUpdate = mockTabla(legacy);

    const res = (await handler(evento({ notas: 'seguimiento' }))) as Respuesta;

    expect(res.statusCode).toBe(200);
    const v = getUpdate()!.ExpressionAttributeValues!;
    expect(Number.isFinite(v[':saldo'] as number)).toBe(true);
    expect(v[':saldo']).toBe(1000); // total 1000 - pagado 0
    expect(v[':nuevaVersion']).toBe(1);
  });

  test('409 cuando otra edición ganó la carrera (condición de versión falla)', async () => {
    sendMock.mockImplementation((cmd: unknown) => {
      if (cmd instanceof GetCommand) return Promise.resolve({ Item: item });
      return Promise.reject(
        new ConditionalCheckFailedException({ message: 'conditional failed', $metadata: {} })
      );
    });

    const res = (await handler(evento({ notas: 'x' }))) as Respuesta;
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Otra persona');
  });
});
