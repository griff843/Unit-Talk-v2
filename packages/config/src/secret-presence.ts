import type { AppEnv } from './env.js';

export type SecretPresenceClass = 'present' | 'missing' | 'placeholder';

export interface SecretPresence {
  key: string;
  class: SecretPresenceClass;
}

export interface SecretGroupResult {
  name: string;
  keys: readonly string[];
  allPresent: boolean;
  anyPresent: boolean;
  entries: SecretPresence[];
}

export interface SecretPresenceReport {
  timestamp: string;
  productionLike: boolean;
  groups: SecretGroupResult[];
  allGroupsPresent: boolean;
}

const PLACEHOLDER_PATTERNS = [
  /^your[-_]/i,
  /^replace[-_]?me/i,
  /^change[-_]?me$/i,
  /^<[^>]+>$/,
  /^placeholder/i,
  /^x{3,}$/i,
  /^example[-_]/i,
  /^todo$/i,
  /^(null|undefined|none)$/i,
];

const PRODUCTION_SECRET_GROUPS: ReadonlyArray<{
  name: string;
  keys: readonly string[];
}> = [
  {
    name: 'database',
    keys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  },
  {
    name: 'discord',
    keys: ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID'],
  },
  {
    name: 'api_auth',
    keys: ['UNIT_TALK_BOT_API_KEY', 'UNIT_TALK_INGESTOR_API_KEY'],
  },
];

function detectPresenceClass(value: string | undefined): SecretPresenceClass {
  if (!value || value.trim().length === 0) {
    return 'missing';
  }
  const trimmed = value.trim();
  if (PLACEHOLDER_PATTERNS.some((p) => p.test(trimmed))) {
    return 'placeholder';
  }
  return 'present';
}

function checkGroup(env: AppEnv, name: string, keys: readonly string[]): SecretGroupResult {
  const envMap = env as unknown as Record<string, string | undefined>;
  const entries: SecretPresence[] = keys.map((key) => ({
    key,
    class: detectPresenceClass(envMap[key]),
  }));
  return {
    name,
    keys,
    allPresent: entries.every((e) => e.class === 'present'),
    anyPresent: entries.some((e) => e.class === 'present'),
    entries,
  };
}

export function checkProductionSecretPresence(env: AppEnv): SecretPresenceReport {
  const productionLike =
    env.UNIT_TALK_APP_ENV === 'production' ||
    env.UNIT_TALK_APP_ENV === 'staging' ||
    env.NODE_ENV === 'production';

  const groups = PRODUCTION_SECRET_GROUPS.map((g) => checkGroup(env, g.name, g.keys));

  return {
    timestamp: new Date().toISOString(),
    productionLike,
    groups,
    allGroupsPresent: groups.every((g) => g.allPresent),
  };
}

// Returns a log-safe object — keys and presence classes only, no secret values
export function formatSecretPresenceLog(report: SecretPresenceReport): Record<string, unknown> {
  return {
    event: 'secret_presence_check',
    timestamp: report.timestamp,
    production_like: report.productionLike,
    all_groups_present: report.allGroupsPresent,
    groups: report.groups.map((g) => ({
      name: g.name,
      all_present: g.allPresent,
      any_present: g.anyPresent,
      entries: g.entries.map((e) => ({ key: e.key, class: e.class })),
    })),
  };
}

// Throws if any required production secret is missing or is a placeholder value
export function assertProductionSecrets(env: AppEnv): SecretPresenceReport {
  const report = checkProductionSecretPresence(env);

  if (!report.productionLike) {
    return report;
  }

  const invalid = report.groups.flatMap((g) =>
    g.entries
      .filter((e) => e.class !== 'present')
      .map((e) => `${g.name}/${e.key} (${e.class})`),
  );

  if (invalid.length > 0) {
    throw new Error(
      `Production startup blocked — required secrets are invalid: ${invalid.join(', ')}`,
    );
  }

  return report;
}
