import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderImage } from './image.js';

const photo = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#a33' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestCam' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '14/1 35/1 0/1' },
    })
    .toBuffer();

describe('renderImage', () => {
  it('re-encodes to WebP without metadata, within the size boxes', async () => {
    const input = await photo(3000, 1500);
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const r = await renderImage(input, 'image/jpeg');
    if (!r.ok) throw new Error(r.reason);
    expect(r.display).toMatchObject({ width: 2048, height: 1024 });
    expect(r.thumb).toMatchObject({ width: 400, height: 200 });
    for (const out of [r.display.data, r.thumb.data]) {
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
    }
  });

  it('never enlarges small images', async () => {
    const r = await renderImage(await photo(120, 80), 'image/jpeg');
    expect(r.ok && r.display).toMatchObject({ width: 120, height: 80 });
  });

  it('rejects files whose bytes are not the declared image type', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    expect(await renderImage(png, 'image/jpeg')).toEqual({
      ok: false,
      reason: 'file content does not match its declared type',
    });
    expect(await renderImage(Buffer.from('%PDF-1.7 not an image'), 'image/png')).toEqual({
      ok: false,
      reason: 'not a readable image',
    });
  });
});
