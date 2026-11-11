import { z } from 'zod';
import { SecretBox } from '../crypto/secret-box.js';

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
  /** Storefront subdomains are {slug}.{STOREFRONT_ROOT_DOMAIN}, e.g. tahi.ph. */
  STOREFRONT_ROOT_DOMAIN: hostname,
  /**
   * Storefront origin for customer email links; {host} is the tenant's hostname.
   * Production: https://{host}. Local Next.js dev server: http://{host}:3002.
   */
  STOREFRONT_URL_TEMPLATE: z
    .string()
    .regex(/^https?:\/\/\{host\}(:\d+)?$/, 'must look like https://{host} or http://{host}:3002')
    .default('https://{host}'),
  /** Dashboard origin used in email links, e.g. https://app.tahi.ph. */
  APP_PUBLIC_URL: z.url({ protocol: /^https?$/ }).transform((u) => u.replace(/\/+$/, '')),
  /**
   * Status of a newly onboarded atelier. TRIAL = self-serve; PENDING_APPROVAL = a platform
   * admin must approve it (open question Q6). TRIAL until admin tooling exists (Phase 7).
   */
  TENANT_ONBOARDING_STATUS: z.enum(['TRIAL', 'PENDING_APPROVAL']).default('TRIAL'),
  /**
   * Header carrying the real client IP, set by the edge (cf-connecting-ip behind Cloudflare).
   * Unset: Express req.ip (TRUST_PROXY rules).
   */
  CLIENT_IP_HEADER: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  /** Worker email delivery: mailpit (local), resend (production) or log (tests/CI). */
  EMAIL_TRANSPORT: z.enum(['log', 'mailpit', 'resend']).default('log'),
  EMAIL_FROM: z.string().min(3).default('TAHI.ph <no-reply@tahi.ph>'),
  MAILPIT_URL: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:8025'),
  RESEND_API_KEY: z.string().min(1).optional(),
  /**
   * AES-256-GCM key ring for secrets at rest: "id:base64(32 bytes)[,id:...]", first = active.
   * Generate with: echo "k1:$(openssl rand -base64 32)"
   */
  ENCRYPTION_KEYS: z.string().refine((v) => {
    try {
      SecretBox.fromEnv(v);
      return true;
    } catch {
      return false;
    }
  }, 'must be id:base64key entries with 32-byte keys'),
});

const refinedEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.EMAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['RESEND_API_KEY'],
      message: 'required when EMAIL_TRANSPORT=resend',
    });
  }
  if (env.NODE_ENV === 'production' && env.EMAIL_TRANSPORT === 'log') {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_TRANSPORT'],
      message: 'log transport is not allowed in production',
    });
  }
  if (env.NODE_ENV === 'production' && !env.APP_PUBLIC_URL.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['APP_PUBLIC_URL'],
      message: 'must use https in production',
    });
  }
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
  const result = refinedEnvSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}
