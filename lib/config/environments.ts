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
  /** Email verificado en SES que recibe avisos de reservas y mensajes. */
  notificationEmail: string;
  /** Base URL del API de PayPal: Sandbox en dev, Live en prod. */
  paypalApiBase: string;
  /** Dominio raíz (ej. randomtrips.com). Si está definido se crea la Hosted Zone. */
  domainName?: string;
  /** Activar api.<dominio> / cdn.<dominio>. Solo cuando la delegación NS esté verificada. */
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
        allowedOrigins: ['http://localhost:3000'],
        notificationEmail: requiredEnv('NOTIFICATION_EMAIL'),
        paypalApiBase: 'https://api-m.sandbox.paypal.com',
        domainName: process.env.DOMAIN_NAME || undefined,
        enableCustomDomains: false,
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
        paypalApiBase: 'https://api-m.paypal.com',
        domainName: process.env.DOMAIN_NAME || undefined,
        enableCustomDomains: false,
        retainData: true,
      };
    default:
      throw new Error(`Entorno desconocido: "${name}" (usar -c env=dev|prod)`);
  }
}
