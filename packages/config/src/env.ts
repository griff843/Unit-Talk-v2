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
  SGO_API_KEY_FALLBACK?: string | undefined;
  SGO_API_KEYS?: string[] | undefined;
  ODDS_API_KEY?: string | undefined;
  UNIT_TALK_INGESTOR_LEAGUES?: string | undefined;
  UNIT_TALK_INGESTOR_POLL_MS?: string | undefined;
  UNIT_TALK_INGESTOR_MAX_CYCLES?: string | undefined;
  UNIT_TALK_INGESTOR_AUTORUN?: string | undefined;
  UNIT_TALK_INGESTOR_SKIP_RESULTS?: string | undefined;
  UNIT_TALK_INGESTOR_RESULTS_LOOKBACK_HOURS?: string | undefined;
  UNIT_TALK_WORKER_ID?: string | undefined;
  UNIT_TALK_DISTRIBUTION_TARGETS?: string | undefined;
  UNIT_TALK_DISCORD_TARGET_MAP?: string | undefined;
  UNIT_TALK_WORKER_ADAPTER?: string | undefined;
  UNIT_TALK_WORKER_POLL_MS?: string | undefined;
  UNIT_TALK_WORKER_MAX_CYCLES?: string | undefined;
  UNIT_TALK_WORKER_DRY_RUN?: string | undefined;
  UNIT_TALK_WORKER_AUTORUN?: string | undefined;
  UNIT_TALK_WORKER_STALE_CLAIM_MS?: string | undefined;
  UNIT_TALK_WORKER_HEARTBEAT_MS?: string | undefined;
  UNIT_TALK_WORKER_WATCHDOG_MS?: string | undefined;
  UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD?: string | undefined;
  UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS?: string | undefined;
  WORKER_HEARTBEAT_INTERVAL_MS?: string | undefined;
  UNIT_TALK_SIMULATION_MODE?: string | undefined;
  UNIT_TALK_INGESTOR_RUNTIME_MODE?: string | undefined;
  UNIT_TALK_API_RUNTIME_MODE?: string | undefined;
  UNIT_TALK_API_MAX_BODY_BYTES?: string | undefined;
  UNIT_TALK_API_BODY_LIMIT_BYTES?: string | undefined;
  UNIT_TALK_API_SUBMISSION_RATE_LIMIT_MAX?: string | undefined;
  UNIT_TALK_API_SUBMISSION_RATE_LIMIT_WINDOW_MS?: string | undefined;
  UNIT_TALK_RATE_LIMIT_SUBMISSIONS_PER_MINUTE?: string | undefined;
  UNIT_TALK_OPERATOR_RUNTIME_MODE?: string | undefined;
  UNIT_TALK_SHADOW_MODE?: string | undefined;
  DISCORD_BOT_TOKEN?: string | undefined;
  DISCORD_CLIENT_ID?: string | undefined;
  DISCORD_GUILD_ID?: string | undefined;
  DISCORD_CAPPER_ROLE_ID?: string | undefined;
  DISCORD_OPERATOR_ROLE_ID?: string | undefined;
  DISCORD_VIP_ROLE_ID?: string | undefined;
  DISCORD_VIP_PLUS_ROLE_ID?: string | undefined;
  DISCORD_TRIAL_ROLE_ID?: string | undefined;
  DISCORD_CAPPER_CHANNEL_ID?: string | undefined;
  DISCORD_ANNOUNCEMENT_CHANNEL_ID?: string | undefined;
  UNIT_TALK_API_URL?: string | undefined;
  UNIT_TALK_API_KEY_SUBMITTER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
  NOTION_TOKEN?: string | undefined;
  SLACK_BOT_TOKEN?: string | undefined;
  SLACK_SIGNING_SECRET?: string | undefined;
  SYSTEM_PICK_SCANNER_ENABLED?: string | undefined;
  SYSTEM_PICK_SCANNER_LOOKBACK_HOURS?: string | undefined;
  SYSTEM_PICK_SCANNER_MAX_PICKS?: string | undefined;
  SYNDICATE_MACHINE_ENABLED?: string | undefined;
  /** Discord webhook URL for ops staleness alerts (grading-cron, ingestor). Fire-and-forget POST. */
  UNIT_TALK_OPS_ALERT_WEBHOOK_URL?: string | undefined;
}

function parseEnvFileEntries(filePath: string) {
  const entries: Array<[string, string]> = [];

  if (!fs.existsSync(filePath)) {
    return entries;
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
    entries.push([key, value]);
  }

  return entries;
}

export function loadEnvironment(rootDir = process.cwd()): AppEnv {
  const templateEntries = parseEnvFileEntries(path.join(rootDir, '.env.example'));
  const envEntries = parseEnvFileEntries(path.join(rootDir, '.env'));
  const localEntries = parseEnvFileEntries(path.join(rootDir, 'local.env'));
  const merged = new Map<string, string>();

  for (const [key, value] of templateEntries) {
    merged.set(key, value);
  }

  for (const [key, value] of envEntries) {
    merged.set(key, value);
  }

  for (const [key, value] of localEntries) {
    merged.set(key, value);
  }

  const configuredSgoKeys = collectConfiguredSgoApiKeys(
    templateEntries,
    envEntries,
    localEntries,
    process.env.SGO_API_KEYS,
  );

  const env: AppEnv = {
    NODE_ENV: normalizeNodeEnv(readEnvValue('NODE_ENV', merged)),
    UNIT_TALK_APP_ENV: normalizeAppEnv(readEnvValue('UNIT_TALK_APP_ENV', merged)),
    UNIT_TALK_ACTIVE_WORKSPACE: optionalEnv('UNIT_TALK_ACTIVE_WORKSPACE', merged) ?? 'unit-talk-v2',
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
    SGO_API_KEY_FALLBACK: optionalEnv('SGO_API_KEY_FALLBACK', merged),
    ...(configuredSgoKeys.length > 0 ? { SGO_API_KEYS: configuredSgoKeys } : {}),
    ODDS_API_KEY: optionalEnv('ODDS_API_KEY', merged),
    UNIT_TALK_INGESTOR_LEAGUES: optionalEnv('UNIT_TALK_INGESTOR_LEAGUES', merged),
    UNIT_TALK_INGESTOR_POLL_MS: optionalEnv('UNIT_TALK_INGESTOR_POLL_MS', merged),
    UNIT_TALK_INGESTOR_MAX_CYCLES: optionalEnv('UNIT_TALK_INGESTOR_MAX_CYCLES', merged),
    UNIT_TALK_INGESTOR_AUTORUN: optionalEnv('UNIT_TALK_INGESTOR_AUTORUN', merged),
    UNIT_TALK_INGESTOR_SKIP_RESULTS: optionalEnv('UNIT_TALK_INGESTOR_SKIP_RESULTS', merged),
    UNIT_TALK_INGESTOR_RESULTS_LOOKBACK_HOURS: optionalEnv('UNIT_TALK_INGESTOR_RESULTS_LOOKBACK_HOURS', merged),
    UNIT_TALK_WORKER_ID: optionalEnv('UNIT_TALK_WORKER_ID', merged),
    UNIT_TALK_DISTRIBUTION_TARGETS: optionalEnv('UNIT_TALK_DISTRIBUTION_TARGETS', merged),
    UNIT_TALK_DISCORD_TARGET_MAP: optionalEnv('UNIT_TALK_DISCORD_TARGET_MAP', merged),
    UNIT_TALK_WORKER_ADAPTER: optionalEnv('UNIT_TALK_WORKER_ADAPTER', merged),
    UNIT_TALK_WORKER_POLL_MS: optionalEnv('UNIT_TALK_WORKER_POLL_MS', merged),
    UNIT_TALK_WORKER_MAX_CYCLES: optionalEnv('UNIT_TALK_WORKER_MAX_CYCLES', merged),
    UNIT_TALK_WORKER_DRY_RUN: optionalEnv('UNIT_TALK_WORKER_DRY_RUN', merged),
    UNIT_TALK_WORKER_AUTORUN: optionalEnv('UNIT_TALK_WORKER_AUTORUN', merged),
    UNIT_TALK_WORKER_STALE_CLAIM_MS: optionalEnv('UNIT_TALK_WORKER_STALE_CLAIM_MS', merged),
    UNIT_TALK_WORKER_HEARTBEAT_MS: optionalEnv('UNIT_TALK_WORKER_HEARTBEAT_MS', merged),
    UNIT_TALK_WORKER_WATCHDOG_MS: optionalEnv('UNIT_TALK_WORKER_WATCHDOG_MS', merged),
    UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD: optionalEnv(
      'UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD',
      merged,
    ),
    UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS: optionalEnv(
      'UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS',
      merged,
    ),
    WORKER_HEARTBEAT_INTERVAL_MS: optionalEnv('WORKER_HEARTBEAT_INTERVAL_MS', merged),
    UNIT_TALK_SIMULATION_MODE: optionalEnv('UNIT_TALK_SIMULATION_MODE', merged),
    UNIT_TALK_INGESTOR_RUNTIME_MODE: optionalEnv('UNIT_TALK_INGESTOR_RUNTIME_MODE', merged),
    UNIT_TALK_API_RUNTIME_MODE: optionalEnv('UNIT_TALK_API_RUNTIME_MODE', merged),
    UNIT_TALK_API_MAX_BODY_BYTES: optionalEnv('UNIT_TALK_API_MAX_BODY_BYTES', merged),
    UNIT_TALK_API_BODY_LIMIT_BYTES: optionalEnv('UNIT_TALK_API_BODY_LIMIT_BYTES', merged),
    UNIT_TALK_API_SUBMISSION_RATE_LIMIT_MAX: optionalEnv(
      'UNIT_TALK_API_SUBMISSION_RATE_LIMIT_MAX',
      merged,
    ),
    UNIT_TALK_API_SUBMISSION_RATE_LIMIT_WINDOW_MS: optionalEnv(
      'UNIT_TALK_API_SUBMISSION_RATE_LIMIT_WINDOW_MS',
      merged,
    ),
    UNIT_TALK_RATE_LIMIT_SUBMISSIONS_PER_MINUTE: optionalEnv(
      'UNIT_TALK_RATE_LIMIT_SUBMISSIONS_PER_MINUTE',
      merged,
    ),
    UNIT_TALK_OPERATOR_RUNTIME_MODE: optionalEnv('UNIT_TALK_OPERATOR_RUNTIME_MODE', merged),
    DISCORD_BOT_TOKEN: optionalEnv('DISCORD_BOT_TOKEN', merged),
    DISCORD_CLIENT_ID: optionalEnv('DISCORD_CLIENT_ID', merged),
    DISCORD_GUILD_ID: optionalEnv('DISCORD_GUILD_ID', merged),
    DISCORD_CAPPER_ROLE_ID: optionalEnv('DISCORD_CAPPER_ROLE_ID', merged),
    DISCORD_OPERATOR_ROLE_ID: optionalEnv('DISCORD_OPERATOR_ROLE_ID', merged),
    DISCORD_VIP_ROLE_ID: optionalEnv('DISCORD_VIP_ROLE_ID', merged),
    DISCORD_VIP_PLUS_ROLE_ID: optionalEnv('DISCORD_VIP_PLUS_ROLE_ID', merged),
    DISCORD_TRIAL_ROLE_ID: optionalEnv('DISCORD_TRIAL_ROLE_ID', merged),
    DISCORD_CAPPER_CHANNEL_ID: optionalEnv('DISCORD_CAPPER_CHANNEL_ID', merged),
    DISCORD_ANNOUNCEMENT_CHANNEL_ID: optionalEnv('DISCORD_ANNOUNCEMENT_CHANNEL_ID', merged),
    UNIT_TALK_API_URL: optionalEnv('UNIT_TALK_API_URL', merged),
    UNIT_TALK_API_KEY_SUBMITTER: optionalEnv('UNIT_TALK_API_KEY_SUBMITTER', merged),
    OPENAI_API_KEY: optionalEnv('OPENAI_API_KEY', merged),
    NOTION_TOKEN: optionalEnv('NOTION_TOKEN', merged),
    SLACK_BOT_TOKEN: optionalEnv('SLACK_BOT_TOKEN', merged),
    SLACK_SIGNING_SECRET: optionalEnv('SLACK_SIGNING_SECRET', merged),
    SYSTEM_PICK_SCANNER_ENABLED: optionalEnv('SYSTEM_PICK_SCANNER_ENABLED', merged),
    SYSTEM_PICK_SCANNER_LOOKBACK_HOURS: optionalEnv('SYSTEM_PICK_SCANNER_LOOKBACK_HOURS', merged),
    SYSTEM_PICK_SCANNER_MAX_PICKS: optionalEnv('SYSTEM_PICK_SCANNER_MAX_PICKS', merged),
    SYNDICATE_MACHINE_ENABLED: optionalEnv('SYNDICATE_MACHINE_ENABLED', merged),
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

function collectConfiguredSgoApiKeys(
  ...sources: Array<Array<[string, string]> | string | undefined>
) {
  const configured: string[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    if (typeof source === 'string') {
      for (const value of source.split(',')) {
        pushUniqueSgoKey(configured, seen, value);
      }
      continue;
    }

    for (const [key, value] of source ?? []) {
      if (key !== 'SGO_API_KEY' && key !== 'SGO_API_KEY_FALLBACK') {
        continue;
      }
      pushUniqueSgoKey(configured, seen, value);
    }
  }

  return configured;
}

function pushUniqueSgoKey(target: string[], seen: Set<string>, rawValue: string) {
  const value = rawValue.trim();
  if (!value || seen.has(value)) {
    return;
  }

  seen.add(value);
  target.push(value);
}
