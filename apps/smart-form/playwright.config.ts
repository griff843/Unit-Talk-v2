import { defineConfig } from '@playwright/test';

const apiBaseUrl = 'http://127.0.0.1:4000';
const smartFormBaseUrl = 'http://127.0.0.1:4100';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: smartFormBaseUrl,
    headless: true,
  },
  webServer: [
    {
      command: 'pnpm --dir ../api dev',
      url: `${apiBaseUrl}/api/health/runtime`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: '4000',
        NODE_ENV: 'test',
        UNIT_TALK_APP_ENV: 'local',
        UNIT_TALK_API_RUNTIME_MODE: 'fail_open',
        UNIT_TALK_API_RATE_LIMIT_STORE: 'memory',
        UNIT_TALK_LEGACY_WORKSPACE: 'unused-by-smart-form-e2e',
        LINEAR_TEAM_KEY: 'UTV2',
        LINEAR_TEAM_NAME: 'unit-talk-v2',
        NOTION_WORKSPACE_NAME: 'unit-talk-v2',
        SLACK_WORKSPACE_NAME: 'unit-talk-v2',
        SYNDICATE_MACHINE_ENABLED: 'false',
        SYSTEM_PICK_SCANNER_ENABLED: 'false',
        UNIT_TALK_QA_SEED_ENABLED: 'true',
        SUPABASE_PROJECT_REF: '',
        SUPABASE_URL: '',
        SUPABASE_ANON_KEY: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        UNIT_TALK_API_KEY_OPERATOR: '',
        UNIT_TALK_API_KEY_SUBMITTER: '',
        UNIT_TALK_API_KEY_SETTLER: '',
        UNIT_TALK_API_KEY_POSTER: '',
        UNIT_TALK_API_KEY_WORKER: '',
        UNIT_TALK_CC_API_KEY: '',
        UNIT_TALK_INGESTOR_API_KEY: '',
        UNIT_TALK_BOT_API_KEY: '',
        UNIT_TALK_JWT_SECRET: '',
        LOKI_URL: '',
      },
    },
    {
      command: 'pnpm dev',
      url: `${smartFormBaseUrl}/submit`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
      },
    },
  ],
});
