import * as cdk from 'aws-cdk-lib/core';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface DnsStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Hosted Zone de Route 53 del entorno.
 *
 * Arquitectura multi-cuenta:
 *   - prod: zona raíz (randomtrips.co). Sus 4 name servers van en el registrar
 *     externo (Namecheap). Además delega subzonas con registros NS
 *     (config.delegations, ej. dev → NS de la zona dev).
 *   - dev: subzona dev.randomtrips.co. Sus NS se pegan en DEV_ZONE_NS (.env)
 *     y se redespliega el DnsStack de prod para crear la delegación.
 *
 * Cuando la cadena resuelva públicamente (dig NS <zona>), activar
 * config.enableCustomDomains para api.<dominio> (certificado ACM + custom
 * domain del API Gateway, ver ApiStack).
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

    for (const delegation of config.delegations ?? []) {
      new route53.NsRecord(this, `Delegacion-${delegation.subdomain}`, {
        zone: this.hostedZone,
        recordName: delegation.subdomain,
        values: delegation.nameServers,
        ttl: cdk.Duration.hours(1),
      });
    }

    new cdk.CfnOutput(this, 'NameServers', {
      value: cdk.Fn.join(', ', this.hostedZone.hostedZoneNameServers ?? []),
      description: 'NS de esta zona: al registrar externo (prod) o a DEV_ZONE_NS de prod (dev)',
    });
  }
}
