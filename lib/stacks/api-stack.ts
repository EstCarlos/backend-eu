import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface ApiStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  table: dynamodb.ITable;
  mediaBucket: s3.IBucket;
  cdnDomainName: string;
  /** Zona del entorno (DnsStack); requerida solo con enableCustomDomains. */
  hostedZone?: route53.IHostedZone;
}

/**
 * Stack stateless: HTTP API + Lambdas. Se puede destruir y redesplegar
 * sin tocar datos (DataStack/MediaStack).
 *
 * Rutas (mismo contrato que las API routes de random-trips-web):
 *   POST /contacto
 *   POST /paypal/create-order
 *   POST /paypal/capture-order
 *   GET  /galeria
 *   GET  /planes
 */
export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config, table, mediaBucket, cdnDomainName, hostedZone } = props;

    // Los valores de estos parámetros se crean a mano (SecureString, ver README);
    // aquí solo se referencian para dar permiso de lectura a las Lambdas PayPal.
    const paypalClientIdParam = '/random-trips/paypal/client-id';
    const paypalClientSecretParam = '/random-trips/paypal/client-secret';

    const paypalClientId = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      'PaypalClientIdParam',
      { parameterName: paypalClientIdParam }
    );
    const paypalClientSecret = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      'PaypalClientSecretParam',
      { parameterName: paypalClientSecretParam }
    );

    // Identidad del BUZÓN destinatario (manda email de verificación al
    // desplegar — click obligatorio): necesaria mientras la cuenta esté en
    // sandbox de SES, donde el destinatario también debe estar verificado.
    const emailIdentity = new ses.EmailIdentity(this, 'NotificationEmail', {
      identity: ses.Identity.email(config.notificationEmail),
    });

    // El REMITENTE es la identidad de dominio (notifications@<dominio raíz>),
    // creada por CLI fuera de CDK con sus DKIM en la zona de prod: dar permiso
    // de envío sobre ella a las Lambdas que notifican.
    const sesFromDomain = config.sesFromEmail?.split('@')[1];
    const enviarComoDominio = sesFromDomain
      ? new iam.PolicyStatement({
          actions: ['ses:SendEmail'],
          resources: [
            `arn:aws:ses:${this.region}:${this.account}:identity/${sesFromDomain}`,
          ],
        })
      : undefined;

    const makeFunction = (
      name: string,
      entry: string,
      options?: { timeout?: cdk.Duration; environment?: Record<string, string> }
    ): NodejsFunction => {
      // El logGroup va como prop: con el flag useCdkManagedLogGroup activo,
      // la función crearía el suyo propio y un LogGroup suelto con el mismo
      // nombre chocaría contra él ("already exists" dentro del mismo stack).
      return new NodejsFunction(this, name, {
        functionName: `random-trips-${entry}`,
        entry: path.join(__dirname, '..', '..', 'src', 'handlers', `${entry}.ts`),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: options?.timeout ?? cdk.Duration.seconds(10),
        environment: options?.environment,
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          logGroupName: `/aws/lambda/random-trips-${entry}`,
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['@aws-sdk/*'], // el runtime Node 22 ya trae SDK v3
        },
      });
    };

    const contactoFn = makeFunction('ContactoFn', 'contacto', {
      environment: {
        TABLE_NAME: table.tableName,
        NOTIFICATION_EMAIL: config.notificationEmail,
        ...(config.sesFromEmail ? { SES_FROM: config.sesFromEmail } : {}),
      },
    });
    table.grantWriteData(contactoFn);
    emailIdentity.grantSendEmail(contactoFn);
    if (enviarComoDominio) {
      contactoFn.addToRolePolicy(enviarComoDominio);
    }

    const createOrderFn = makeFunction('CreateOrderFn', 'paypal-create-order', {
      timeout: cdk.Duration.seconds(15),
      environment: {
        PAYPAL_API_BASE: config.paypalApiBase,
        PAYPAL_CLIENT_ID_PARAM: paypalClientIdParam,
        PAYPAL_CLIENT_SECRET_PARAM: paypalClientSecretParam,
      },
    });
    paypalClientId.grantRead(createOrderFn);
    paypalClientSecret.grantRead(createOrderFn);

    const captureOrderFn = makeFunction('CaptureOrderFn', 'paypal-capture-order', {
      timeout: cdk.Duration.seconds(15),
      environment: {
        TABLE_NAME: table.tableName,
        NOTIFICATION_EMAIL: config.notificationEmail,
        ...(config.sesFromEmail ? { SES_FROM: config.sesFromEmail } : {}),
        PAYPAL_API_BASE: config.paypalApiBase,
        PAYPAL_CLIENT_ID_PARAM: paypalClientIdParam,
        PAYPAL_CLIENT_SECRET_PARAM: paypalClientSecretParam,
      },
    });
    table.grantReadWriteData(captureOrderFn);
    paypalClientId.grantRead(captureOrderFn);
    paypalClientSecret.grantRead(captureOrderFn);
    emailIdentity.grantSendEmail(captureOrderFn);
    if (enviarComoDominio) {
      captureOrderFn.addToRolePolicy(enviarComoDominio);
    }

    const galeriaFn = makeFunction('GaleriaFn', 'galeria', {
      environment: {
        MEDIA_BUCKET: mediaBucket.bucketName,
        CDN_DOMAIN: cdnDomainName,
      },
    });
    mediaBucket.grantRead(galeriaFn);

    const planesFn = makeFunction('PlanesFn', 'planes');

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'random-trips',
      corsPreflight: {
        allowOrigins: config.allowedOrigins,
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['content-type'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    const routes: Array<[apigwv2.HttpMethod, string, NodejsFunction]> = [
      [apigwv2.HttpMethod.POST, '/contacto', contactoFn],
      [apigwv2.HttpMethod.POST, '/paypal/create-order', createOrderFn],
      [apigwv2.HttpMethod.POST, '/paypal/capture-order', captureOrderFn],
      [apigwv2.HttpMethod.GET, '/galeria', galeriaFn],
      [apigwv2.HttpMethod.GET, '/planes', planesFn],
    ];

    for (const [method, routePath, fn] of routes) {
      this.httpApi.addRoutes({
        path: routePath,
        methods: [method],
        integration: new HttpLambdaIntegration(`${fn.node.id}Integration`, fn),
      });
    }

    // Throttling básico anti-abuso (es una landing, no un API de alto tráfico).
    const defaultStage = this.httpApi.defaultStage!.node.defaultChild as apigwv2.CfnStage;
    defaultStage.defaultRouteSettings = {
      throttlingRateLimit: 10,
      throttlingBurstLimit: 20,
    };

    // Custom domain api.<dominio>: solo cuando la delegación DNS de la zona ya
    // resuelve públicamente — la validación del certificado ACM es por DNS y
    // se quedaría colgada (hasta timeout del deploy) con una zona sin delegar.
    if (config.enableCustomDomains) {
      if (!hostedZone || !config.domainName) {
        throw new Error('enableCustomDomains requiere DnsStack (domainName) desplegado');
      }

      const apiDomainName = `api.${config.domainName}`;

      const certificate = new acm.Certificate(this, 'ApiCertificate', {
        domainName: apiDomainName,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });

      const apiDomain = new apigwv2.DomainName(this, 'ApiDomain', {
        domainName: apiDomainName,
        certificate,
      });

      new apigwv2.ApiMapping(this, 'ApiMapping', {
        api: this.httpApi,
        domainName: apiDomain,
      });

      new route53.ARecord(this, 'ApiAliasRecord', {
        zone: hostedZone,
        recordName: 'api',
        target: route53.RecordTarget.fromAlias(
          new targets.ApiGatewayv2DomainProperties(
            apiDomain.regionalDomainName,
            apiDomain.regionalHostedZoneId
          )
        ),
      });

      new cdk.CfnOutput(this, 'ApiCustomDomain', { value: `https://${apiDomainName}` });
    }

    new cdk.CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
