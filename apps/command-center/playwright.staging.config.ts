import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/staging', timeout: 90_000, workers: 1, retries: 0,
  outputDir: '../../.out/command-center-staging/browser',
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL, headless: true, extraHTTPHeaders: {}, storageState: { cookies: [], origins: [] }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
