import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GARMENT_MEDIA_PURPOSES, MAX_MEDIA_BYTES, MEDIA_MIME_TYPES } from '@tahi/shared';
import { useState } from 'react';
import { Field, selectClass } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';

type Purpose = (typeof GARMENT_MEDIA_PURPOSES)[number];

interface GarmentFile {
  id: string;
  purpose: Purpose;
  mimeType: string;
  originalFilename: string | null;
}

const PURPOSE_LABELS: Record<Purpose, string> = {
  sketch: 'Sketch',
  design_reference: 'Design reference',
};
// Download URLs last 120 seconds; a loaded image keeps showing, but a PDF link must stay valid.
const REFRESH_LINK_MS = 100_000;

function FilePreview({ file, tenantId }: { file: GarmentFile; tenantId: string }) {
  const isImage = file.mimeType.startsWith('image/');
  const link = useQuery({
    queryKey: ['media-url', tenantId, file.id],
    queryFn: () => apiFetch<{ url: string }>(`/media/${file.id}/download-url`, { tenantId }),
    staleTime: isImage ? Infinity : REFRESH_LINK_MS,
    refetchInterval: isImage ? false : REFRESH_LINK_MS,
  });
  const name = file.originalFilename ?? PURPOSE_LABELS[file.purpose];
  if (link.isError) return <FormError error={link.error} />;
  if (!link.data) return <p className="text-sm">Loading…</p>;
  return isImage ? (
    <img src={link.data.url} alt={name} className="h-40 w-full rounded-md object-contain" />
  ) : (
    <a
      className="break-words text-sm underline"
      href={link.data.url}
      target="_blank"
      rel="noreferrer"
    >
      Open {name}
    </a>
  );
}

export function GarmentFiles({ garmentId, tenantId }: { garmentId: string; tenantId: string }) {
  const queryClient = useQueryClient();
  const key = ['garments', tenantId, 'files', garmentId];
  const [purpose, setPurpose] = useState<Purpose>('sketch');
  const [inputKey, setInputKey] = useState(0);
  const files = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<GarmentFile[]>(`/garments/${garmentId}/media`, { tenantId }),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
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
      await apiFetch(`/garments/${garmentId}/media`, {
        tenantId,
        method: 'POST',
        body: { mediaFileId: id },
      });
    },
    onSettled: () => {
      setInputKey((value) => value + 1);
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/garments/${garmentId}/media/${id}`, { tenantId, method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sketches and references</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="file-purpose" label="Type">
            <select
              id="file-purpose"
              className={`${selectClass} block`}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as Purpose)}
            >
              {GARMENT_MEDIA_PURPOSES.map((value) => (
                <option key={value} value={value}>
                  {PURPOSE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <div className="min-w-56 flex-1">
            <Field id="file-input" label="Add a file (JPEG, PNG, WebP or PDF, up to 25 MB)">
              <Input
                key={inputKey}
                id="file-input"
                type="file"
                accept={MEDIA_MIME_TYPES.join(',')}
                disabled={upload.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) upload.mutate(file);
                }}
              />
            </Field>
          </div>
        </div>
        {upload.isPending && (
          <p role="status" className="text-sm">
            Uploading…
          </p>
        )}
        <FormError error={upload.error ?? remove.error ?? files.error} />
        {files.isPending && <p>Loading…</p>}
        {files.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No sketches or references yet.</p>
        )}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.data?.map((file) => (
            <li key={file.id} className="space-y-2 rounded-md border p-2">
              <FilePreview file={file} tenantId={tenantId} />
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground">
                  {PURPOSE_LABELS[file.purpose]}
                  {file.originalFilename && `: ${file.originalFilename}`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Remove ${file.originalFilename ?? PURPOSE_LABELS[file.purpose]}`}
                  onClick={() => {
                    if (window.confirm('Delete this file?')) remove.mutate(file.id);
                  }}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
