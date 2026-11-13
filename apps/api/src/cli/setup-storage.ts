import {
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Env } from '../core/config/env.js';

export type StorageSetupEnv = Pick<
  Env,
  'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY'
>;

/**
 * Creates the bucket with the settings uploads rely on (ADR-031): browser CORS for the dashboard
 * origin, and a rule expiring unconfirmed uploads under pending/ after a day. Idempotent.
 * Local RustFS and CI only; the production R2 bucket is configured once by hand (DEPLOYMENT.md).
 */
export async function setupStorage(env: StorageSetupEnv, corsOrigins: string[]): Promise<void> {
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  const Bucket = env.S3_BUCKET;
  try {
    try {
      await s3.send(new CreateBucketCommand({ Bucket }));
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw e;
    }
    await s3.send(
      new PutBucketCorsCommand({
        Bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: corsOrigins,
              AllowedMethods: ['PUT', 'GET'],
              AllowedHeaders: ['content-type'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    await s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'expire-unconfirmed-uploads',
              Status: 'Enabled',
              Filter: { Prefix: 'pending/' },
              Expiration: { Days: 1 },
            },
          ],
        },
      }),
    );
  } finally {
    s3.destroy();
  }
}
