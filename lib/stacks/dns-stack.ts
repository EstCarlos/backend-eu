import * as cdk from 'aws-cdk-lib/core';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface DnsStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Hosted Zone de Route 53 para el dominio comprado fuera de AWS.
 * Solo se instancia si config.domainName está definido (DOMAIN_NAME en .env).
 *
 * Tras el deploy, copiar los 4 name servers del output NameServers en el
 * registrar externo. Cuando la delegación esté verificada (dig NS <dominio>),
 * activar config.enableCustomDomains para api.<dominio> / cdn.<dominio>
 * (certificados ACM + custom domains — TODO, ver README).
 */
export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.PublicHostedZone;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const { config } = props;

    if (!config.domainName) {
      throw new Error('DnsStack requiere config.domainName');
    }

    this.hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
      zoneName: config.domainName,
      comment: 'Random Trips',
    });

    new cdk.CfnOutput(this, 'NameServers', {
      value: cdk.Fn.join(', ', this.hostedZone.hostedZoneNameServers ?? []),
      description: 'Configurar estos NS en el registrar del dominio',
    });
  }
}
