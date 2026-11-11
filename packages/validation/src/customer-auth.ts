import { z } from 'zod';
import { emailSchema, emailTokenSchema } from './auth.js';
import { idSchema } from './common.js';

/** Storefront customer sign-in by email code or magic link (§3.5). */

export const customerOtpStartRequestSchema = z.object({ email: emailSchema }).strict();

/** Either the 6-digit code (with the email) or the magic-link token. */
export const customerOtpVerifyRequestSchema = z.union([
  z
    .object({ email: emailSchema, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })
    .strict(),
  z.object({ token: emailTokenSchema }).strict(),
]);

export const customerMeResponseSchema = z.object({
  customer: z.object({ id: idSchema, email: z.string(), name: z.string().nullable() }),
});

export type CustomerOtpVerifyRequest = z.infer<typeof customerOtpVerifyRequestSchema>;
export type CustomerMeResponse = z.infer<typeof customerMeResponseSchema>;
