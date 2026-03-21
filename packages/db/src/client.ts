import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnvironment, requireSupabaseEnvironment, type AppEnv } from '@unit-talk/config';

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
  const supabase = requireSupabaseEnvironment(env);
  const useServiceRole = options.useServiceRole ?? false;

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

export function createDatabaseClient(
  options: DatabaseClientOptions = {},
): UnitTalkSupabaseClient {
  const connection = createDatabaseConnectionConfig(options);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<any>(connection.url, connection.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createDatabaseClientFromConnection(
  connection: DatabaseConnectionConfig,
): UnitTalkSupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<any>(connection.url, connection.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
