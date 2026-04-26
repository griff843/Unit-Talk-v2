import { access, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const AUTH_TIMEOUT_MS = 300_000;

export function personaStorageStatePath(product: string, persona: string): string {
  return resolve(process.cwd(), 'personas', `${product}-${persona}.json`);
}

export async function storageStateExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function assertStorageState(product: string, persona: string): Promise<string> {
  const path = personaStorageStatePath(product, persona);
  if (!(await storageStateExists(path))) {
    throw new Error(
      `Missing Playwright storage state for ${product}/${persona}: ${path}. ` +
      `Run pnpm qa:auth --product ${product} --persona ${persona}.`,
    );
  }
  return path;
}

export async function seedAuthState(options: {
  product: string;
  persona: string;
  loginUrl: string;
  successUrl?: string;
}): Promise<string> {
  const storagePath = personaStorageStatePath(options.product, options.persona);
  await mkdir(dirname(storagePath), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`Opening ${options.loginUrl}`);
  console.log('Complete login in the browser. Waiting for an authenticated state...');
  await page.goto(options.loginUrl, { waitUntil: 'domcontentloaded' });

  const startedAt = Date.now();
  while (Date.now() - startedAt < AUTH_TIMEOUT_MS) {
    await page.waitForTimeout(1000);
    const url = page.url();
    if (!url.includes('/login') && (!options.successUrl || url.startsWith(options.successUrl))) {
      await context.storageState({ path: storagePath });
      await browser.close();
      return storagePath;
    }
  }

  await browser.close();
  throw new Error('Timed out waiting for authenticated state.');
}
