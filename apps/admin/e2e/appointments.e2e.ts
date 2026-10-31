import { expect, newClient, newGarment, newOrder, run, test } from './helpers';

test('appointments sit on the right Manila day and follow their status', async ({ as }) => {
  const name = 'Calendar Client';
  const page = await as(run.owner, { timezoneId: 'America/New_York' });
  await newClient(page, name);
  await newOrder(page, 'Calendar order');
  const garmentUrl = await newGarment(page, 'Calendar Gown', 'Cora');
  await expect(page.getByText('No appointments yet.')).toBeVisible();

  await page.getByRole('link', { name: 'Schedule an appointment' }).click();
  await expect(page.getByLabel('Type')).toHaveValue('fitting');
  await expect(page.locator('#appt-client option:checked')).toHaveText(name);
  await expect(page.locator('#appt-garment option:checked')).toHaveText('Calendar Gown for Cora');

  const schedule = page.getByRole('button', { name: 'Schedule', exact: true });
  await schedule.click();
  await expect(page.getByText('Enter when it starts and ends.')).toBeVisible();

  const month = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
  const [day, next] = [`${month}-15`, `${month}-16`];
  await page.getByLabel('Starts (Manila time)').fill(`${day}T10:00`);
  await page.getByLabel('Ends (Manila time)').fill(`${day}T09:00`);
  await schedule.click();
  await expect(page.getByText('The end must be after')).toBeVisible();

  await page.getByLabel('Ends (Manila time)').fill(`${day}T11:00`);
  await page.getByLabel('Location').fill('Studio');
  await schedule.click();
  const cell = page.getByRole('region', { name: day });
  await expect(cell.getByRole('button', { name: new RegExp(`Fitting: ${name}`) })).toContainText(
    '10:00',
  );

  // Just after midnight in Manila is the previous day in UTC and in New York.
  await page.getByLabel('Type').selectOption('pickup');
  await page.getByLabel('Starts (Manila time)').fill(`${next}T00:30`);
  await page.getByLabel('Ends (Manila time)').fill(`${next}T01:00`);
  await schedule.click();
  const nextCell = page.getByRole('region', { name: next });
  await expect(nextCell.getByRole('button', { name: /Pickup/ })).toBeVisible();

  await cell.getByRole('button', { name: /Fitting/ }).click();
  await expect(page.getByLabel('Starts (Manila time)')).toHaveValue(`${day}T10:00`);
  await page.getByLabel('Location').fill('Fitting room');
  await page.getByLabel('Starts (Manila time)').fill(`${day}T10:30`);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(cell.getByRole('button', { name: /10:30/ })).toBeVisible();

  await cell.getByRole('button', { name: /10:30/ }).click();
  await page.getByRole('button', { name: 'Mark completed' }).click();
  await cell.getByRole('button', { name: /Completed/ }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByLabel('Location')).toBeDisabled();
  await page.getByRole('button', { name: 'Back to scheduled' }).click();
  await expect(cell.getByRole('button', { name: /Completed/ })).toHaveCount(0);

  await nextCell.getByRole('button', { name: /Pickup/ }).click();
  await page.getByRole('button', { name: 'Mark no-show' }).click();
  await expect(nextCell.getByRole('button', { name: /No-show/ })).toBeVisible();

  const columns = await page
    .locator('section[aria-label]')
    .first()
    .evaluate((s) => getComputedStyle(s.parentElement!).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(7);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('No appointments this month.')).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(cell).toBeVisible();

  await page.goto(garmentUrl);
  await expect(page.getByText(/Fitting, .* at /)).toBeVisible();

  const staff = await as(run.staff);
  await staff.getByRole('link', { name: 'Appointments', exact: true }).click();
  const staffCell = staff.getByRole('region', { name: day });
  await staffCell.getByRole('button', { name: /Fitting/ }).click();
  await staff.getByRole('button', { name: 'Mark cancelled' }).click();
  await expect(staffCell.getByRole('button', { name: /Cancelled/ })).toBeVisible();

  // Phones list only the days with something on, each date once.
  await staff.setViewportSize({ width: 390, height: 800 });
  expect(await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(staff.getByRole('region', { name: `${month}-01` })).toBeHidden();
  await expect(staffCell.locator('h2 span:visible')).toHaveText(day);

  const rival = await as(run.rival);
  await rival.getByRole('link', { name: 'Appointments', exact: true }).click();
  await expect(rival.getByRole('heading', { name: 'Appointments' })).toBeVisible();
  await expect(rival.getByText('No appointments this month.')).toBeVisible();
});
