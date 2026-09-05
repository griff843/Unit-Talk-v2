import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadEnvironment,
  type AppEnv,
} from '../../../../../packages/config/dist/env.js';
import {
  createDatabaseConnectionConfig as createSharedConnectionConfig,
  createDatabaseClientFromConnection as createSharedClientFromConnection,
  type DatabaseConnectionConfig,
  type DatabaseClientOptions as SharedDatabaseClientOptions,
} from '../../../../../packages/db/dist/client.js';
import { assertCommandCenterAuthConfig } from '../server-api';
import { assertPrivilegedRequestAuthenticated } from '../request-auth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * UTV2-1628 — this module used to carry its own copy of the connection builder
 * and its own `createClient(...)` call, so `@unit-talk/db`'s behaviour and this
 * app's behaviour could drift silently and neither passed any target check.
 *
 * Both now come from `@unit-talk/db`: the shape of the connection from
 * `createDatabaseConnectionConfig`, and the connection itself from
 * `createDatabaseClientFromConnection`, which opens it through the privileged
 * client boundary. What remains local is the one thing that is genuinely
 * Command Center's: the operator-auth precondition on service-role access, and
 * the workspace root this app resolves its environment from.
 *
 * The import is the built `dist` entry rather than the workspace source,
 * matching how this file already reaches `@unit-talk/config` — Next's bundler
 * does not transpile TypeScript out of the workspace packages.
 */
export type { DatabaseConnectionConfig };

type DatabaseClientOptions = SharedDatabaseClientOptions;

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
  const useServiceRole = options.useServiceRole ?? false;

  if (useServiceRole) {
    assertCommandCenterAuthConfig(toCommandCenterAuthEnv(env));
  }

  return createSharedConnectionConfig({ env, useServiceRole });
}

export function createServiceRoleDatabaseConnectionConfig(
  env?: AppEnv,
): DatabaseConnectionConfig {
  return createDatabaseConnectionConfig({ env, useServiceRole: true });
}

export function createDatabaseClientFromConnection(
  connection: DatabaseConnectionConfig,
): SupabaseClient {
  return createSharedClientFromConnection(connection);
}

export async function getDataClient(): Promise<SupabaseClient> {
  await assertPrivilegedRequestAuthenticated();
  if (!_client) {
    const env = loadEnvironment(resolveWorkspaceRoot());
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    _client = createDatabaseClientFromConnection(connection);
  }
  return _client;
}

export const OUTBOX_HISTORY_CUTOFF = '2026-03-20T00:00:00.000Z';

/**
 * Test and proof rows are intentionally retained for auditability, but must
 * never contribute to operator-facing production metrics or queues.
 */
export function isTestFixturePick(row: Record<string, unknown>): boolean {
  const metadata = asRecord(row['metadata']);
  if (
    metadata['testRun'] === true ||
    metadata['proof_issue'] != null ||
    metadata['proof_fixture_id'] != null ||
    metadata['proof_script'] != null ||
    metadata['test_key'] != null
  ) {
    return true;
  }

  return typeof row['selection'] === 'string' && /proof/i.test(row['selection']);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toCommandCenterAuthEnv(env: AppEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: env.NODE_ENV,
    UNIT_TALK_APP_ENV: env.UNIT_TALK_APP_ENV,
    UNIT_TALK_OPERATOR_RUNTIME_MODE: env.UNIT_TALK_OPERATOR_RUNTIME_MODE,
  };
}
