import { resolve } from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// The monorepo keeps one .env at the root; Next only looks in the app folder by default.
const root = resolve(process.cwd(), '../..');
// forceReload: Next has already loaded (and cached) the app folder's env by this point.
loadEnvConfig(root, process.env.NODE_ENV !== 'production', console, true);

const config: NextConfig = { turbopack: { root } };

export default config;
