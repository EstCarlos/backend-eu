import * as cdk from 'aws-cdk-lib/core';
import * as dotenv from 'dotenv';

dotenv.config({ override: true, quiet: true });

/**
 * Cada entorno vive en su propia cuenta AWS (DEV_ACCOUNT / PROD_ACCOUNT en
 * .env), así que los recursos usan los mismos nombres en ambas: la cuenta ya
 * separa los entornos. Esta config solo decide a qué cuenta apunta el deploy
 * y las diferencias de comportamiento (PayPal Sandbox vs Live, retención).
 *
 * Selección al desplegar: `cdk deploy -c env=prod` (default: dev).
 */

export type EnvironmentName = 'dev' | 'prod';

export type EnvironmentConfig = {
  name: EnvironmentName;
  env: cdk.Environment;
  /** Orígenes permitidos en CORS del API (frontend local + deploy). */
  allowedOrigins: string[];
  /** Buzón real del equipo que recibe avisos de reservas y mensajes. */
  notificationEmail: string;
  /**
   * Remitente de los avisos, sobre el dominio raíz verificado en SES
   * (notifications@randomtrips.co). La identidad de dominio se creó por CLI
   * en ambas cuentas; sus registros DKIM viven en la zona Route 53 de prod.
   */
  sesFromEmail?: string;
  /** Base URL del API de PayPal: Sandbox en dev, Live en prod. */
  paypalApiBase: string;
  /**
   * Dominio de la zona de este entorno: la raíz (randomtrips.co) vive en la
   * cuenta prod; dev usa la subzona dev.randomtrips.co delegada desde prod.
   */
  domainName?: string;
  /**
   * Subzonas delegadas desde esta zona (solo prod): registros NS que apuntan
   * a los name servers de la zona del otro entorno. Los NS de la zona dev se
   * pegan en DEV_ZONE_NS (.env, separados por coma) tras desplegar su DnsStack.
   */
  delegations?: Array<{ subdomain: string; nameServers: string[] }>;
  /** Activar api.<dominio>. Solo cuando la delegación NS esté verificada. */
  enableCustomDomains: boolean;
  /** true = los datos (DynamoDB, S3) sobreviven a un cdk destroy. Siempre true en prod. */
  retainData: boolean;
};

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getEnvironmentConfig(name: string): EnvironmentConfig {
  switch (name) {
    case 'dev':
      return {
        name: 'dev',
        env: {
          account: requiredEnv('DEV_ACCOUNT'),
          region: 'us-east-1',
        },
        allowedOrigins: [
          'http://localhost:3000',
          // Panel admin (Vite) en local
          'http://localhost:5173',
          // Deploy del branch develop del frontend en Amplify
          'https://develop.d18bm59xzbcrzh.amplifyapp.com',
          // TODO: URL del panel admin en Amplify (añadir tras el primer deploy)
        ],
        notificationEmail: requiredEnv('NOTIFICATION_EMAIL'),
        sesFromEmail: process.env.DOMAIN_NAME
          ? `notifications@${process.env.DOMAIN_NAME}`
          : undefined,
        paypalApiBase: 'https://api-m.sandbox.paypal.com',
        domainName: process.env.DOMAIN_NAME
          ? `dev.${process.env.DOMAIN_NAME}`
          : undefined,
        enableCustomDomains: true,
        retainData: false,
      };
    case 'prod':
      return {
        name: 'prod',
        env: {
          account: requiredEnv('PROD_ACCOUNT'),
          region: 'us-east-1',
        },
        allowedOrigins: [], // TODO: dominio real del frontend en producción
        notificationEmail: requiredEnv('NOTIFICATION_EMAIL'),
        sesFromEmail: process.env.DOMAIN_NAME
          ? `notifications@${process.env.DOMAIN_NAME}`
          : undefined,
        paypalApiBase: 'https://api-m.paypal.com',
        domainName: process.env.DOMAIN_NAME || undefined,
        delegations: process.env.DEV_ZONE_NS
          ? [
              {
                subdomain: 'dev',
                nameServers: process.env.DEV_ZONE_NS.split(',').map((ns) => ns.trim()),
              },
            ]
          : [],
        enableCustomDomains: true,
        retainData: true,
      };
    default:
      throw new Error(`Entorno desconocido: "${name}" (usar -c env=dev|prod)`);
  }
}
