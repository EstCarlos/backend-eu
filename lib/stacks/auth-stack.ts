import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface AuthStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Stack stateful: User Pool de Cognito para el panel admin (staff).
 *
 * Login passwordless por código de un solo uso al email (EMAIL_OTP):
 *   - featurePlan ESSENTIALS: requisito de AWS para el email OTP nativo.
 *   - allowedFirstAuthFactors.emailOtp: habilita el flujo "correo → código".
 *   - selfSignUp desactivado: solo el staff dado de alta a mano (consola
 *     Cognito) puede entrar; nadie se registra solo.
 *   - Los OTP los envía Cognito con su remitente por defecto (tope 50/día,
 *     de sobra para el staff). Migrar a SES si se quiere remitente con marca.
 *
 * El App Client es público (SPA de navegador, sin secret) y usa el flujo
 * USER_AUTH (authFlows.user) que exige la autenticación por elección de factor.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.userPool = new cognito.UserPool(this, 'AdminUserPool', {
      userPoolName: 'random-trips-admin',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      mfa: cognito.Mfa.OFF,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      signInPolicy: {
        allowedFirstAuthFactors: { password: true, emailOtp: true },
      },
      removalPolicy: config.retainData
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('AdminPanelClient', {
      userPoolClientName: 'random-trips-admin-panel',
      generateSecret: false,
      authFlows: { user: true },
      // false (no el default recomendado por AWS) a propósito: este es un
      // panel interno de 2-3 personas del staff, no un producto público con
      // sign-up abierto. El beneficio de decirle de inmediato a alguien que
      // su correo no está autorizado pesa más que ocultar qué emails existen.
      preventUserExistenceErrors: false,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
    });
  }
}
