import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface MediaStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Stack stateful: bucket S3 de fotos + CloudFront con Origin Access Control.
 *
 * Convención de keys (espejo de public/images del frontend):
 *   galeria/<dia-id>/<foto>   (dia-1 … dia-9) — las lista GET /galeria
 *   landing/<foto>            — imágenes sueltas de la landing
 *
 * El bucket nunca es público; solo CloudFront puede leerlo (OAC).
 */
export class MediaStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: MediaStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.bucket = new s3.Bucket(this, 'MediaBucket', {
      // La cuenta en el nombre garantiza unicidad global sin sufijo de entorno.
      bucketName: `random-trips-media-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
      ],
      removalPolicy: config.retainData
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.retainData,
    });

    this.distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'Random Trips media',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    new cdk.CfnOutput(this, 'MediaBucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'CdnDomainName', {
      value: this.distribution.distributionDomainName,
    });
  }
}
