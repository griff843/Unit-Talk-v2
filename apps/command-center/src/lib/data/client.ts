import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseClientFromConnection,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

let _client: SupabaseClient | null = null;

function resolveWorkspaceRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
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
