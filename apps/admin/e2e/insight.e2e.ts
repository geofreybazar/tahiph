import { expect, newClient, newOrder, run, test } from './helpers';

test('reports add up exactly, in Manila months', async ({ as }) => {
  const page = await as(run.owner);
  await expect(page.getByText('Receivables (all time)')).toBeVisible();

  await newClient(page, 'Reports Client');
  await newOrder(page, 'Reports order');
  const number = (await page.getByRole('heading', { name: /Reports order/ }).innerText()).split(
    ':',
  )[0]!;
  const status = page.waitForResponse((r) => r.url().endsWith('/status'));
  await page.getByLabel('Status').selectOption('active');
  await status;

  const pay = async (amount: string, at: string) => {
    await page.getByLabel('Amount (₱)').fill(amount);
    await page.getByLabel('Paid at (Manila time)').fill(at);
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByLabel('Amount (₱)')).toHaveValue('');
  };
  await pay('12,000.50', '2020-03-31T23:30');
  await pay('1,000', '2020-04-01T00:30');

  await page.getByRole('link', { name: 'Expenses', exact: true }).click();
  await page.getByLabel('Category').fill('Rent');
  await page.getByLabel('Amount (₱)').fill('20,000');
  await page.getByLabel('Date', { exact: true }).fill('2020-03-31');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByText('₱20,000.00, Rent')).toBeVisible();

  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  const profit = page.getByRole('table', { name: 'Profit' });
  await expect(profit.locator('tbody tr')).toHaveCount(12);

  await page.getByLabel('From month').fill('2020-03');
  await page.getByLabel('To month').fill('2020-04');
  const march = profit.getByRole('row', { name: /March 2020/ });
  await expect(march).toContainText('₱12,000.50');
  await expect(march).toContainText('₱20,000.00');
  await expect(march).toContainText('-₱7,999.50');
  await expect(profit.getByRole('row', { name: /April 2020/ })).toContainText('₱1,000.00');
  await expect(profit.getByRole('row', { name: 'Total' })).toContainText('-₱6,999.50');
  await expect(
    page.getByRole('table', { name: 'Revenue' }).getByRole('row', { name: /March 2020/ }),
  ).toContainText('₱12,000.50');
  await expect(page.getByRole('table', { name: 'Sales' }).locator('tbody tr')).toHaveCount(2);

  await page.getByLabel('From month').fill('2020-05');
  await expect(page.getByText('The period ends before it starts').first()).toBeVisible();
  await page.getByLabel('From month').fill('2020-03');

  await expect(
    page
      .getByRole('table', { name: 'Receivables by active order' })
      .getByRole('row', { name: new RegExp(number) }),
  ).toContainText('₱86,999.50');

  const narrow = await as(run.owner, { width: 390 });
  await narrow.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(narrow.getByRole('table', { name: 'Profit' })).toBeVisible();
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
});

test('staff get the operations dashboard, with no money and no financial requests', async ({
  as,
}) => {
  const page = await as(run.staff);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const operations = page.waitForResponse((r) => r.url().endsWith('/dashboard/operations'));
  await page.reload();
  await operations;
  await expect(page.getByText('Garments by stage')).toBeVisible();
  await expect(page.getByText('Upcoming fittings')).toBeVisible();
  await expect(page.getByText('This month')).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText('₱');
  expect(requests.filter((url) => /api\/v1\/(dashboard\/financial|reports)/.test(url))).toEqual([]);

  await expect(page.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/$/);
});
