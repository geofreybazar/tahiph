import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test as base,
} from '@playwright/test';

export const run = JSON.parse(readFileSync(resolve(import.meta.dirname, '.run.json'), 'utf8')) as {
  run: string;
  password: string;
  owner: string;
  staff: string;
  rival: string;
  platform: string;
  resetter: string;
};

export const API = 'http://localhost:4101/api/v1';
const MAILPIT = 'http://127.0.0.1:54324';

export const PNG = (name: string) => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==',
    'base64',
  ),
});

export async function fillSignIn(page: Page, email: string, password = run.password) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

interface Options {
  timezoneId?: string;
  width?: number;
}

// Supabase limits sign-ins per IP, so each account signs in once per worker and reuses the session.
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

async function signedInPage(
  browser: Browser,
  email: string,
  track: (page: Page) => void,
  options: Options,
) {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1100, height: 1000 },
    timezoneId: options.timezoneId ?? 'Asia/Manila',
    storageState: sessions.get(email),
  });
  const page = await context.newPage();
  track(page);
  await page.goto('/');
  if (!sessions.has(email)) {
    await fillSignIn(page, email);
    await page.getByRole('button', { name: 'Sign out' }).waitFor();
    sessions.set(email, await context.storageState());
  }
  return page;
}

/** `as(email)` opens a signed-in page. Any page crash or 5xx fails the test that caused it. */
export const test = base.extend<{
  as: (email: string, options?: Options) => Promise<Page>;
  anonymous: () => Promise<Page>;
  problems: string[];
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument.
  problems: async ({}, use) => {
    const problems: string[] = [];
    await use(problems);
    expect(problems).toEqual([]);
  },
  as: async ({ browser, problems }, use) => {
    const pages: Page[] = [];
    await use(async (email, options = {}) => {
      const page = await signedInPage(browser, email, (p) => watch(p, problems), options);
      pages.push(page);
      return page;
    });
    for (const page of pages) await page.context().close();
  },
  anonymous: async ({ browser, problems }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      watch(page, problems);
      return page;
    });
    for (const context of contexts) await context.close();
  },
});

function watch(page: Page, problems: string[]) {
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`);
  });
  page.on('dialog', (dialog) => void dialog.accept('Wrong amount'));
}

export { expect };

export async function newClient(page: Page, name: string) {
  await page.getByRole('link', { name: 'Clients', exact: true }).click();
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  return page.url();
}

/** From a client page. Returns the order's URL. */
export async function newOrder(page: Page, title: string, price = '100,000') {
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Price (₱)').fill(price);
  await page.getByRole('button', { name: 'Add project' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
  return page.url();
}

/** From an order page. Ends on the garment page and returns its URL. */
export async function newGarment(page: Page, name: string, wearer: string) {
  await page.getByLabel('Garment', { exact: true }).fill(name);
  await page.getByLabel('Worn by').fill(wearer);
  await page.getByRole('button', { name: 'Add garment' }).click();
  await page.getByRole('link', { name: `${name} for ${wearer}` }).click();
  await expect(page.getByLabel('Move to')).toBeVisible();
  return page.url();
}

/** The newest link in an email, as a person would click it. */
export async function emailedLink(to: string): Promise<string> {
  await expect
    .poll(async () => {
      const response = await fetch(
        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
      );
      return ((await response.json()) as { messages?: unknown[] }).messages?.length ?? 0;
    })
    .toBeGreaterThan(0);
  const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  const { messages } = (await search.json()) as { messages: { ID: string }[] };
  const message = await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`);
  const { HTML, Text } = (await message.json()) as { HTML?: string; Text?: string };
  const link = (HTML || Text || '')
    .match(/https?:\/\/[^"'\s<]+/g)
    ?.find((url) => url.includes('verify'));
  if (!link) throw new Error(`No verification link in the email to ${to}`);
  return link.replaceAll('&amp;', '&');
}

/** The code an authenticator app would show right now. */
export function totp(secret: string, now = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/=+$/, '')]
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, '0'))
    .join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hash = createHmac('sha1', key).update(counter).digest();
  const offset = hash[19]! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
