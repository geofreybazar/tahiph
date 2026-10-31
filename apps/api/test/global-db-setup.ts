import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { MIGRATOR_URL, ADMIN_URL, TEST_DATABASE } from './db-urls';

/** Recreates the test database and applies migrations the same way a deploy does. */
export default async function setup() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DATABASE} OWNER tahi_migrator`);
  await admin.end();

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DIRECT_URL: MIGRATOR_URL },
    stdio: 'pipe',
  });
}
