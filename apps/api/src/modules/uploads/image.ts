import sharp from 'sharp';

// One libvips thread per job: the worker shares the VPS with Postgres and the API.
sharp.concurrency(1);

/** Decompression-bomb guard: 40 MP covers any phone camera. */
const MAX_INPUT_PIXELS = 40_000_000;
const FORMAT_TYPES: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export interface Rendition {
  data: Buffer;
  width: number;
  height: number;
}

export type RenderResult =
  { ok: true; display: Rendition; thumb: Rendition } | { ok: false; reason: string };

/**
 * Checks the real format from the file's bytes (not the declared type), then re-encodes to
 * WebP. Re-encoding drops all metadata (EXIF, GPS, ICC beyond sRGB), so nothing private survives.
 */
export async function renderImage(bytes: Buffer, declaredType: string): Promise<RenderResult> {
  const input = () => sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
  let format: string | undefined;
  try {
    format = (await input().metadata()).format;
  } catch {
    return { ok: false, reason: 'not a readable image' };
  }
  if (!format || FORMAT_TYPES[format] !== declaredType) {
    return { ok: false, reason: 'file content does not match its declared type' };
  }
  const render = async (box: number, quality: number): Promise<Rendition> => {
    const { data, info } = await input()
      .rotate() // apply the EXIF orientation before it is dropped
      .resize({ width: box, height: box, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  };
  try {
    return { ok: true, display: await render(2048, 82), thumb: await render(400, 75) };
  } catch {
    return { ok: false, reason: 'not a readable image' };
  }
}
