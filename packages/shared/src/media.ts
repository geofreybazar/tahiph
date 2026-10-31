import { z } from 'zod';

export const MEDIA_PURPOSES = [
  'sketch',
  'design_reference',
  'fitting_photo',
  'payment_proof',
  'expense_receipt',
] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

export const MEDIA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number];

/** The private-media bucket's limit, in bytes (25 MiB). */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export const createUploadIntentSchema = z.object({
  purpose: z.enum(MEDIA_PURPOSES),
  mimeType: z.enum(MEDIA_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_MEDIA_BYTES),
  filename: z.string().trim().min(1).max(255).optional(),
});
export type CreateUploadIntent = z.infer<typeof createUploadIntentSchema>;
