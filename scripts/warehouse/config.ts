/**
 * Warehouse configuration and secret handling.
 *
 * Two rules govern this module:
 *
 *   1. No secret value is ever returned in a describable/loggable shape. The
 *      exporter runs in CI and in a scheduled runner whose logs are retained;
 *      `describeConfig()` therefore reports presence classes only, and that is
 *      the only thing any command is allowed to print.
 *   2. Missing configuration fails closed. A warehouse that silently falls back
 *      to "no object store configured, skipping upload" would let a prune gate
 *      pass on an archive that does not exist.
 *
 * Nothing here is written to the repository. Values arrive as environment
 * variables supplied by the sanctioned secret store (GitHub Actions secrets for
 * the conveyor, the operator's shell for a manual run).
 */

export const WAREHOUSE_ENV_KEYS = {
  endpoint: 'UNIT_TALK_WAREHOUSE_S3_ENDPOINT',
  region: 'UNIT_TALK_WAREHOUSE_S3_REGION',
  bucket: 'UNIT_TALK_WAREHOUSE_S3_BUCKET',
  accessKeyId: 'UNIT_TALK_WAREHOUSE_S3_ACCESS_KEY_ID',
  secretAccessKey: 'UNIT_TALK_WAREHOUSE_S3_SECRET_ACCESS_KEY',
  readAccessKeyId: 'UNIT_TALK_WAREHOUSE_S3_READ_ACCESS_KEY_ID',
  readSecretAccessKey: 'UNIT_TALK_WAREHOUSE_S3_READ_SECRET_ACCESS_KEY',
  forcePathStyle: 'UNIT_TALK_WAREHOUSE_S3_FORCE_PATH_STYLE',
  sourceDsn: 'UNIT_TALK_WAREHOUSE_SOURCE_DSN',
  localRoot: 'UNIT_TALK_WAREHOUSE_LOCAL_ROOT',
} as const;

/** Keys whose values must never be printed, echoed, or written to an artifact. */
export const SECRET_ENV_KEYS: readonly string[] = [
  WAREHOUSE_ENV_KEYS.accessKeyId,
  WAREHOUSE_ENV_KEYS.secretAccessKey,
  WAREHOUSE_ENV_KEYS.readAccessKeyId,
  WAREHOUSE_ENV_KEYS.readSecretAccessKey,
  WAREHOUSE_ENV_KEYS.sourceDsn,
];

/**
 * Every production credential name the repository supports, in one place. Each
 * entry is read somewhere on `main` as a way to reach the production project:
 *
 *   - Supabase API keys: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
 *     (packages/config/src/env.ts), `SUPABASE_ACCESS_TOKEN` (the management
 *     API; .env.example, scripts/disk-growth-alert.ts), and the legacy V1
 *     project's `V1_SUPABASE_SERVICE_ROLE_KEY` (scripts/shadow-*.ts).
 *   - Postgres connection strings: `SUPABASE_DB_URL` and
 *     `SUPABASE_DB_POOLER_URL` (workflow secrets), `DATABASE_URL`,
 *     `SUPABASE_DATABASE_URL` (scripts/db-inspect/lib.ts,
 *     scripts/ops/disk-growth-report.ts), `HETZNER_DATABASE_URL`,
 *     `EXPECTED_DATABASE_URL`, `ACTUAL_DATABASE_URL`, `LIVE_DATABASE_URL`
 *     (scripts/ops/compare-databases.ts), `POSTGRES_URL`
 *     (scripts/ci/schema-roundtrip-hash.ts falls back to it for SUPABASE_DB_URL).
 *   - A connection-string part: `SUPABASE_DB_PASSWORD`, from which
 *     scripts/generate-types.mjs builds a production URL.
 *
 * A new alias is added here, not beside a single check: both the research
 * refusal and the log redactor derive from this list.
 */
export const PRODUCTION_CREDENTIAL_ENV_KEYS: readonly string[] = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'V1_SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SUPABASE_DB_POOLER_URL',
  'SUPABASE_DATABASE_URL',
  'SUPABASE_DB_PASSWORD',
  'DATABASE_URL',
  'POSTGRES_URL',
  'HETZNER_DATABASE_URL',
  'EXPECTED_DATABASE_URL',
  'ACTUAL_DATABASE_URL',
  'LIVE_DATABASE_URL',
];

/**
 * Credentials a research or read command refuses to start alongside: the
 * archive writer, the operational source, and every production credential the
 * rest of the repository uses. A research job run with any of them present can
 * write to the archive or reach production, so it does not run at all --
 * refusing, rather than ignoring, is the control
 * (WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md §3).
 */
export const RESEARCH_FORBIDDEN_ENV_KEYS: readonly string[] = [
  WAREHOUSE_ENV_KEYS.accessKeyId,
  WAREHOUSE_ENV_KEYS.secretAccessKey,
  WAREHOUSE_ENV_KEYS.sourceDsn,
  ...PRODUCTION_CREDENTIAL_ENV_KEYS,
];

/** Everything `redactSecrets` substitutes: the warehouse secrets and the production credentials. */
const REDACTED_ENV_KEYS: readonly string[] = [
  ...new Set([...SECRET_ENV_KEYS, ...RESEARCH_FORBIDDEN_ENV_KEYS]),
];

/**
 * Any other variable whose name says it holds a credential is substituted too.
 * The explicit list above is the contract; this is the margin for a credential
 * the list has not been told about yet.
 */
const CREDENTIAL_NAME_RE = /(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|DSN|DATABASE_URL|DB_URL|POOLER_URL|POSTGRES_URL)(?:_|$)/;

export interface ObjectStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export type PresenceClass = 'present' | 'missing' | 'placeholder';

const PLACEHOLDER_RE =
  /^(?:your[-_]|replace[-_]?me|change[-_]?me|placeholder|example[-_]|todo$|x{3,}$|<[^>]+>$|(?:null|undefined|none)$)/i;

export function classifyPresence(value: string | undefined): PresenceClass {
  if (value === undefined || value.trim().length === 0) {
    return 'missing';
  }
  return PLACEHOLDER_RE.test(value.trim()) ? 'placeholder' : 'present';
}

export type ConfigResolution<T> =
  | { ok: true; config: T }
  | { ok: false; code: 'warehouse_config_incomplete'; missing: string[]; message: string };

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
}

/**
 * Resolve the object-store configuration, or report exactly which keys are
 * unusable. A placeholder counts as missing: `UNIT_TALK_WAREHOUSE_S3_BUCKET=
 * your-bucket` is a configuration error that would otherwise surface as a
 * 404 halfway through a multi-gigabyte export.
 */
export function resolveObjectStoreConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConfigResolution<ObjectStoreConfig> {
  return resolveStoreWith(env, {
    endpoint: WAREHOUSE_ENV_KEYS.endpoint,
    region: WAREHOUSE_ENV_KEYS.region,
    bucket: WAREHOUSE_ENV_KEYS.bucket,
    accessKeyId: WAREHOUSE_ENV_KEYS.accessKeyId,
    secretAccessKey: WAREHOUSE_ENV_KEYS.secretAccessKey,
  });
}

type StoreKeyNames = Record<'endpoint' | 'region' | 'bucket' | 'accessKeyId' | 'secretAccessKey', string>;

function resolveStoreWith(
  env: NodeJS.ProcessEnv,
  names: StoreKeyNames,
): ConfigResolution<ObjectStoreConfig> {
  const required = ['endpoint', 'region', 'bucket', 'accessKeyId', 'secretAccessKey'] as const;
  const missing: string[] = [];
  const values: Partial<Record<(typeof required)[number], string>> = {};

  for (const field of required) {
    const key = names[field];
    const value = readEnv(env, key);
    if (classifyPresence(value) !== 'present') {
      missing.push(key);
    } else {
      values[field] = value;
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      code: 'warehouse_config_incomplete',
      missing,
      message:
        `Object-store configuration is incomplete: ${missing.join(', ')}. ` +
        'See docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md. ' +
        'No export, upload, verification, or prune may proceed without it.',
    };
  }

  return {
    ok: true,
    config: {
      endpoint: values.endpoint!,
      region: values.region!,
      bucket: values.bucket!,
      accessKeyId: values.accessKeyId!,
      secretAccessKey: values.secretAccessKey!,
      // Hetzner Object Storage, MinIO and most non-AWS S3 implementations
      // require path-style addressing; AWS itself tolerates it. Default on.
      forcePathStyle: (readEnv(env, WAREHOUSE_ENV_KEYS.forcePathStyle) ?? 'true') !== 'false',
    },
  };
}

/** The production and writer credential names present in `env`. Names only, never values. */
export function researchForbiddenPresent(env: NodeJS.ProcessEnv = process.env): string[] {
  return RESEARCH_FORBIDDEN_ENV_KEYS.filter((key) => classifyPresence(readEnv(env, key)) !== 'missing');
}

export type ResearchConfigResolution =
  | ConfigResolution<ObjectStoreConfig>
  | {
      ok: false;
      code: 'warehouse_research_credential_forbidden';
      forbidden: string[];
      missing: string[];
      message: string;
    };

/**
 * Refuse to start a research or read command when a writer or production
 * credential is in its environment. The message names each variable and never
 * carries a value.
 */
export function assertResearchEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const forbidden = researchForbiddenPresent(env);
  if (forbidden.length > 0) {
    throw new Error(researchRefusalMessage(forbidden));
  }
}

function researchRefusalMessage(forbidden: string[]): string {
  return (
    `Refusing to start a warehouse research command: ${forbidden.join(', ')} ` +
    `${forbidden.length === 1 ? 'is' : 'are'} set in this environment. Research runs with the reader key ` +
    `only (${WAREHOUSE_ENV_KEYS.readAccessKeyId}, ${WAREHOUSE_ENV_KEYS.readSecretAccessKey}); ` +
    'unset the writer and production credentials and run it again. ' +
    'See docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md §3.'
  );
}

/**
 * The object-store configuration for research and read commands: the reader
 * key under its own `_READ_` names, and the shared endpoint, region and bucket.
 * It never falls back to the writer names, and it refuses outright when the
 * writer or a production credential is present.
 */
export function resolveResearchObjectStoreConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResearchConfigResolution {
  const forbidden = researchForbiddenPresent(env);
  if (forbidden.length > 0) {
    return {
      ok: false,
      code: 'warehouse_research_credential_forbidden',
      forbidden,
      missing: [],
      message: researchRefusalMessage(forbidden),
    };
  }
  return resolveStoreWith(env, {
    endpoint: WAREHOUSE_ENV_KEYS.endpoint,
    region: WAREHOUSE_ENV_KEYS.region,
    bucket: WAREHOUSE_ENV_KEYS.bucket,
    accessKeyId: WAREHOUSE_ENV_KEYS.readAccessKeyId,
    secretAccessKey: WAREHOUSE_ENV_KEYS.readSecretAccessKey,
  });
}

export function resolveSourceDsn(
  env: NodeJS.ProcessEnv = process.env,
): ConfigResolution<{ dsn: string }> {
  const dsn = readEnv(env, WAREHOUSE_ENV_KEYS.sourceDsn);
  if (classifyPresence(dsn) !== 'present') {
    return {
      ok: false,
      code: 'warehouse_config_incomplete',
      missing: [WAREHOUSE_ENV_KEYS.sourceDsn],
      message:
        `${WAREHOUSE_ENV_KEYS.sourceDsn} is required to read from the operational database. ` +
        'It must be a read-only role; see docs/05_operations/POSTGRES_ROLE_MODEL.md.',
    };
  }
  return { ok: true, config: { dsn: dsn! } };
}

/**
 * What a scheduled archive run can do with the configuration it was given.
 *
 *   - `not_provisioned` -- no archive key is set at all. The owner has not yet
 *     provisioned the bucket, keys and source DSN.
 *   - `incomplete` -- something is set but the run still cannot archive: a key
 *     is missing, or holds a placeholder. This is a misconfiguration, not a
 *     pending provisioning step.
 *   - `ready` -- the object store and the read-only source both resolve.
 *
 * Only `ready` may run. The other two differ in what a reader should do next,
 * never in whether anything was archived: in both, nothing was.
 */
export type ArchiveState = 'not_provisioned' | 'incomplete' | 'ready';

const ARCHIVE_RUN_KEYS: readonly string[] = [
  WAREHOUSE_ENV_KEYS.endpoint,
  WAREHOUSE_ENV_KEYS.region,
  WAREHOUSE_ENV_KEYS.bucket,
  WAREHOUSE_ENV_KEYS.accessKeyId,
  WAREHOUSE_ENV_KEYS.secretAccessKey,
  WAREHOUSE_ENV_KEYS.sourceDsn,
];

export function classifyArchiveState(env: NodeJS.ProcessEnv = process.env): ArchiveState {
  if (resolveObjectStoreConfig(env).ok && resolveSourceDsn(env).ok) return 'ready';
  // A placeholder is a value someone set, so it makes the state `incomplete`
  // rather than `not_provisioned` -- and it is never counted as provisioned.
  const anySet = ARCHIVE_RUN_KEYS.some((key) => classifyPresence(readEnv(env, key)) !== 'missing');
  return anySet ? 'incomplete' : 'not_provisioned';
}

export interface ConfigDescription {
  layout_version: number;
  keys: Array<{ key: string; secret: boolean; presence: PresenceClass }>;
  object_store_ready: boolean;
  source_ready: boolean;
  archive_state: ArchiveState;
  /** The reader key resolves and no writer or production credential is present. */
  research_ready: boolean;
  /** Names of the credentials that make a research command refuse. Never values. */
  research_forbidden_present: string[];
}

/**
 * The only configuration report any command may emit. It carries presence, not
 * values -- including for the non-secret keys, so that no future edit can widen
 * this into "just print the endpoint" and then "just print the DSN".
 */
export function describeConfig(env: NodeJS.ProcessEnv = process.env): ConfigDescription {
  const keys = Object.values(WAREHOUSE_ENV_KEYS).map((key) => ({
    key,
    secret: SECRET_ENV_KEYS.includes(key),
    presence: classifyPresence(readEnv(env, key)),
  }));
  return {
    layout_version: 1,
    keys,
    object_store_ready: resolveObjectStoreConfig(env).ok,
    source_ready: resolveSourceDsn(env).ok,
    archive_state: classifyArchiveState(env),
    research_ready: resolveResearchObjectStoreConfig(env).ok,
    research_forbidden_present: researchForbiddenPresent(env),
  };
}

/**
 * The Markdown job summary `warehouse doctor` writes for a scheduled run. It is
 * built from a `ConfigDescription`, which carries presence classes and never a
 * value, so it cannot leak one. Every non-`ready` state says, in words, that no
 * archive happened: a red run must not be readable as "archived, with warnings".
 */
export function renderDoctorSummary(description: ConfigDescription): string {
  const unusable = description.keys
    .filter((entry) => entry.presence !== 'present' && ARCHIVE_RUN_KEYS.includes(entry.key))
    .map((entry) => `- \`${entry.key}\`: ${entry.presence}`);
  const nothingArchived =
    'No window was exported, uploaded, verified or manifested, and nothing became prune-eligible.';

  switch (description.archive_state) {
    case 'ready':
      return '### Warehouse archive: configuration ready\n\nThe object store and the read-only source both resolve. Whether a window was archived is reported by the conveyor step, not by this check.\n';
    case 'not_provisioned':
      return [
        '### Warehouse archive: NOT PROVISIONED',
        '',
        'No archive key is set. The bucket, keys and source DSN are owner actions in `docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`.',
        '',
        nothingArchived,
        '',
        'This run fails on purpose: an archive that is not running is stale, never unknown.',
        '',
      ].join('\n');
    case 'incomplete':
      return [
        '### Warehouse archive: CONFIGURATION INCOMPLETE',
        '',
        'Some archive keys are set, but the run cannot archive with them:',
        '',
        ...unusable,
        '',
        nothingArchived,
        '',
      ].join('\n');
  }
}

/**
 * Redact anything that looks like a credential before it reaches a log line.
 * Applied to every error message the CLI prints, because the AWS SDK and the
 * Postgres driver both put connection strings into their own error text.
 *
 * Two passes. The first substitutes the value of every credential variable
 * present in `env`. The second removes credential *shapes*, which catches a
 * secret that was assembled, re-encoded or never in this environment at all.
 */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  const names = new Set<string>(REDACTED_ENV_KEYS);
  for (const key of Object.keys(env)) {
    if (CREDENTIAL_NAME_RE.test(key)) names.add(key);
  }
  // Longest first, so a value that contains another is replaced whole.
  const values = [...names]
    .map((key) => ({ key, value: typeof env[key] === 'string' ? env[key]!.trim() : '' }))
    .filter((entry) => entry.value.length >= 8)
    .sort((a, b) => b.value.length - a.value.length);
  for (const { key, value } of values) {
    out = out.split(value).join(`[redacted:${key}]`);
  }
  // Credentials embedded in a URI (postgres://user:pass@host, https://token@host):
  // the whole userinfo goes, since a token-only URI has no colon to split on.
  out = out.replace(/\/\/[^\s/@]+@/g, '//[redacted]@');
  // libpq / DSN / query-string pairs: password=..., sslpassword=..., key=..., token: ...
  out = out.replace(
    /\b((?:ssl)?password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|api[_-]?key|apikey|key|access[_-]?key(?:[_-]?id)?|secret[_-]?access[_-]?key|x-amz-security-token|x-amz-signature|x-amz-credential|signature)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&;,'"]+)/gi,
    '$1$2[redacted]',
  );
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]');
  // JWTs: Supabase anon and service-role keys are JWTs.
  out = out.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[redacted:jwt]');
  // AWS-style access key ids, which S3-compatible stores (Hetzner, R2, MinIO) reuse.
  out = out.replace(/\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b/g, '[redacted:access-key-id]');
  // Supabase personal access and secret API keys.
  out = out.replace(/\bsb(?:p|_secret|_publishable)_[A-Za-z0-9_-]{10,}/g, '[redacted:supabase-key]');
  return out;
}

/**
 * What a log line becomes when redaction itself fails. Fixed text, so a failure
 * of the redactor can never be the path by which raw text escapes.
 */
export const REDACTION_FAILED_EVENT: Readonly<Record<string, unknown>> = Object.freeze({
  event: 'warehouse.log',
  redaction: 'failed',
  note: 'a log event could not be redacted, so it was withheld',
});

const MAX_REDACTION_DEPTH = 32;

function redactValue(
  value: unknown,
  env: NodeJS.ProcessEnv,
  depth: number,
  seen: Set<object>,
): unknown {
  if (typeof value === 'string') return redactSecrets(value, env);
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactSecrets(value.message, env);
  if (Buffer.isBuffer(value)) return `[buffer:${value.length} bytes]`;
  if (depth > MAX_REDACTION_DEPTH) throw new Error('log event nests too deeply to redact');
  if (seen.has(value as object)) throw new Error('log event is circular');
  seen.add(value as object);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => redactValue(entry, env, depth + 1, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[redactSecrets(key, env)] = redactValue(entry, env, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value as object);
  }
}

/**
 * The single redaction boundary for anything the warehouse writes to a log or
 * to stdout. Every string, at any depth, goes through `redactSecrets`. It fails
 * closed: if redaction throws for any reason, the caller receives
 * {@link REDACTION_FAILED_EVENT} and the original event is dropped, never
 * emitted raw.
 */
export function redactLogEvent(event: unknown, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  try {
    const redacted = redactValue(event, env, 0, new Set());
    if (redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)) {
      return redacted as Record<string, unknown>;
    }
    return { value: redacted };
  } catch {
    return { ...REDACTION_FAILED_EVENT };
  }
}

/** `redactLogEvent`, serialized. The one function the CLI writes JSON through. */
export function formatRedactedJson(event: unknown, indent?: number, env: NodeJS.ProcessEnv = process.env): string {
  try {
    return JSON.stringify(redactLogEvent(event, env), null, indent);
  } catch {
    return JSON.stringify(REDACTION_FAILED_EVENT, null, indent);
  }
}

/** `redactSecrets` for free text, failing closed to fixed text. */
export function redactMessage(text: string, env: NodeJS.ProcessEnv = process.env): string {
  try {
    return redactSecrets(text, env);
  } catch {
    return 'warehouse: an error occurred, and its message was withheld because it could not be redacted';
  }
}
