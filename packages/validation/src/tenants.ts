import { z } from 'zod';
import { idSchema } from './common.js';
import { emailSchema } from './auth.js';

/** Subdomains that can never be a tenant slug. */
export const RESERVED_SLUGS = [
  'app',
  'admin',
  'api',
  'www',
  'mail',
  'email',
  'static',
  'assets',
  'cdn',
  'help',
  'support',
  'status',
  'docs',
  'blog',
  'billing',
  'pay',
  'customers',
  'tahi',
] as const;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lower-case letters, digits and single hyphens')
  .refine((s) => !s.includes('--'), 'Use single hyphens')
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), 'This name is reserved');

export const createAtelierRequestSchema = z
  .object({ businessName: z.string().trim().min(2).max(100), slug: slugSchema })
  .strict();

export const atelierCreatedResponseSchema = z.object({
  atelier: z.object({ id: idSchema, name: z.string(), slug: z.string(), status: z.string() }),
  membershipId: idSchema,
  storefrontHost: z.string(),
});

/** Invite a staff member by email to a role of the active atelier (not the owner role). */
export const createInvitationRequestSchema = z
  .object({ email: emailSchema, roleId: idSchema })
  .strict();

export const invitationCreatedResponseSchema = z.object({
  email: z.string(),
  roleId: idSchema,
  expiresAt: z.iso.datetime(),
});

export type CreateAtelierRequest = z.infer<typeof createAtelierRequestSchema>;
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;
