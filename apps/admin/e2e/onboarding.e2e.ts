import { API, emailedLink, expect, fillSignIn, run, test, totp } from './helpers';

test('invitations reach new and existing people, once each', async ({ as, anonymous }) => {
  const owner = await as(run.owner);
  await owner.getByRole('link', { name: 'Team', exact: true }).click();
  await expect(owner.getByText(run.staff)).toBeVisible();

  const email = owner.getByLabel('Email');
  const send = owner.getByRole('button', { name: 'Send invitation' });
  await email.fill('not-an-email');
  await send.click();
  await expect(owner.getByText('Enter a valid email')).toBeVisible();

  // A new person, through a real email.
  const newEmail = `e2e-new-${run.run}@example.test`;
  await email.fill(newEmail);
  await send.click();
  await expect(owner.getByRole('status')).toContainText('emailed');
  await expect(owner.getByText(newEmail).first()).toBeVisible();

  const joining = await anonymous();
  const link = await emailedLink(newEmail);
  await joining.goto(link);
  await expect(joining.getByText('Accept your invitation')).toBeVisible();
  await expect(joining).toHaveURL(/accept-invite\?token=/);
  await joining.getByLabel('Choose a password').fill('short');
  await joining.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(joining.getByRole('alert')).toContainText('at least');
  await joining.getByLabel('Choose a password').fill('new-person-password');
  await joining.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(joining.getByRole('heading', { name: 'E2E Atelier' })).toBeVisible();
  await expect(joining.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
  await joining.getByRole('button', { name: 'Sign out' }).click();
  await fillSignIn(joining, newEmail, 'new-person-password');
  await expect(joining.getByRole('heading', { name: 'E2E Atelier' })).toBeVisible();

  // A used email link explains itself instead of failing silently.
  const reused = await anonymous();
  await reused.goto(link);
  await expect(reused.getByText(/expired or was already used/)).toBeVisible();

  // Someone with an account gets a link to share, not an email.
  await owner.reload();
  await email.fill(run.rival);
  await send.click();
  await expect(owner.getByRole('status')).toContainText('no email was sent');
  const shared = await owner.getByLabel('Invitation link').inputValue();

  const person = await anonymous();
  await person.goto(shared);
  await expect(person.getByText('Sign in with the email that was invited')).toBeVisible();
  await fillSignIn(person, run.staff);
  await expect(person.getByText('Accept your invitation')).toBeVisible();
  await person.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(person.getByRole('alert')).toContainText('different email');

  await person.getByRole('button', { name: 'Use a different account' }).click();
  await fillSignIn(person, run.rival);
  await expect(person.getByText('Accept your invitation')).toBeVisible();
  await expect(person.getByLabel('Choose a password')).toHaveCount(0);
  await person.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(person.getByRole('heading', { name: 'E2E Atelier' })).toBeVisible();
  await expect(person.getByLabel('Business')).toHaveCount(1);

  await person.goto(shared);
  await person.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(person.getByRole('alert')).toContainText('invalid or has expired');

  // Removing them takes the business away.
  await owner.reload();
  const row = owner.locator('li', { hasText: run.rival });
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(row).toHaveCount(0);
  await person.goto('/');
  await expect(person.getByRole('heading', { name: 'E2E Rival' })).toBeVisible();
  await expect(person.getByLabel('Business')).toHaveCount(0);

  const staff = await as(run.staff);
  await expect(staff.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
  await staff.goto('/members');
  await expect(staff).toHaveURL(/\/$/);
});

test('a forgotten password can be reset by email', async ({ anonymous }) => {
  const page = await anonymous();
  const email = run.resetter;
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('status')).toBeVisible();

  await page.goto(await emailedLink(email));
  await page.getByLabel('New password').fill('a-brand-new-password');
  await page.getByRole('button', { name: /password/i }).click();
  await expect(page.getByRole('heading', { name: 'E2E Atelier' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await fillSignIn(page, email, run.password);
  await expect(page.getByRole('alert')).toBeVisible();
  await fillSignIn(page, email, 'a-brand-new-password');
  await expect(page.getByRole('heading', { name: 'E2E Atelier' })).toBeVisible();
});

test('the platform needs real MFA, and onboards a new business', async ({ as, anonymous }) => {
  test.slow();
  const slug = `e2e-new-${run.run}`;
  const ownerEmail = `e2e-boss-${run.run}@example.test`;
  const page = await as(run.platform);
  await expect(page.getByRole('heading', { name: 'Platform administration' })).toBeVisible();

  const code = page.getByLabel('6-digit code');
  const verify = page.getByRole('button', { name: 'Verify' });
  const secret = await page.getByTestId('mfa-secret').innerText();
  await expect(page.getByAltText(/QR code/)).toBeVisible();
  await code.fill('000000');
  await verify.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await code.fill(totp(secret));
  await verify.click();
  await expect(page.getByText('Businesses')).toBeVisible();

  await page.getByLabel('Web address').fill('api');
  await page.getByLabel('Business name').fill('X');
  await page.getByLabel('Owner email').fill('x@example.test');
  await page.getByRole('button', { name: /Add business/ }).click();
  await expect(page.getByText('avoid reserved names')).toBeVisible();

  await page.getByLabel('Web address').fill(slug);
  await page.getByLabel('Business name').fill('Fresh Atelier');
  await page.getByLabel('Owner email').fill(ownerEmail);
  await page.getByRole('button', { name: /Add business/ }).click();
  await expect(page.getByRole('status')).toBeVisible();
  const row = page.locator('li', { hasText: slug });
  await expect(row).toBeVisible();

  const owner = await anonymous();
  await owner.goto(await emailedLink(ownerEmail));
  await owner.getByLabel('Choose a password').fill('fresh-owner-password');
  await owner.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(owner.getByRole('heading', { name: 'Fresh Atelier' })).toBeVisible();

  await row.getByRole('button', { name: 'Suspend' }).click();
  await expect(row.getByRole('button', { name: 'Activate' })).toBeVisible();
  const site = await (await page.request.get(`${API}/public/sites/${slug}`)).json();
  expect(site.data.available).toBe(false);
  await row.getByRole('button', { name: 'Activate' }).click();
  await expect(row.getByRole('button', { name: 'Suspend' })).toBeVisible();

  // A code can't be reused, so wait for the next one, as a person would.
  await page.waitForTimeout(31_000);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Sign in to TahiPh')).toBeVisible();
  await fillSignIn(page, run.platform);
  await expect(page.getByText('Two-factor sign-in')).toBeVisible();
  await expect(page.getByTestId('mfa-secret')).toHaveCount(0);
  await code.fill(totp(secret));
  await verify.click();
  await expect(page.getByText('Businesses')).toBeVisible();
});
