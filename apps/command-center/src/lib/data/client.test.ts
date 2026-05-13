import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppEnv } from '../../../../../packages/config/dist/env.js';
import {
  createDatabaseConnectionConfig,
  createServiceRoleDatabaseConnectionConfig,
} from './client';

test('service-role data client fails closed in production without Command Center auth', () => {
  withCleanCommandCenterEnv(() => {
    assert.throws(
      () => createServiceRoleDatabaseConnectionConfig(createEnv()),
      /Command Center auth is required/,
    );
  });
});

test('anon data client does not require Command Center app auth', () => {
  withCleanCommandCenterEnv(() => {
    const connection = createDatabaseConnectionConfig({
      env: createEnv(),
      useServiceRole: false,
    });

    assert.equal(connection.role, 'anon');
    assert.equal(connection.key, 'anon-key');
  });
});

test('service-role data client is available when production auth is configured', () => {
  withCleanCommandCenterEnv(() => {
    process.env.COMMAND_CENTER_AUTH_TOKEN = 'browser-token';
    const connection = createServiceRoleDatabaseConnectionConfig(createEnv());

    assert.equal(connection.role, 'service_role');
    assert.equal(connection.key, 'service-role-key');
  });
});

function createEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'production',
    UNIT_TALK_APP_ENV: 'production',
    UNIT_TALK_ACTIVE_WORKSPACE: 'C:\\Dev\\Unit-Talk-v2-main',
    UNIT_TALK_LEGACY_WORKSPACE: 'C:\\dev\\unit-talk-production',
    LINEAR_TEAM_KEY: 'UTV2',
    LINEAR_TEAM_NAME: 'unit-talk-v2',
    NOTION_WORKSPACE_NAME: 'unit-talk-v2',
    SLACK_WORKSPACE_NAME: 'unit-talk-v2',
    SUPABASE_URL: 'https://unit-talk.example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    ...overrides,
  };
}

function withCleanCommandCenterEnv(fn: () => void): void {
  const keys = [
    'COMMAND_CENTER_AUTH_MODE',
    'COMMAND_CENTER_AUTH_TOKEN',
    'COMMAND_CENTER_AUTH_USERNAME',
    'COMMAND_CENTER_AUTH_PASSWORD',
    'UNIT_TALK_COMMAND_CENTER_AUTH_MODE',
    'UNIT_TALK_COMMAND_CENTER_AUTH_TOKEN',
    'UNIT_TALK_COMMAND_CENTER_AUTH_USERNAME',
    'UNIT_TALK_COMMAND_CENTER_AUTH_PASSWORD',
    'UNIT_TALK_OPERATOR_RUNTIME_MODE',
  ];
  const previous = new Map<string, string | undefined>();

  for (const key of keys) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
