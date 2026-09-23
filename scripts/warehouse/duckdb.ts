/**
 * DuckDB access for the warehouse.
 *
 * DuckDB is the single engine for this lane: it reads bounded windows out of
 * Postgres, writes Parquet with zstd, reads Parquet back over an S3-compatible
 * endpoint, and answers analytics queries. One engine means one set of type
 * semantics between export and read-back, which is what makes a sample
 * comparison meaningful rather than a fight with two drivers' date handling.
 *
 * The module is imported lazily throughout so that pure tests never pay for the
 * native binding and a checkout without it can still run the rest of the suite.
 */

export interface DuckConnection {
  run(sql: string): Promise<void>;
  all(sql: string): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
}

interface DuckDbApi {
  DuckDBInstance: {
    create(path: string): Promise<{ connect(): Promise<RawConnection> }>;
  };
}

interface RawConnection {
  run(sql: string): Promise<unknown>;
  runAndReadAll(sql: string): Promise<{ getRowObjects(): Array<Record<string, unknown>> }>;
  closeSync?(): void;
}

let cachedApi: DuckDbApi | null = null;

async function loadDuckDb(): Promise<DuckDbApi> {
  if (cachedApi) return cachedApi;
  try {
    cachedApi = (await import('@duckdb/node-api')) as unknown as DuckDbApi;
    return cachedApi;
  } catch (error) {
    throw new Error(
      '@duckdb/node-api is not installed. The warehouse exporter, verifier and read path all ' +
        'require it. Run `pnpm install` at the repository root. ' +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const MICROS_PER_MS = 1000n;
const MS_PER_DAY = 86_400_000;

/**
 * Convert DuckDB's temporal value objects to deterministic UTC ISO strings.
 *
 * Two traps here, and both are silent:
 *
 * `DuckDBDateValue` and `DuckDBTimestampValue` are plain objects carrying a
 * single numeric field (`days`, `micros`). Passed through a generic
 * JSON round-trip they survive as `{"days":20710}` -- valid JSON, and useless
 * to every consumer: an operator reading CLI output, a sample comparison, and
 * any string assertion about a date, which then compares `"[object Object]"`
 * and passes against anything.
 *
 * Their own `toString()` is not the answer either. `DuckDBTimestampTZValue`
 * renders in the *reader's local zone* -- the same archived row prints
 * `2026-09-14 01:00:00-04` on one machine and `2026-09-14 05:00:00+00` on
 * another. So the instant is reconstructed from the numeric field and rendered
 * in UTC, which is the zone the archive is partitioned by.
 */
function normalizeTemporal(value: object): string | null {
  const name = value.constructor?.name ?? '';
  if (name === 'DuckDBDateValue' && 'days' in value) {
    const days = Number((value as { days: number | bigint }).days);
    if (!Number.isFinite(days)) return null;
    return new Date(days * MS_PER_DAY).toISOString().slice(0, 10);
  }
  if (
    (name === 'DuckDBTimestampValue' ||
      name === 'DuckDBTimestampTZValue' ||
      name === 'DuckDBTimestampMillisecondsValue') &&
    'micros' in value
  ) {
    const micros = BigInt((value as { micros: bigint | number }).micros);
    return new Date(Number(micros / MICROS_PER_MS)).toISOString();
  }
  return null;
}

/**
 * Normalize DuckDB's row objects into JSON-safe values. BIGINT arrives as a
 * JS BigInt, which `JSON.stringify` throws on -- a detail that would otherwise
 * surface only once a real partition (with real row counts) was exported.
 */
export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') {
      out[key] = Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (value !== null && typeof value === 'object') {
      const temporal = normalizeTemporal(value);
      out[key] =
        temporal ??
        (JSON.parse(
          JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
        ) as unknown);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function openDuckDb(databasePath = ':memory:'): Promise<DuckConnection> {
  const api = await loadDuckDb();
  const instance = await api.DuckDBInstance.create(databasePath);
  const raw = await instance.connect();

  return {
    async run(sql: string): Promise<void> {
      await raw.run(sql);
    },
    async all(sql: string): Promise<Array<Record<string, unknown>>> {
      const reader = await raw.runAndReadAll(sql);
      return reader.getRowObjects().map(normalizeRow);
    },
    async close(): Promise<void> {
      raw.closeSync?.();
    },
  };
}

export interface ExtensionLoadResult {
  extension: string;
  loaded: boolean;
  error: string | null;
}

/**
 * Install and load an extension, reporting failure rather than throwing.
 *
 * Extension installation reaches the network on first use. A conveyor run in a
 * sandbox with no egress must fail with "httpfs unavailable" at the point of
 * use, not crash during setup -- and a pure local export must not need it at
 * all.
 */
export async function loadExtension(
  connection: DuckConnection,
  extension: string,
): Promise<ExtensionLoadResult> {
  try {
    await connection.run(`INSTALL ${extension}`);
    await connection.run(`LOAD ${extension}`);
    return { extension, loaded: true, error: null };
  } catch (error) {
    return {
      extension,
      loaded: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface S3Credentials {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/**
 * Configure DuckDB's httpfs S3 access via a secret, not via SET statements.
 * DuckDB's `CREATE SECRET` keeps the value out of `duckdb_settings()` and out of
 * any query plan a later diagnostic might print.
 */
export async function configureS3(
  connection: DuckConnection,
  credentials: S3Credentials,
): Promise<ExtensionLoadResult> {
  const result = await loadExtension(connection, 'httpfs');
  if (!result.loaded) {
    return result;
  }
  const host = credentials.endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const useSsl = !credentials.endpoint.startsWith('http://');
  await connection.run(`
    CREATE OR REPLACE SECRET unit_talk_warehouse (
      TYPE s3,
      KEY_ID ${quote(credentials.accessKeyId)},
      SECRET ${quote(credentials.secretAccessKey)},
      REGION ${quote(credentials.region)},
      ENDPOINT ${quote(host)},
      URL_STYLE ${quote(credentials.forcePathStyle ? 'path' : 'vhost')},
      USE_SSL ${useSsl ? 'true' : 'false'}
    )
  `);
  return result;
}

/** Single-quote a SQL string literal. The only quoting path in this module. */
export function quote(value: string): string {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Quote a SQL identifier. */
export function quoteIdent(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) {
    throw new Error(`unsafe SQL identifier: ${JSON.stringify(value)}`);
  }
  return `"${value}"`;
}
