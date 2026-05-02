import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const PERSONA_ENV_VARS = [
  { id: 'free', env: 'QA_AUTH_FREE' },
  { id: 'trial_user', env: 'QA_AUTH_TRIAL' },
  { id: 'vip', env: 'QA_AUTH_VIP' },
  { id: 'vip_plus_user', env: 'QA_AUTH_VIP_PLUS' },
  { id: 'operator', env: 'QA_AUTH_OPERATOR' },
] as const;

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMAND_CENTER_URL = process.env['COMMAND_CENTER_URL'] ?? 'http://localhost:3000';

function parseCredentials(value: string): { email: string; password: string } {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error('Expected credential format email:password.');
  }

  return {
    email: value.slice(0, separatorIndex),
    password: value.slice(separatorIndex + 1),
  };
}

function storageStatePath(personaId: string): string {
  return resolve(APP_ROOT, 'personas', `unit-talk-${personaId}.json`);
}

async function fillFirstAvailable(page: Page, selectors: string[], value: string): Promise<void> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.fill(value);
      return;
    }
  }

  throw new Error(`Could not find input matching selectors: ${selectors.join(', ')}`);
}

async function submitLogin(page: Page): Promise<void> {
  const submit = page.locator([
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'button:has-text("Sign In")',
  ].join(', ')).first();

  if (await submit.count().catch(() => 0)) {
    await submit.click();
    return;
  }

  await page.keyboard.press('Enter');
}

async function seedPersona(personaId: string, credentialValue: string): Promise<string> {
  const credentials = parseCredentials(credentialValue);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const storagePath = storageStatePath(personaId);

  try {
    await mkdir(dirname(storagePath), { recursive: true });
    await page.goto(COMMAND_CENTER_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (!/\/login(?:[/?#]|$)/i.test(page.url())) {
      await page.goto(new URL('/login', COMMAND_CENTER_URL).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
    }

    await fillFirstAvailable(page, [
      'input[type="email"]',
      'input[name="email" i]',
      'input[id*="email" i]',
      'input[autocomplete="email"]',
    ], credentials.email);
    await fillFirstAvailable(page, [
      'input[type="password"]',
      'input[name="password" i]',
      'input[id*="password" i]',
      'input[autocomplete="current-password"]',
    ], credentials.password);

    await Promise.all([
      page.waitForURL((url) => !/\/login(?:[/?#]|$)/i.test(url.pathname), { timeout: 30_000 }),
      submitLogin(page),
    ]);
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
    await context.storageState({ path: storagePath });
    return storagePath;
  } finally {
    await browser.close();
  }
}

for (const persona of PERSONA_ENV_VARS) {
  const credentialValue = process.env[persona.env];
  if (!credentialValue) {
    console.warn(`[seed] Skipping ${persona.id}: ${persona.env} is not set.`);
    continue;
  }

  try {
    const path = await seedPersona(persona.id, credentialValue);
    console.log(`[seed] Saved ${persona.id} storage state: ${path}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to seed ${persona.id} from ${persona.env}: ${message}`);
  }
}
