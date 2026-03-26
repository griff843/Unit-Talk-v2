import fs from 'node:fs';
import path from 'node:path';
export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  UNIT_TALK_APP_ENV: 'local' | 'ci' | 'staging' | 'production';
  UNIT_TALK_ACTIVE_WORKSPACE: string;
  UNIT_TALK_LEGACY_WORKSPACE: string;
  LINEAR_API_TOKEN?: string | undefined;
  LINEAR_TEAM_ID?: string | undefined;
  LINEAR_TEAM_KEY: string;
  LINEAR_TEAM_NAME: string;
  NOTION_WORKSPACE_NAME: string;
  SLACK_WORKSPACE_NAME: string;
  SUPABASE_PROJECT_REF?: string | undefined;
  SUPABASE_URL?: string | undefined;
  SUPABASE_ANON_KEY?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
  SGO_API_KEY?: string | undefined;
  UNIT_TALK_INGESTOR_LEAGUES?: string | undefined;
  UNIT_TALK_INGESTOR_POLL_MS?: string | undefined;
  UNIT_TALK_INGESTOR_MAX_CYCLES?: string | undefined;
  UNIT_TALK_INGESTOR_AUTORUN?: string | undefined;
  UNIT_TALK_INGESTOR_SKIP_RESULTS?: string | undefined;
  UNIT_TALK_INGESTOR_RESULTS_LOOKBACK_HOURS?: string | undefined;
  DISCORD_BOT_TOKEN?: string | undefined;
  DISCORD_CLIENT_ID?: string | undefined;
  DISCORD_GUILD_ID?: string | undefined;
  DISCORD_CAPPER_ROLE_ID?: string | undefined;
  DISCORD_ANNOUNCEMENT_CHANNEL_ID?: string | undefined;
  UNIT_TALK_API_URL?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
  NOTION_TOKEN?: string | undefined;
  SLACK_BOT_TOKEN?: string | undefined;
  SLACK_SIGNING_SECRET?: string | undefined;
}

function parseEnvFile(filePath: string) {
  const values = new Map<string, string>();

  if (!fs.existsSync(filePath)) {
    return values;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  return values;
}

export function loadEnvironment(rootDir = process.cwd()): AppEnv {
  const templateValues = parseEnvFile(path.join(rootDir, '.env.example'));
  const envValues = parseEnvFile(path.join(rootDir, '.env'));
  const localValues = parseEnvFile(path.join(rootDir, 'local.env'));
  const merged = new Map<string, string>();

  for (const [key, value] of templateValues) {
    merged.set(key, value);
  }

  for (const [key, value] of envValues) {
    merged.set(key, value);
  }

  for (const [key, value] of localValues) {
    merged.set(key, value);
  }

  const env: AppEnv = {
    NODE_ENV: normalizeNodeEnv(readEnvValue('NODE_ENV', merged)),
    UNIT_TALK_APP_ENV: normalizeAppEnv(readEnvValue('UNIT_TALK_APP_ENV', merged)),
    UNIT_TALK_ACTIVE_WORKSPACE: requireEnv('UNIT_TALK_ACTIVE_WORKSPACE', merged),
    UNIT_TALK_LEGACY_WORKSPACE: requireEnv('UNIT_TALK_LEGACY_WORKSPACE', merged),
    LINEAR_API_TOKEN: optionalEnv('LINEAR_API_TOKEN', merged),
    LINEAR_TEAM_ID: optionalEnv('LINEAR_TEAM_ID', merged),
    LINEAR_TEAM_KEY: requireEnv('LINEAR_TEAM_KEY', merged),
    LINEAR_TEAM_NAME: requireEnv('LINEAR_TEAM_NAME', merged),
    NOTION_WORKSPACE_NAME: requireEnv('NOTION_WORKSPACE_NAME', merged),
    SLACK_WORKSPACE_NAME: requireEnv('SLACK_WORKSPACE_NAME', merged),
    SUPABASE_PROJECT_REF: optionalEnv('SUPABASE_PROJECT_REF', merged),
    SUPABASE_URL: optionalEnv('SUPABASE_URL', merged),
    SUPABASE_ANON_KEY: optionalEnv('SUPABASE_ANON_KEY', merged),
    SUPABASE_SERVICE_ROLE_KEY: optionalEnv('SUPABASE_SERVICE_ROLE_KEY', merged),
    SGO_API_KEY: optionalEnv('SGO_API_KEY', merged),
    UNIT_TALK_INGESTOR_LEAGUES: optionalEnv('UNIT_TALK_INGESTOR_LEAGUES', merged),
    UNIT_TALK_INGESTOR_POLL_MS: optionalEnv('UNIT_TALK_INGESTOR_POLL_MS', merged),
    UNIT_TALK_INGESTOR_MAX_CYCLES: optionalEnv('UNIT_TALK_INGESTOR_MAX_CYCLES', merged),
    UNIT_TALK_INGESTOR_AUTORUN: optionalEnv('UNIT_TALK_INGESTOR_AUTORUN', merged),
    UNIT_TALK_INGESTOR_SKIP_RESULTS: optionalEnv('UNIT_TALK_INGESTOR_SKIP_RESULTS', merged),
    UNIT_TALK_INGESTOR_RESULTS_LOOKBACK_HOURS: optionalEnv('UNIT_TALK_INGESTOR_RESULTS_LOOKBACK_HOURS', merged),
    DISCORD_BOT_TOKEN: optionalEnv('DISCORD_BOT_TOKEN', merged),
    DISCORD_CLIENT_ID: optionalEnv('DISCORD_CLIENT_ID', merged),
    DISCORD_GUILD_ID: optionalEnv('DISCORD_GUILD_ID', merged),
    DISCORD_CAPPER_ROLE_ID: optionalEnv('DISCORD_CAPPER_ROLE_ID', merged),
    DISCORD_ANNOUNCEMENT_CHANNEL_ID: optionalEnv('DISCORD_ANNOUNCEMENT_CHANNEL_ID', merged),
    UNIT_TALK_API_URL: optionalEnv('UNIT_TALK_API_URL', merged),
    OPENAI_API_KEY: optionalEnv('OPENAI_API_KEY', merged),
    NOTION_TOKEN: optionalEnv('NOTION_TOKEN', merged),
    SLACK_BOT_TOKEN: optionalEnv('SLACK_BOT_TOKEN', merged),
    SLACK_SIGNING_SECRET: optionalEnv('SLACK_SIGNING_SECRET', merged),
  };

  return env;
}

export function requireSupabaseEnvironment(env: AppEnv) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required for Supabase access.',
    );
  }

  return {
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function requireEnv(key: string, merged: Map<string, string>) {
  const value = readEnvValue(key, merged);
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }

  return value;
}

function optionalEnv(key: string, merged: Map<string, string>) {
  const value = readEnvValue(key, merged);
  return value && value.length > 0 ? value : undefined;
}

function readEnvValue(key: string, merged: Map<string, string>) {
  const processValue = process.env[key];
  if (processValue && processValue.length > 0) {
    return processValue;
  }

  return merged.get(key);
}

function normalizeNodeEnv(value: string | undefined): AppEnv['NODE_ENV'] {
  if (value === 'test' || value === 'production') {
    return value;
  }

  return 'development';
}

function normalizeAppEnv(value: string | undefined): AppEnv['UNIT_TALK_APP_ENV'] {
  if (value === 'ci' || value === 'staging' || value === 'production') {
    return value;
  }

  return 'local';
}
