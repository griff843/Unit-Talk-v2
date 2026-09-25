import { configureS3, type DuckConnection, openDuckDb, quote } from './duckdb.js';
import { assertResearchEnvironment, resolveResearchObjectStoreConfig } from './config.js';
import { readGlob } from './object-layout.js';
import type { ObjectStore } from './object-store.js';

/**
 * The warehouse read path.
 *
 * The point of this module is a negative claim, and the claim is the deliverable:
 * **a research or model-training workload can answer a real question over the
 * archive without a production database credential.** Nothing here imports the
 * Supabase client, and nothing here can: the only inputs are an object-store
 * URI and Parquet.
 *
 * DuckDB reads the Parquet directly over the S3-compatible API. There is no
 * standing query service, no cluster, and nothing to keep running between
 * queries -- which is the whole reason this was preferred over a warehouse
 * engine.
 */

export interface WarehouseQueryOptions {
  /** Object store to read through. */
  store: ObjectStore;
  /** Prefix under the bucket, e.g. `canonical/markets/nfl/2026`. */
  prefix: string;
  /** SQL with `{{source}}` standing in for the read_parquet expression. */
  sql: string;
  /** Existing connection to reuse; one is opened and closed otherwise. */
  connection?: DuckConnection;
  env?: NodeJS.ProcessEnv;
}

export interface WarehouseQueryResult {
  source_expression: string;
  row_count: number;
  rows: Array<Record<string, unknown>>;
  used_production_database: false;
}

export const SOURCE_PLACEHOLDER = '{{source}}';

/**
 * Representative analytics query. It is deliberately a *market* question --
 * per-day, per-sport line volume and book coverage -- rather than a `count(*)`,
 * because the claim being proven is that the archive is analytically useful,
 * not merely that it parses.
 *
 * It makes no CLV, ROI, or edge claim, per the guardrail in
 * docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md §11.
 *
 * The day is taken `AT TIME ZONE 'UTC'` deliberately. `CAST(ts AS DATE)` resolves
 * in the *reader's* local zone, so the same archive would group into different
 * days for two analysts -- and into more days than were archived, since a UTC
 * partition straddles two local ones. The archive is partitioned by UTC day, so
 * the query that reads it must be too.
 */
export const REPRESENTATIVE_QUERY = `
  SELECT
    CAST(snapshot_at AT TIME ZONE 'UTC' AS DATE) AS snapshot_date,
    sport_key,
    count(*)                                 AS offer_rows,
    count(DISTINCT provider_event_id)        AS events,
    count(DISTINCT provider_market_key)      AS markets,
    count(DISTINCT bookmaker_key)            AS books
  FROM ${SOURCE_PLACEHOLDER}
  GROUP BY 1, 2
  ORDER BY 1, 2
`;

export function buildSourceExpression(baseUri: string, prefix: string): string {
  return `read_parquet(${quote(readGlob(baseUri, prefix))}, union_by_name = true)`;
}

/**
 * Run a query over the archive. The SQL template must reference
 * `{{source}}`; a query that does not is refused rather than silently run
 * against whatever else the connection can see.
 */
export async function runWarehouseQuery(
  options: WarehouseQueryOptions,
): Promise<WarehouseQueryResult> {
  if (!options.sql.includes(SOURCE_PLACEHOLDER)) {
    throw new Error(
      `warehouse query must reference ${SOURCE_PLACEHOLDER}; refusing to run a query with no archive source`,
    );
  }

  const env = options.env ?? process.env;
  // Before anything opens: a read path that starts with the writer or a
  // production credential in reach is a read path that can write.
  assertResearchEnvironment(env);
  const ownsConnection = options.connection === undefined;
  const connection = options.connection ?? (await openDuckDb());

  try {
    const description = options.store.describe();
    if (description.kind === 's3') {
      const resolved = resolveResearchObjectStoreConfig(env);
      if (!resolved.ok) {
        throw new Error(resolved.message);
      }
      const configured = await configureS3(connection, {
        endpoint: resolved.config.endpoint,
        region: resolved.config.region,
        accessKeyId: resolved.config.accessKeyId,
        secretAccessKey: resolved.config.secretAccessKey,
        forcePathStyle: resolved.config.forcePathStyle,
      });
      if (!configured.loaded) {
        throw new Error(
          `DuckDB httpfs is unavailable, so the archive cannot be read over S3: ${configured.error ?? 'unknown error'}`,
        );
      }
    }

    const sourceExpression = buildSourceExpression(options.store.baseUri(), options.prefix);
    const rows = await connection.all(options.sql.split(SOURCE_PLACEHOLDER).join(sourceExpression));

    return {
      source_expression: sourceExpression,
      row_count: rows.length,
      rows,
      used_production_database: false,
    };
  } finally {
    if (ownsConnection) {
      await connection.close();
    }
  }
}
