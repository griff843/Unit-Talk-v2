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
  forcePathStyle: 'UNIT_TALK_WAREHOUSE_S3_FORCE_PATH_STYLE',
  sourceDsn: 'UNIT_TALK_WAREHOUSE_SOURCE_DSN',
  localRoot: 'UNIT_TALK_WAREHOUSE_LOCAL_ROOT',
} as const;

/** Keys whose values must never be printed, echoed, or written to an artifact. */
export const SECRET_ENV_KEYS: readonly string[] = [
  WAREHOUSE_ENV_KEYS.accessKeyId,
  WAREHOUSE_ENV_KEYS.secretAccessKey,
  WAREHOUSE_ENV_KEYS.sourceDsn,
];

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
  const required = ['endpoint', 'region', 'bucket', 'accessKeyId', 'secretAccessKey'] as const;
  const missing: string[] = [];
  const values: Partial<Record<(typeof required)[number], string>> = {};

  for (const field of required) {
    const key = WAREHOUSE_ENV_KEYS[field];
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

export interface ConfigDescription {
  layout_version: number;
  keys: Array<{ key: string; secret: boolean; presence: PresenceClass }>;
  object_store_ready: boolean;
  source_ready: boolean;
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
  };
}

/**
 * Redact anything that looks like a credential before it reaches a log line.
 * Applied to every error message the CLI prints, because the AWS SDK and the
 * Postgres driver both put connection strings into their own error text.
 */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  for (const key of SECRET_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim().length >= 8) {
      out = out.split(value.trim()).join(`[redacted:${key}]`);
    }
  }
  // Credentials embedded in a URI (postgres://user:pass@host) survive the
  // value-substitution pass above whenever the DSN was assembled rather than
  // passed through verbatim.
  out = out.replace(/\/\/([^\s/:@]+):([^\s/@]+)@/g, '//$1:[redacted]@');
  return out;
}
