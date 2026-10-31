import { expect, newClient, newOrder, PNG, run, test } from './helpers';

test('a payment schedule warns about the price, and staff can only read it', async ({ as }) => {
  const page = await as(run.owner);
  await newClient(page, 'Schedule Client');
  const url = await newOrder(page, 'Schedule order', '150,000.50');
  await expect(page.getByText('No payments planned yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Edit schedule' }).click();
  await page.getByRole('button', { name: 'Add payment' }).click();
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Each payment needs')).toBeVisible();

  await page.getByLabel('Payment 1 label').fill('Deposit');
  await page.getByLabel('Payment 1 due date').fill('2027-01-15');
  await page.getByLabel('Payment 1 amount in pesos').fill('50,000.50');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText("₱100,000.00 of the price isn't scheduled.")).toBeVisible();

  await page.getByRole('button', { name: 'Edit schedule' }).click();
  await expect(page.getByLabel('Payment 1 amount in pesos')).toHaveValue('₱50,000.50');
  await page.getByRole('button', { name: 'Add payment' }).click();
  await page.getByLabel('Payment 2 label').fill('Balance');
  await page.getByLabel('Payment 2 due date').fill('2027-02-01');
  await page.getByLabel('Payment 2 amount in pesos').fill('100000');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Scheduled total: ₱150,000.50')).toBeVisible();
  await expect(page.getByText('of the price')).toHaveCount(0);

  await page.getByLabel('New price (₱)').fill('140,000');
  await page.getByRole('button', { name: 'Change price' }).click();
  await expect(page.getByText('more than the price')).toContainText('₱10,000.50');

  await page.reload();
  await expect(page.getByText('Due Jan 15, 2027')).toBeVisible();

  const staff = await as(run.staff);
  await staff.goto(url);
  await expect(staff.getByText('Scheduled total')).toBeVisible();
  await expect(staff.getByRole('button', { name: 'Edit schedule' })).toHaveCount(0);
});

test('payments record once, derive the balance, and follow the role rules', async ({ as }) => {
  // A browser in New York still works on the Manila clock.
  const page = await as(run.owner, { timezoneId: 'America/New_York' });
  await expect(page.getByRole('link', { name: 'Payments', exact: true })).toBeVisible();
  const clientUrl = await newClient(page, 'Payments Client');
  const url = await newOrder(page, 'Payments order', '150,000.50');

  await page.getByRole('button', { name: 'Edit schedule' }).click();
  await page.getByRole('button', { name: 'Add payment' }).click();
  await page.getByLabel('Payment 1 label').fill('Deposit');
  await page.getByLabel('Payment 1 due date').fill('2027-01-15');
  await page.getByLabel('Payment 1 amount in pesos').fill('50,000');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Scheduled total')).toBeVisible();

  const balance = page.locator('div', { has: page.locator('dt', { hasText: /^Balance$/ }) }).last();
  const record = page.getByRole('button', { name: 'Record payment' });
  await record.click();
  await expect(page.getByText('Enter an amount above zero')).toBeVisible();

  await page.getByLabel('Amount (₱)').fill('50,000.25');
  await page.getByLabel('Method').selectOption('gcash');
  await page.getByLabel('Reference').fill('GC123');
  await page.getByLabel('For scheduled payment').selectOption({ label: 'Deposit' });
  await page.getByLabel('Paid at (Manila time)').fill('2019-10-01T00:30');
  await page.getByLabel('Proof (optional)').setInputFiles(PNG('proof.png'));
  await record.click();
  const first = page.getByText('₱50,000.25, GCash');
  await expect(first).toBeVisible();
  await expect(balance).toContainText('₱100,000.25');
  await expect(page.getByText(/Oct 1, 2019/)).toBeVisible();

  const proof = page.getByRole('link', { name: 'View proof' });
  const proofResponse = await page.request.get((await proof.getAttribute('href'))!);
  expect(proofResponse.ok()).toBe(true);

  // The server records it, but the browser never hears back; the person clicks again.
  let dropped = false;
  await page.route('**/payments', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.getByLabel('Amount (₱)').fill('1,000');
  await record.click();
  await expect(page.getByText('Could not reach the server')).toBeVisible();
  await record.click();
  await expect(page.getByLabel('Amount (₱)')).toHaveValue('');
  await page.unroute('**/payments');
  await page.reload();
  const second = page.getByText('₱1,000.00, GCash');
  await expect(second).toHaveCount(1);
  await expect(balance).toContainText('₱99,000.25');

  await page.getByLabel('Type', { exact: true }).selectOption('refund');
  await page.getByLabel('Amount (₱)').fill('500');
  await page.getByRole('button', { name: 'Record refund' }).click();
  await expect(page.getByText('Refund ₱500.00')).toBeVisible();
  await expect(balance).toContainText('₱99,500.25');

  await second.locator('../..').getByRole('button', { name: 'Void' }).click();
  await expect(page.getByText('Voided: Wrong amount')).toBeVisible();
  await expect(balance).toContainText('₱100,500.25');
  await expect(second).toHaveCount(1);

  await page.getByRole('button', { name: 'Edit schedule' }).click();
  await page.getByRole('button', { name: 'Remove payment 1' }).click();
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('This is still in use')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByLabel('Amount (₱)').fill('200,000');
  await record.click();
  await expect(page.getByText('Overpaid')).toBeVisible();

  await page.goto(clientUrl);
  await expect(page.getByText('Payment history')).toBeVisible();
  await expect(first).toBeVisible();

  await page.getByRole('link', { name: 'Payments', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible();
  // 00:30 on 1 October in Manila is still 30 September in UTC and New York.
  await page.getByLabel('From').fill('2019-10-01');
  await page.getByLabel('To').fill('2019-10-01');
  await expect(first).toHaveCount(1);
  await page.getByLabel('From').fill('2019-10-02');
  await page.getByLabel('To').fill('2019-10-02');
  await expect(page.getByText('No payments recorded.')).toBeVisible();

  const staff = await as(run.staff);
  await expect(staff.getByRole('link', { name: 'Payments', exact: true })).toHaveCount(0);
  await staff.goto(url);
  await expect(staff.getByText('Overpaid')).toBeVisible();
  await expect(staff.getByLabel('Type', { exact: true })).toHaveCount(0);
  await expect(staff.getByRole('button', { name: 'Void' })).toHaveCount(0);
  await staff.getByLabel('Amount (₱)').fill('10');
  await staff.getByRole('button', { name: 'Record payment' }).click();
  await expect(staff.getByText('₱10.00, Cash')).toBeVisible();
  await staff.goto('/payments');
  await expect(staff).toHaveURL(/\/$/);
});

test('expenses keep their receipts, for managers only', async ({ as }) => {
  const page = await as(run.owner);
  await newClient(page, 'Expense Client');
  await newOrder(page, 'Expense order');

  await page.getByRole('link', { name: 'Expenses', exact: true }).click();
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByText('Enter a category')).toBeVisible();

  await page.getByLabel('Category').fill('Fabric');
  await page.getByLabel('Amount (₱)').fill('12,500.75');
  await page.getByLabel('Date', { exact: true }).fill('2019-08-15');
  await page.getByLabel('Type').selectOption('production');
  const order = page.getByLabel('Order (optional)');
  await expect(order.locator('option', { hasText: 'Expense order' })).toHaveCount(1);
  await order.selectOption({
    label: await order.locator('option', { hasText: 'Expense order' }).innerText(),
  });
  await page.getByLabel('Receipt (optional)').setInputFiles(PNG('r.png'));
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByText('₱12,500.75, Fabric')).toBeVisible();
  await expect(page.getByText(/Aug 15, 2019, Production, P-/)).toBeVisible();

  // The tenant is shared with other journeys, so work on this expense's own row.
  const row = page.locator('li', { hasText: '₱12,500.75' });
  const receipt = row.getByRole('link', { name: 'View receipt' });
  const download = await page.request.get((await receipt.getAttribute('href'))!);
  expect(download.ok()).toBe(true);

  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Amount (₱)')).toHaveValue('₱12,500.75');
  await page.getByLabel('Category').fill('Lace');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('₱12,500.75, Lace')).toBeVisible();
  await expect(receipt).toHaveCount(1);

  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Replace receipt').setInputFiles(PNG('r2.png'));
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Add expense' })).toBeVisible();
  await expect(receipt).toBeVisible();

  await page.getByLabel('To').fill('2019-08-31');
  await page.getByLabel('From').fill('2019-08-16');
  await expect(page.getByText('No expenses found.')).toBeVisible();
  await page.getByLabel('From').fill('2019-08-15');
  await page.getByLabel('To').fill('2019-08-15');
  await expect(page.getByText('₱12,500.75, Lace')).toBeVisible();
  await page.getByLabel('Kind').selectOption('operating');
  await expect(page.getByText('No expenses found.')).toBeVisible();
  await page.getByLabel('Kind').selectOption('production');
  await expect(page.getByText('₱12,500.75, Lace')).toBeVisible();

  const staff = await as(run.staff);
  await expect(staff.getByRole('link', { name: 'Expenses', exact: true })).toHaveCount(0);
  await staff.goto('/expenses');
  await expect(staff).toHaveURL(/\/$/);

  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByText('Delete the current receipt').click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Add expense' })).toBeVisible();
  await expect(receipt).toHaveCount(0);

  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No expenses found.')).toBeVisible();
});
