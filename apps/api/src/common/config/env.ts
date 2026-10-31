import { z } from 'zod';

const origin = z.string().refine((value) => {
  // URL accepts * in a hostname, so a wildcard has to be rejected explicitly.
  if (value.includes('*') || !URL.canParse(value)) return false;
  return new URL(value).origin === value;
}, 'Must be an exact origin, such as https://app.tahi.ph');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      )
      .pipe(z.array(origin)),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    DATABASE_URL: z.string().min(1),
    SUPABASE_JWT_ISSUER: z.url(),
    SUPABASE_JWKS_URL: z.url(),
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(1),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.CORS_ORIGINS.length > 0, {
    path: ['CORS_ORIGINS'],
    message: 'Required in production',
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}
