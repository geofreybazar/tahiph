import { setupStorage } from '../src/cli/setup-storage.js';
import './setup-env.js';

/** Integration project: the uploads bucket must exist before any spec confirms an upload. */
export default async function setup(): Promise<void> {
  const e = process.env;
  await setupStorage(
    {
      S3_ENDPOINT: e.S3_ENDPOINT!,
      S3_REGION: e.S3_REGION ?? 'auto',
      S3_BUCKET: e.S3_BUCKET!,
      S3_ACCESS_KEY_ID: e.S3_ACCESS_KEY_ID!,
      S3_SECRET_ACCESS_KEY: e.S3_SECRET_ACCESS_KEY!,
    },
    ['http://app.tahi.test'],
  );
}
