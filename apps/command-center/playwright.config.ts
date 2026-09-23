import { defineConfig } from '@playwright/test';

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const authToken = process.env.COMMAND_CENTER_AUTH_TOKEN;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: externalBaseURL ?? 'http://localhost:4300',
    headless: true,
    ...(authToken ? { extraHTTPHeaders: { Authorization: `Bearer ${authToken}` } } : {}),
  },
  ...(externalBaseURL ? {} : {
    webServer: {
      command: 'pnpm dev',
      url: 'http://localhost:4300',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  }),
});
