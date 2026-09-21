import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testDir: './e2e/recovery',
  use: { ...base.use, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
