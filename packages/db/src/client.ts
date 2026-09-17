import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEnvironment, requireSupabaseEnvironment, type AppEnv } from '@unit-talk/config';
import { createPrivilegedClient } from './privileged-client-boundary.js';

export interface DatabaseClientOptions {
  env?: AppEnv | undefined;
  useServiceRole?: boolean;
}

export interface DatabaseConnectionConfig {
  url: string;
  key: string;
  role: 'anon' | 'service_role';
}

// The generated Supabase Database type is still hand-shaped in this repo, so we
// relax the client generic at the boundary and keep stricter row aliases in
// packages/db/src/types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UnitTalkSupabaseClient = SupabaseClient<any>;

export function createDatabaseConnectionConfig(
  options: DatabaseClientOptions = {},
): DatabaseConnectionConfig {
  const env = options.env ?? loadEnvironment();
  const useServiceRole = options.useServiceRole ?? false;

  // UTV2-1923: resolve the role first, then demand only that role's credential.
  // Previously both keys were required here and one was discarded, so a
  // service-role-only deployment could not build a connection it was fully
  // configured for.
  return requireSupabaseEnvironment(env, useServiceRole ? 'service_role' : 'anon');
}

export function createServiceRoleDatabaseConnectionConfig(
  env?: AppEnv,
): DatabaseConnectionConfig {
  return createDatabaseConnectionConfig({ env, useServiceRole: true });
}

export function createDatabaseClient(
  options: DatabaseClientOptions = {},
): UnitTalkSupabaseClient {
  return createDatabaseClientFromConnection(createDatabaseConnectionConfig(options));
}

export function createDatabaseClientFromConnection(
  connection: DatabaseConnectionConfig,
): UnitTalkSupabaseClient {
  // Both public constructors funnel here, and here alone opens the connection —
  // through the UTV2-1628 boundary, which refuses a non-staging target from a
  // test process before any socket exists.
  return createPrivilegedClient(
    connection.url,
    connection.key,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
    `@unit-talk/db ${connection.role} client`,
  );
}
