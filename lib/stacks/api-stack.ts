import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
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

    const { config, table, mediaBucket, cdnDomainName } = props;

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

    // La identidad manda un email de verificación al desplegar; hasta hacer
    // click en ese link, SES rechaza los envíos (los handlers lo toleran).
    const emailIdentity = new ses.EmailIdentity(this, 'NotificationEmail', {
      identity: ses.Identity.email(config.notificationEmail),
    });

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
      },
    });
    table.grantWriteData(contactoFn);
    emailIdentity.grantSendEmail(contactoFn);

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
        PAYPAL_API_BASE: config.paypalApiBase,
        PAYPAL_CLIENT_ID_PARAM: paypalClientIdParam,
        PAYPAL_CLIENT_SECRET_PARAM: paypalClientSecretParam,
      },
    });
    table.grantReadWriteData(captureOrderFn);
    paypalClientId.grantRead(captureOrderFn);
    paypalClientSecret.grantRead(captureOrderFn);
    emailIdentity.grantSendEmail(captureOrderFn);

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

    new cdk.CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
