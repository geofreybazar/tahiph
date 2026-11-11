import { z } from 'zod';

// Lower-case hostname without scheme or port.
const hostname = z
  .string()
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/,
    'must be a lower-case hostname',
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /** Express `trust proxy` setting: hop count, or comma-separated names/subnets. */
  TRUST_PROXY: z.string().min(1).default('loopback'),
  /** Dashboard host (tenant staff realm), e.g. app.tahi.ph. */
  APP_HOST: hostname,
  /** Platform admin host, e.g. admin.tahi.ph. */
  ADMIN_HOST: hostname,
  /** Webhook ingress host, e.g. api.tahi.ph. Every other host is a storefront. */
  API_HOST: hostname,
});

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

/** Validates process environment at boot. Fails fast; never logs secret values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}
