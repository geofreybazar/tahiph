const host = process.env.TEST_DB_HOST ?? '127.0.0.1:54322';

export const TEST_DATABASE = 'tahi_test';
export const ADMIN_URL = `postgresql://postgres:postgres@${host}/postgres`;
export const ADMIN_TEST_URL = `postgresql://postgres:postgres@${host}/${TEST_DATABASE}`;
export const MIGRATOR_URL = `postgresql://tahi_migrator:local_only_migrator@${host}/${TEST_DATABASE}`;
export const API_URL = `postgresql://tahi_api:local_only_api@${host}/${TEST_DATABASE}`;
