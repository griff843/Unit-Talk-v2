import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4100',
    headless: true,
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:4100/submit',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
