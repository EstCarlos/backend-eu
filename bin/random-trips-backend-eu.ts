#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { getEnvironmentConfig } from '../lib/config/environments';
import { DataStack } from '../lib/stacks/data-stack';
import { MediaStack } from '../lib/stacks/media-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { DnsStack } from '../lib/stacks/dns-stack';

const app = new cdk.App();

// `cdk deploy -c env=prod` para producción; sin flag despliega a la cuenta dev.
const config = getEnvironmentConfig(app.node.tryGetContext('env') ?? 'dev');

const data = new DataStack(app, 'RandomTrips-Data', { env: config.env, config });
const media = new MediaStack(app, 'RandomTrips-Media', { env: config.env, config });

const dns = config.domainName
  ? new DnsStack(app, 'RandomTrips-Dns', { env: config.env, config })
  : undefined;

new ApiStack(app, 'RandomTrips-Api', {
  env: config.env,
  config,
  table: data.table,
  mediaBucket: media.bucket,
  cdnDomainName: media.distribution.distributionDomainName,
  hostedZone: dns?.hostedZone,
});

cdk.Tags.of(app).add('project', 'random-trips');
cdk.Tags.of(app).add('environment', config.name);
