import * as cdk from 'aws-cdk-lib/core';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface DataStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Stack stateful: tabla DynamoDB única (single-table design).
 *
 * Modelo de datos:
 *   Reserva:  PK=RESERVA#<id>   SK=META   GSI1PK=RESERVA   GSI1SK=<fecha ISO>
 *   Mensaje:  PK=MENSAJE#<id>   SK=META   GSI1PK=MENSAJE   GSI1SK=<fecha ISO>
 *   Lock de idempotencia PayPal: PK=PAYPAL#<orderId> SK=META (guarda reservaId)
 *
 * GSI1 permite listar reservas/mensajes ordenados por fecha sin scan.
 */
export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.table = new dynamodb.Table(this, 'Table', {
      tableName: 'random-trips',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: config.retainData
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, 'TableName', { value: this.table.tableName });
  }
}
