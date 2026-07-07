# Random Trips — Backend serverless (AWS CDK)

Backend de la landing [random-trips-web](../random-trips-web): reservas con PayPal, mensajes de contacto, catálogo de planes y galería de fotos servida desde S3/CloudFront. 100% serverless, definido con AWS CDK (TypeScript).

## Arquitectura

```
Next.js (Vercel) ──HTTPS──> API Gateway HTTP API ──> Lambdas Node 22 (ARM) ──> DynamoDB (single-table)
                                                        │                  └──> SES (email al equipo)
                                                        └──> PayPal REST (creds en SSM SecureString)
Fotos:  navegador ──> CloudFront (OAC) ──> S3 media bucket      (GET /galeria lista el bucket)
DNS:    Route 53 Hosted Zone (NS → registrar externo) — opcional, flag DOMAIN_NAME
```

### Stacks

Cada entorno vive en su **propia cuenta AWS** (`DEV_ACCOUNT` / `PROD_ACCOUNT` en `.env`), así que los recursos usan los mismos nombres en ambas. El deploy elige el entorno con `-c env=dev|prod` (default `dev`); la config solo cambia comportamiento (PayPal Sandbox vs Live, retención de datos, CORS).

| Stack | Tipo | Contenido |
|---|---|---|
| `RandomTrips-Data` | stateful | Tabla DynamoDB `random-trips` (PK/SK + GSI1, on-demand, PITR) |
| `RandomTrips-Media` | stateful | Bucket S3 de fotos (privado) + CloudFront con Origin Access Control |
| `RandomTrips-Api` | stateless | HTTP API + 5 Lambdas + identidad SES + refs a parámetros SSM |
| `RandomTrips-Dns` | opcional | Hosted Zone de Route 53 (solo si `DOMAIN_NAME` está definido) |

Los stacks stateful están separados para poder destruir/redesplegar el API sin tocar datos. En dev los datos se borran con el stack (`retainData: false`); en prod se retienen.

### Endpoints (mismo contrato que las API routes del frontend)

| Ruta | Request | Response OK |
|---|---|---|
| `POST /contacto` | `{ nombre, email, mensaje }` | `{ ok: true }` |
| `POST /paypal/create-order` | `{ planId, viajeros: string[] }` | `{ id }` |
| `POST /paypal/capture-order` | `{ orderId, planId, viajeros, contacto }` | `{ ok: true, reservaId }` |
| `GET /galeria` | — | `Record<diaId, url[]>` (URLs CloudFront) |
| `GET /planes` | — | `Plan[]` |

Reglas clave:
- El SDK de PayPal del navegador (`@paypal/react-paypal-js`) solo pinta los botones; **crear la orden y capturar el pago usan el Client Secret y el precio real**, por eso viven en estos 2 endpoints de servidor (antes eran las API routes de Next en Vercel).
- El total de PayPal se **recalcula siempre en servidor** desde `src/shared/planes.ts` (fuente de verdad de precios); nunca se confía en el monto del cliente.
- La captura es **idempotente**: un lock `PK=PAYPAL#<orderId>` se escribe en la misma transacción que la reserva; los reintentos devuelven la reserva existente en vez de duplicarla.
- Las notificaciones SES son best-effort: si fallan, la reserva/mensaje ya quedó persistido y el request no falla.

### Modelo de datos (single-table)

| Entidad | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Reserva | `RESERVA#<id>` | `META` | `RESERVA` | `<fecha ISO>` |
| Mensaje | `MENSAJE#<id>` | `META` | `MENSAJE` | `<fecha ISO>` |
| Lock PayPal | `PAYPAL#<orderId>` | `META` | — | — |

Listar reservas por fecha: `Query GSI1 WHERE GSI1PK = 'RESERVA'` (orden por `GSI1SK`).

### Bucket de fotos — convención de keys

```
galeria/<dia-id>/<foto>   ← dia-1 … dia-9; las lista GET /galeria
landing/<foto>            ← imágenes sueltas de la landing
```

## Puesta en marcha (dev)

### 1. Prerrequisitos

- Node 20+, AWS CLI con credenciales de la cuenta dev
- `cp .env.example .env` y completar `DEV_ACCOUNT` y `NOTIFICATION_EMAIL`
- `npm install`

### 2. Bootstrap de CDK (una sola vez por cuenta/región)

```bash
npx cdk bootstrap aws://<DEV_ACCOUNT>/us-east-1
```

### 3. Credenciales PayPal en SSM (una sola vez)

Con los valores Sandbox de `credentials_paypal.json` del frontend (nunca commitearlos):

```bash
aws ssm put-parameter --name /random-trips/paypal/client-id --type SecureString --value "<CLIENT_ID>"
aws ssm put-parameter --name /random-trips/paypal/client-secret --type SecureString --value "<CLIENT_SECRET>"
```

### 4. Deploy

```bash
npm run build && npm test    # compila + tests de infraestructura
npx cdk synth                # revisar los templates
npx cdk deploy --all         # Data → Media → Api (el orden lo resuelve CDK)
```

Sin flags despliega al entorno **dev** (`DEV_ACCOUNT`); para producción: `npx cdk deploy --all -c env=prod` (requiere credenciales de la cuenta prod).

Outputs importantes: `ApiUrl`, `CdnDomainName`, `MediaBucketName`.

### 5. Post-deploy manual

1. **SES**: llega un email de verificación a `NOTIFICATION_EMAIL` — hacer click en el link. Hasta entonces SES rechaza envíos (la API sigue funcionando; solo no llegan avisos). La cuenta empieza en sandbox de SES: alcanza porque remitente y destinatario son el mismo email verificado.
2. **Fotos**: subirlas desde el frontend (idealmente **optimizarlas antes** — hay originales de 20–33 MB que castigan costo y LCP):
   ```bash
   cd ../random-trips-web
   aws s3 sync public/images/galeria s3://<MediaBucketName>/galeria/
   aws s3 sync public/images s3://<MediaBucketName>/landing/ --exclude "galeria/*"
   ```

### Smoke test

```bash
API=<ApiUrl>
curl -s $API/planes
curl -s $API/galeria
curl -s -X POST $API/contacto -H "content-type: application/json" \
  -d '{"nombre":"Prueba","email":"prueba@example.com","mensaje":"Hola"}'
curl -s -X POST $API/paypal/create-order -H "content-type: application/json" \
  -d '{"planId":"plan-1","viajeros":["Ana","Luis"]}'   # → { "id": "..." } y orden Sandbox por $1798.00
```

Verificar el item en DynamoDB: `aws dynamodb scan --table-name random-trips --max-items 5`.

## Dominio propio (pendiente de delegación)

1. Definir `DOMAIN_NAME=<dominio>` en `.env` y desplegar → se crea la Hosted Zone (`RandomTrips-Dns`).
2. Copiar los 4 name servers del output `NameServers` en el registrar externo.
3. Verificar la delegación (`dig NS <dominio>`); puede tardar horas.
4. Recién entonces: poner `enableCustomDomains: true` en `lib/config/environments.ts` e implementar los custom domains (`api.<dominio>` en el HTTP API, `cdn.<dominio>` en CloudFront, certificados ACM en us-east-1 con validación DNS). — TODO cuando la delegación esté activa.

## Producción (cuando toque)

1. Completar los `allowedOrigins` de prod en `lib/config/environments.ts` (dominio real del frontend).
2. Con credenciales de la cuenta prod: `npx cdk bootstrap aws://<PROD_ACCOUNT>/us-east-1`.
3. Crear en la cuenta prod los parámetros SSM `/random-trips/paypal/*` con credenciales **Live** de PayPal.
4. `npx cdk deploy --all -c env=prod`.
5. Para volumen real de emails, sacar SES del sandbox (request de producción en la consola SES).

## Migración del frontend (fase siguiente, no incluida aquí)

1. `NEXT_PUBLIC_API_BASE=<ApiUrl>` en Vercel/.env.local del frontend.
2. `components/reserva/PagoPaypal.tsx` y `components/sections/Contacto.tsx`: cambiar los `fetch("/api/…")` por `` fetch(`${NEXT_PUBLIC_API_BASE}/…`) `` — los shapes de request/response son idénticos.
3. `lib/galeria.ts`: reemplazar `fs.readdirSync` por `` fetch(`${API_BASE}/galeria`, { next: { revalidate: 3600 } }) ``.
4. `next.config`: agregar `images.remotePatterns` con el dominio de CloudFront.
5. Borrar `app/api/`, `lib/reservas/store.ts`, `lib/mensajes/store.ts` y `public/images/galeria/` (~456 MB fuera del repo).

## Estructura

```
bin/random-trips-backend-eu.ts      entry point (elige entorno con -c env=dev|prod)
lib/config/environments.ts          configuración por entorno (.env: cuentas, email, dominio)
lib/stacks/{data,media,api,dns}-stack.ts
src/handlers/                       5 Lambdas (contacto, paypal-*, galeria, planes)
src/shared/                         tipos, planes (precios), cliente PayPal, helpers ddb/ses/http
test/stacks.test.ts                 assertions de infraestructura (Template.fromStack)
```

## Comandos

- `npm run build` — compila TypeScript
- `npm test` — tests de infraestructura (jest)
- `npx cdk synth` / `diff` / `deploy --all` / `destroy`
