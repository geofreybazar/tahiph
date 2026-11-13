import { z } from 'zod';
import { idSchema } from './common.js';

/** Image types accepted for upload (SECURITY.md §File uploads). HEIC is not: sharp can't decode it. */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MEDIA_PURPOSES = ['LOGO', 'CATALOG_ITEM_IMAGE'] as const;
export const MEDIA_STATUSES = ['PENDING', 'PROCESSING', 'READY', 'REJECTED'] as const;

export const createUploadRequestSchema = z
  .object({
    contentType: z.enum(IMAGE_CONTENT_TYPES),
    size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  })
  .strict();

export const mediaAssetSchema = z.object({
  id: idSchema,
  purpose: z.enum(MEDIA_PURPOSES),
  status: z.enum(MEDIA_STATUSES),
  contentType: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  rejectReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Short-lived signed links, only when READY. */
  urls: z.object({ display: z.url(), thumb: z.url() }).nullable(),
});

export const createUploadResponseSchema = z.object({
  asset: mediaAssetSchema,
  /** The browser PUTs the file here with exactly these headers, before `expiresAt`. */
  upload: z.object({
    method: z.literal('PUT'),
    url: z.url(),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
});

export const catalogImageParamsSchema = z.object({ id: idSchema, imageId: idSchema });
export const logoParamsSchema = z.object({ imageId: idSchema });

export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;
export type MediaAsset = z.infer<typeof mediaAssetSchema>;
