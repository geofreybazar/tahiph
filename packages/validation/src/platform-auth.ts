import { z } from 'zod';
import { idSchema } from './common.js';

/** Platform admin authentication (docs/AUTHENTICATION_AND_AUTHORIZATION.md §3.6). */

export const totpCodeRequestSchema = z
  .object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })
  .strict();

export const recoveryCodeRequestSchema = z
  .object({ code: z.string().trim().min(10).max(16) })
  .strict();

/** After the password step: enroll an authenticator (first login) or enter a code. */
export const platformLoginResponseSchema = z.object({ next: z.enum(['mfa_enroll', 'mfa_verify']) });

export const mfaEnrollmentResponseSchema = z.object({
  otpauthUri: z.string(),
  secret: z.string(),
});

export const platformMeResponseSchema = z.object({
  admin: z.object({
    id: idSchema,
    email: z.string(),
    name: z.string(),
    role: z.enum(['SUPER_ADMIN', 'PLATFORM_ADMIN']),
  }),
  mfa: z.object({ enrolled: z.boolean(), verified: z.boolean() }),
  permissions: z.array(z.string()),
});

/** Recovery codes are shown exactly once, right after enrollment. */
export const mfaVerifiedResponseSchema = z.object({
  me: platformMeResponseSchema,
  recoveryCodes: z.array(z.string()).optional(),
  recoveryCodesRemaining: z.number().int().optional(),
});

export type PlatformMeResponse = z.infer<typeof platformMeResponseSchema>;
export type MfaVerifiedResponse = z.infer<typeof mfaVerifiedResponseSchema>;
