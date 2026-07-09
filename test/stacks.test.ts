import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { EnvironmentConfig } from '../lib/config/environments';
import { DataStack } from '../lib/stacks/data-stack';
import { MediaStack } from '../lib/stacks/media-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { DnsStack } from '../lib/stacks/dns-stack';

const testConfig: EnvironmentConfig = {
  name: 'dev',
  env: { account: '123456789012', region: 'us-east-1' },
  allowedOrigins: ['http://localhost:3000'],
  notificationEmail: 'equipo@example.com',
  paypalApiBase: 'https://api-m.sandbox.paypal.com',
  domainName: 'example.com',
  enableCustomDomains: false,
  retainData: false,
};

function buildStacks() {
  const app = new cdk.App();
  const data = new DataStack(app, 'TestData', { env: testConfig.env, config: testConfig });
  const media = new MediaStack(app, 'TestMedia', { env: testConfig.env, config: testConfig });
  const auth = new AuthStack(app, 'TestAuth', { env: testConfig.env, config: testConfig });
  const api = new ApiStack(app, 'TestApi', {
    env: testConfig.env,
    config: testConfig,
    table: data.table,
    mediaBucket: media.bucket,
    cdnDomainName: media.distribution.distributionDomainName,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
  });
  return { data, media, auth, api };
}

describe('DataStack', () => {
  const template = Template.fromStack(buildStacks().data);

  test('tabla on-demand con PITR y GSI1', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        Match.objectLike({ IndexName: 'GSI1' }),
      ],
    });
  });

  test('en dev la tabla se borra con el stack (retainData=false)', () => {
    template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete' });
  });
});

describe('MediaStack', () => {
  const template = Template.fromStack(buildStacks().media);

  test('bucket sin acceso público y con SSL forzado', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      }),
    });
  });

  test('CloudFront solo HTTPS con Origin Access Control', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    });
  });
});

describe('ApiStack', () => {
  const template = Template.fromStack(buildStacks().api);

  test('expone las rutas públicas y las de admin', () => {
    for (const routeKey of [
      'POST /contacto',
      'POST /paypal/create-order',
      'POST /paypal/capture-order',
      'GET /galeria',
      'GET /planes',
      'GET /admin/reservas',
      'PATCH /admin/reservas/{id}',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: routeKey,
      });
    }
    // 5 públicas + 2 admin. El authorizer de Cognito es JWT nativo (sin Lambda).
    template.resourceCountIs('AWS::Lambda::Function', 7);
  });

  test('las rutas admin exigen el authorizer JWT de Cognito', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
    });
    for (const routeKey of ['GET /admin/reservas', 'PATCH /admin/reservas/{id}']) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: routeKey,
        AuthorizationType: 'JWT',
      });
    }
  });

  test('CORS restringido a los orígenes configurados', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ['http://localhost:3000'],
      }),
    });
  });

  test('throttling en el stage por defecto', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: {
        ThrottlingRateLimit: 10,
        ThrottlingBurstLimit: 20,
      },
    });
  });

  test('la Lambda de contacto no puede leer la tabla (mínimo privilegio)', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const contactoPolicy = Object.entries(policies).find(([name]) =>
      name.startsWith('ContactoFn')
    );

    expect(contactoPolicy).toBeDefined();
    const statements: Array<{ Action: string | string[] }> =
      contactoPolicy![1].Properties.PolicyDocument.Statement;
    const actions = statements.flatMap((s) =>
      Array.isArray(s.Action) ? s.Action : [s.Action]
    );

    expect(actions).toContain('dynamodb:PutItem');
    expect(actions).not.toContain('dynamodb:GetItem');
    expect(actions).not.toContain('dynamodb:Query');
    expect(actions).not.toContain('ssm:GetParameters');
  });

  test('funciones en ARM con Node 22', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Architectures: ['arm64'],
      Runtime: 'nodejs22.x',
    });
  });
});

describe('DnsStack', () => {
  test('crea la hosted zone del dominio', () => {
    const app = new cdk.App();
    const stack = new DnsStack(app, 'TestDns', { env: testConfig.env, config: testConfig });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Route53::HostedZone', {
      Name: 'example.com.',
    });
  });
});
