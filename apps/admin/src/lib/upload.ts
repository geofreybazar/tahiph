import { MAX_MEDIA_BYTES, MEDIA_MIME_TYPES, type MediaPurpose } from '@tahi/shared';
import { apiFetch } from './api';

/** Intent, upload, confirm. Returns the confirmed file's id. */
export async function uploadMedia(tenantId: string, purpose: MediaPurpose, file: File) {
  if (!(MEDIA_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, WebP or PDF file.');
  }
  if (file.size > MAX_MEDIA_BYTES) throw new Error('Choose a file of 25 MB or less.');
  const { id, uploadUrl } = await apiFetch<{ id: string; uploadUrl: string }>(
    '/media/upload-intents',
    {
      tenantId,
      method: 'POST',
      body: { purpose, mimeType: file.type, sizeBytes: file.size, filename: file.name },
    },
  );
  const stored = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  }).catch(() => null);
  if (!stored?.ok) throw new Error('The upload failed. Please try again.');
  await apiFetch(`/media/${id}/confirm`, { tenantId, method: 'POST' });
  return id;
}
