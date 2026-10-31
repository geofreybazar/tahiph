import { z } from 'zod';
import { isValidTenantSlug } from './subdomains.js';

const email = z.email().transform((value) => value.toLowerCase());

/** Owners come from tenant creation or ownership transfer, never from an ordinary invitation. */
export const INVITABLE_ROLES = ['admin', 'staff'] as const;
export const invitableRoleSchema = z.enum(INVITABLE_ROLES);

export const createInvitationSchema = z.object({ email, role: invitableRoleSchema });
export const acceptInvitationSchema = z.object({ token: z.string().min(1).max(200) });
export const updateMemberSchema = z.object({ role: invitableRoleSchema });
export const transferOwnershipSchema = z.object({ membershipId: z.uuid() });
export const updateTenantSchema = z.object({ name: z.string().trim().min(1).max(120) });

export const createTenantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .refine(
      isValidTenantSlug,
      'Use lower-case letters, numbers and hyphens, and avoid reserved names',
    ),
  ownerEmail: email,
});

export type CreateInvitation = z.infer<typeof createInvitationSchema>;
export type CreateTenant = z.infer<typeof createTenantSchema>;

export interface IssuedInvitation {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'staff';
  expiresAt: string;
  /** Holds the secret token, so it's returned only once, to whoever created the invitation. */
  acceptUrl: string;
  emailSent: boolean;
}
