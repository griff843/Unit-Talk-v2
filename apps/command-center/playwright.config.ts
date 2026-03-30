import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4300',
    headless: true,
  },
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:4300',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
