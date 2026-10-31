import { expect, newClient, newGarment, run, test } from './helpers';

test('a client becomes an order, with garments, fittings and stages', async ({ as }) => {
  const page = await as(run.owner);
  const name = 'Alma Atelier';

  await page.getByRole('link', { name: 'Clients', exact: true }).click();
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByText('Enter a name.')).toBeVisible();

  const clientUrl = await newClient(page, name);
  await page.getByLabel('Phone').fill('0917');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.getByLabel('Title').fill('Santos wedding');
  await page.getByLabel('Wedding date').fill('2027-02-14');
  await page.getByLabel('Price (₱)').fill('abc');
  await page.getByRole('button', { name: 'Add project' }).click();
  await expect(page.getByText('Enter an amount')).toBeVisible();

  await page.getByLabel('Price (₱)').fill('150,000.50');
  await page.getByRole('button', { name: 'Add project' }).click();
  await expect(page.getByRole('heading', { name: /Santos wedding/ })).toBeVisible();
  const orderUrl = page.url();
  await expect(page.getByText('Price: ₱150,000.50')).toBeVisible();
  await expect(page.getByLabel('Wedding date')).toHaveValue('2027-02-14');

  await page.getByLabel('New price (₱)').fill('160,000');
  await page.getByRole('button', { name: 'Change price' }).click();
  await expect(page.getByText('Price: ₱160,000.00')).toBeVisible();

  const status = page.waitForResponse((r) => r.url().endsWith('/status'));
  await page.getByLabel('Status').selectOption('active');
  await status;
  await page.reload();
  await expect(page.getByLabel('Status')).toHaveValue('active');

  await page.goto(clientUrl);
  await page.getByLabel("Person's name").fill('Alma S');
  await page.getByRole('button', { name: 'Add profile' }).click();
  await page.getByRole('link', { name: 'Alma S' }).click();
  await expect(page.getByRole('heading', { name: 'Alma S' })).toBeVisible();

  await page.getByRole('button', { name: 'Save fitting' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Date').fill('2027-01-15');
  await page.getByLabel('Bust').fill('34.5');
  await page.getByLabel('Waist').fill('26');
  await page.getByRole('button', { name: 'Add another measurement' }).click();
  await page.getByLabel('Measurement name').fill('Train length');
  await page.getByLabel('Value').fill('60');
  await page.getByRole('button', { name: 'Save fitting' }).click();
  await expect(page.getByText('34.50')).toBeVisible();
  await expect(page.getByText('Train length')).toBeVisible();
  await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0);

  await page.goto(orderUrl);
  await newGarment(page, 'Atelier Gown', 'Alma');
  await page.getByLabel('Measurements used').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.reload();
  await expect(page.locator('#edit-record option:checked')).not.toHaveText('None assigned');

  const move = async (stage: string, label: string) => {
    await page.getByLabel('Move to').selectOption(stage);
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(page.getByText(`Stage: ${label}`)).toBeVisible();
  };
  await page.getByLabel('Note').fill('first');
  await move('fitting', 'Fitting');
  await move('alterations', 'Alterations');
  await move('fitting', 'Fitting');
  await expect(page.locator('ol li')).toHaveCount(4);

  await page.getByRole('link', { name: 'Production', exact: true }).click();
  const gown = { name: 'Atelier Gown' };
  await expect(page.getByRole('region', { name: 'Fitting' }).getByRole('link', gown)).toBeVisible();
  await page.getByLabel('Move Atelier Gown').selectOption('ready');
  await expect(page.getByRole('region', { name: 'Ready' }).getByRole('link', gown)).toBeVisible();

  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await page.getByLabel('Search orders').fill(name);
  await expect(page.getByRole('link', { name: /Santos wedding/ })).toBeVisible();
  await page.getByLabel('Filter by status').selectOption('cancelled');
  await expect(page.getByText('No orders found.')).toBeVisible();

  // Roles and tenants, on the same records.
  const staff = await as(run.staff);
  await staff.goto(orderUrl);
  await expect(staff.getByText('Price: ₱160,000.00')).toBeVisible();
  await expect(staff.getByLabel('New price (₱)')).toHaveCount(0);
  await expect(staff.getByRole('button', { name: 'Archive' })).toHaveCount(0);

  const rival = await as(run.rival);
  for (const url of [orderUrl, clientUrl]) {
    await rival.goto(url);
    await expect(rival.getByRole('alert')).toContainText(/not found/i);
  }
});

test('the production board fits a phone', async ({ as }) => {
  const page = await as(run.owner, { width: 390 });
  await page.getByRole('link', { name: 'Production', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Production' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
