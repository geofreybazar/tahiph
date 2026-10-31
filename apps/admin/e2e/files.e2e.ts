import { expect, newClient, newGarment, newOrder, PNG, run, test } from './helpers';

test('garment sketches and references upload, show and delete', async ({ as }) => {
  const page = await as(run.owner);
  await newClient(page, 'Files Client');
  await newOrder(page, 'Files order');
  await newGarment(page, 'Files Gown', 'Bea');
  await expect(page.getByText('No sketches or references yet.')).toBeVisible();
  const file = page.getByLabel(/Add a file/);

  await file.setInputFiles(PNG('gown.png'));
  const image = page.getByRole('img', { name: 'gown.png' });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);

  await page.getByLabel('Type').first().selectOption('design_reference');
  await file.setInputFiles({
    name: 'ref.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n%%EOF\n'),
  });
  await expect(page.getByRole('link', { name: 'Open ref.pdf' })).toBeVisible();

  await file.setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<svg onload=alert(1)>'),
  });
  await expect(page.getByRole('alert')).toContainText('not the type that was declared');

  await file.setInputFiles({ name: 'n.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.getByText('Choose a JPEG')).toBeVisible();

  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText(/Remove this garment/)).toBeVisible();

  await page.getByRole('button', { name: 'Remove gown.png' }).click();
  await expect(image).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Open ref.pdf' })).toBeVisible();
  await expect(image).toHaveCount(0);
});
