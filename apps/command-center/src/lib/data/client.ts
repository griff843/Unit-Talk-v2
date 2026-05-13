import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  loadEnvironment,
  requireSupabaseEnvironment,
  type AppEnv,
} from '../../../../../packages/config/dist/env.js';
import { assertCommandCenterAuthConfig } from '../server-api';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface DatabaseConnectionConfig {
  url: string;
  key: string;
  role: 'anon' | 'service_role';
}

interface DatabaseClientOptions {
  env?: AppEnv | undefined;
  useServiceRole?: boolean;
}

let _client: SupabaseClient | null = null;

function resolveWorkspaceRoot() {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    '..',
  );
}

export function createDatabaseConnectionConfig(
  options: DatabaseClientOptions = {},
): DatabaseConnectionConfig {
  const env = options.env ?? loadEnvironment(resolveWorkspaceRoot());
  const supabase = requireSupabaseEnvironment(env);
  const useServiceRole = options.useServiceRole ?? false;

  if (useServiceRole) {
    assertCommandCenterAuthConfig(toCommandCenterAuthEnv(env));
  }

  return {
    url: supabase.url,
    key: useServiceRole ? supabase.serviceRoleKey : supabase.anonKey,
    role: useServiceRole ? 'service_role' : 'anon',
  };
}

export function createServiceRoleDatabaseConnectionConfig(
  env?: AppEnv,
): DatabaseConnectionConfig {
  return createDatabaseConnectionConfig({ env, useServiceRole: true });
}

export function createDatabaseClientFromConnection(
  connection: DatabaseConnectionConfig,
): SupabaseClient {
  return createClient(connection.url, connection.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function getDataClient(): SupabaseClient {
  if (!_client) {
    const env = loadEnvironment(resolveWorkspaceRoot());
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    _client = createDatabaseClientFromConnection(connection);
  }
  return _client;
}

export const OUTBOX_HISTORY_CUTOFF = '2026-03-20T00:00:00.000Z';

function toCommandCenterAuthEnv(env: AppEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: env.NODE_ENV,
    UNIT_TALK_APP_ENV: env.UNIT_TALK_APP_ENV,
    UNIT_TALK_OPERATOR_RUNTIME_MODE: env.UNIT_TALK_OPERATOR_RUNTIME_MODE,
  };
}
