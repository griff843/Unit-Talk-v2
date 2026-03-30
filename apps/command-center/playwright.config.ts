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
    command: 'pnpm dev',
    url: 'http://localhost:4300',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
