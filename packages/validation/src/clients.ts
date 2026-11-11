import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common.js';

export const CLIENT_SOURCES = ['WALK_IN', 'REFERRAL', 'STOREFRONT', 'SOCIAL', 'OTHER'] as const;
export const COMMUNICATION_CHANNELS = [
  'CALL',
  'SMS',
  'EMAIL',
  'MESSENGER',
  'VIBER',
  'IN_PERSON',
  'OTHER',
] as const;
export const COMMUNICATION_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;

/** Optional text: missing keeps the value (PATCH); null or blank clears it. */
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((s) => (s ? s : null));

const tagsSchema = z
  .array(z.string().trim().toLowerCase().min(1).max(30))
  .max(20)
  .transform((tags) => [...new Set(tags)].sort());

const clientFields = {
  firstName: z.string().trim().min(1).max(100),
  lastName: clearable(100),
  email: z
    .email()
    .trim()
    .toLowerCase()
    .max(254)
    .nullable()
    .or(z.literal('').transform(() => null)),
  phone: clearable(30),
  birthday: z.iso.date().nullable(),
  addressLine1: clearable(200),
  addressLine2: clearable(200),
  city: clearable(100),
  province: clearable(100),
  postalCode: clearable(10),
  preferences: clearable(2000),
  source: z.enum(CLIENT_SOURCES),
  tags: tagsSchema,
};

/** Only firstName is required; omitted fields take their defaults. */
export const createClientRequestSchema = z
  .object(clientFields)
  .partial()
  .required({ firstName: true })
  .strict();

export const updateClientRequestSchema = z
  .object(clientFields)
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field');

export const clientListQuerySchema = paginationQuerySchema
  .extend({
    /** Matches first name, last name, email or phone (case-insensitive, substring). */
    q: z.string().trim().min(1).max(100).optional(),
    tag: z.string().trim().toLowerCase().min(1).max(30).optional(),
    status: z.enum(['active', 'archived', 'all']).default('active'),
  })
  .strict();

export const clientParamsSchema = z.object({ id: idSchema });

export const clientSchema = z.object({
  id: idSchema,
  firstName: z.string(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  birthday: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  postalCode: z.string().nullable(),
  preferences: z.string().nullable(),
  source: z.enum(CLIENT_SOURCES),
  tags: z.array(z.string()),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// ----- Notes and communications -------------------------------------------------------

const authorSchema = z.object({ membershipId: idSchema, name: z.string() });

export const createClientNoteRequestSchema = z
  .object({ body: z.string().trim().min(1).max(5000) })
  .strict();

export const clientNoteSchema = z.object({
  id: idSchema,
  body: z.string(),
  author: authorSchema,
  createdAt: z.iso.datetime(),
});

export const clientNoteParamsSchema = z.object({ id: idSchema, noteId: idSchema });

export const createCommunicationRequestSchema = z
  .object({
    channel: z.enum(COMMUNICATION_CHANNELS),
    direction: z.enum(COMMUNICATION_DIRECTIONS),
    summary: z.string().trim().min(1).max(2000),
    /** Defaults to now. */
    occurredAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const communicationSchema = z.object({
  id: idSchema,
  channel: z.enum(COMMUNICATION_CHANNELS),
  direction: z.enum(COMMUNICATION_DIRECTIONS),
  summary: z.string(),
  occurredAt: z.iso.datetime(),
  recordedBy: authorSchema,
});

export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;
export type UpdateClientRequest = z.infer<typeof updateClientRequestSchema>;
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;
export type CreateClientNoteRequest = z.infer<typeof createClientNoteRequestSchema>;
export type CreateCommunicationRequest = z.infer<typeof createCommunicationRequestSchema>;
