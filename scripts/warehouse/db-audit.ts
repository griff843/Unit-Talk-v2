/**
 * Read-only sizing and retention audit of an operational Postgres database.
 *
 * Every statement in this module is a constant `SELECT` defined here. Nothing
 * is assembled from caller input, the session is pinned read-only before the
 * first query, and there is no code path that writes. That is deliberate: this
 * audit is meant to be run against *production* while production is the thing
 * being recovered, and an audit that could mutate is an audit nobody is allowed
 * to run when they most need it.
 *
 * The queries are catalog reads (`pg_class`, `pg_stat_all_tables`,
 * `pg_stat_user_tables`) plus, where a time column is known, a bounded
 * `min()/max()` over it. They take no locks that block writers.
 */

export interface SqlRunner {
  (sql: string): Promise<Array<Record<string, unknown>>>;
}

export const READ_ONLY_PREAMBLE = 'SET default_transaction_read_only = on';

export const DATABASE_SIZE_SQL = `
  SELECT
    current_database()                        AS database,
    pg_database_size(current_database())      AS total_bytes,
    pg_size_pretty(pg_database_size(current_database())) AS total_pretty
`;

export const RELATION_SIZES_SQL = `
  SELECT
    n.nspname                                        AS schema,
    c.relname                                        AS relation,
    c.relkind                                        AS relkind,
    pg_total_relation_size(c.oid)                    AS total_bytes,
    pg_relation_size(c.oid)                          AS heap_bytes,
    pg_indexes_size(c.oid)                           AS index_bytes,
    COALESCE(pg_total_relation_size(c.reltoastrelid), 0) AS toast_bytes,
    c.reltuples::bigint                              AS estimated_rows,
    s.n_live_tup                                     AS live_tuples,
    s.n_dead_tup                                     AS dead_tuples,
    s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND c.relkind IN ('r', 'p', 'm')
  ORDER BY pg_total_relation_size(c.oid) DESC
`;

export const PARTITION_SIZES_SQL = `
  SELECT
    parent_ns.nspname   AS parent_schema,
    parent.relname      AS parent_relation,
    child.relname       AS partition,
    pg_total_relation_size(child.oid) AS total_bytes,
    child.reltuples::bigint           AS estimated_rows
  FROM pg_inherits i
  JOIN pg_class parent     ON parent.oid = i.inhparent
  JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
  JOIN pg_class child      ON child.oid = i.inhrelid
  ORDER BY pg_total_relation_size(child.oid) DESC
`;

export const AUTOVACUUM_STATE_SQL = `
  SELECT
    schemaname AS schema,
    relname    AS relation,
    n_live_tup AS live_tuples,
    n_dead_tup AS dead_tuples,
    CASE WHEN n_live_tup > 0
         THEN round((n_dead_tup::numeric / NULLIF(n_live_tup, 0)) * 100, 2)
         ELSE NULL END AS dead_tuple_pct,
    last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
    vacuum_count, autovacuum_count
  FROM pg_stat_user_tables
  ORDER BY n_dead_tup DESC
`;

export const FOREIGN_KEYS_REFERENCING_SQL = `
  SELECT
    con.conname            AS constraint_name,
    src_ns.nspname         AS referencing_schema,
    src.relname            AS referencing_relation,
    tgt_ns.nspname         AS referenced_schema,
    tgt.relname            AS referenced_relation
  FROM pg_constraint con
  JOIN pg_class src        ON src.oid = con.conrelid
  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
  JOIN pg_class tgt        ON tgt.oid = con.confrelid
  JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
  WHERE con.contype = 'f'
  ORDER BY 4, 5, 1
`;

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * The only query in this module that is not a constant. It is parameterised by
 * two identifiers, both of which must match a strict lowercase-identifier
 * pattern; anything else is refused rather than escaped.
 */
export function timeWindowSql(schema: string, relation: string, column: string): string {
  for (const [label, value] of [
    ['schema', schema],
    ['relation', relation],
    ['column', column],
  ] as const) {
    if (!IDENT_RE.test(value)) {
      throw new Error(`db-audit: unsafe ${label} identifier ${JSON.stringify(value)}`);
    }
  }
  return `SELECT min("${column}") AS oldest, max("${column}") AS newest, count(*) AS exact_rows
          FROM "${schema}"."${relation}"`;
}

export interface HotRetentionRule {
  schema: string;
  relation: string;
  timeColumn: string;
  /** Days of history the hot database is supposed to keep. */
  hotRetentionDays: number;
}

export interface RetentionViolation {
  relation: string;
  hot_retention_days: number;
  oldest: string | null;
  newest: string | null;
  exact_rows: number | null;
  age_days: number | null;
  violates: boolean;
  note: string;
}

export interface DbAuditReport {
  generated_at: string;
  read_only: true;
  mutated: false;
  database: Record<string, unknown> | null;
  relations: Array<Record<string, unknown>>;
  partitions: Array<Record<string, unknown>>;
  autovacuum: Array<Record<string, unknown>>;
  foreign_keys: Array<Record<string, unknown>>;
  retention: RetentionViolation[];
  notes: string[];
}

/**
 * Run the audit. `rules` is optional; when empty the report still carries sizes,
 * partitions and vacuum state, and simply makes no retention claim -- which is
 * the honest output when nobody has declared what the hot window should be.
 */
export async function runDbAudit(input: {
  query: SqlRunner;
  rules?: HotRetentionRule[];
  now?: () => Date;
  /** Cap on relations reported, so a catalog with thousands stays readable. */
  topRelations?: number;
}): Promise<DbAuditReport> {
  const now = input.now ?? (() => new Date());
  const notes: string[] = [];

  await input.query(READ_ONLY_PREAMBLE);

  const database = (await input.query(DATABASE_SIZE_SQL))[0] ?? null;
  const allRelations = await input.query(RELATION_SIZES_SQL);
  const topN = input.topRelations ?? 40;
  const relations = allRelations.slice(0, topN);
  if (allRelations.length > topN) {
    notes.push(
      `${allRelations.length} relations exist; the ${topN} largest are reported. Total size is measured over all of them.`,
    );
  }

  const partitions = await input.query(PARTITION_SIZES_SQL);
  const autovacuum = await input.query(AUTOVACUUM_STATE_SQL);
  const foreignKeys = await input.query(FOREIGN_KEYS_REFERENCING_SQL);

  if (
    autovacuum.length > 0 &&
    autovacuum.every((row) => Number(row.live_tuples ?? 0) === 0 && Number(row.dead_tuples ?? 0) === 0)
  ) {
    notes.push(
      'pg_stat_user_tables reports zero live and dead tuples for every relation. ' +
        'Statistics were reset (a restore or a stats reset does this), so bloat and vacuum ' +
        'urgency cannot be read from this run. reltuples estimates are reported instead, and ' +
        'they are also stale until ANALYZE runs.',
    );
  }

  const retention: RetentionViolation[] = [];
  for (const rule of input.rules ?? []) {
    try {
      const rows = await input.query(timeWindowSql(rule.schema, rule.relation, rule.timeColumn));
      const row = rows[0] ?? {};
      const oldest = row.oldest === null || row.oldest === undefined ? null : String(row.oldest);
      const newest = row.newest === null || row.newest === undefined ? null : String(row.newest);
      const exactRows = row.exact_rows === undefined ? null : Number(row.exact_rows);
      const ageDays =
        oldest === null ? null : (now().getTime() - Date.parse(oldest)) / 86_400_000;
      retention.push({
        relation: `${rule.schema}.${rule.relation}`,
        hot_retention_days: rule.hotRetentionDays,
        oldest,
        newest,
        exact_rows: exactRows,
        age_days: ageDays === null ? null : Number(ageDays.toFixed(1)),
        violates: ageDays !== null && ageDays > rule.hotRetentionDays,
        note:
          ageDays === null
            ? 'relation is empty or has no readable time column'
            : ageDays > rule.hotRetentionDays
              ? `oldest row is ${ageDays.toFixed(1)}d old, beyond the ${rule.hotRetentionDays}d hot window`
              : `within the ${rule.hotRetentionDays}d hot window`,
      });
    } catch (error) {
      retention.push({
        relation: `${rule.schema}.${rule.relation}`,
        hot_retention_days: rule.hotRetentionDays,
        oldest: null,
        newest: null,
        exact_rows: null,
        age_days: null,
        violates: false,
        note: `could not be measured: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return {
    generated_at: now().toISOString(),
    read_only: true,
    mutated: false,
    database,
    relations,
    partitions,
    autovacuum,
    foreign_keys: foreignKeys,
    retention,
    notes,
  };
}

/**
 * Assessment of a single relation as an archive-and-prune candidate. Nothing
 * here executes a prune; it produces the facts a PM decision needs, and it
 * refuses to call a relation safe on the strength of a historical measurement.
 */
export interface CandidateAssessment {
  relation: string;
  exists: boolean;
  total_bytes: number | null;
  estimated_rows: number | null;
  inbound_foreign_keys: string[];
  oldest: string | null;
  newest: string | null;
  blocking_unknowns: string[];
  /**
   * There is deliberately no `candidate` verdict. Catalog state can establish
   * that a relation is large, unreferenced and old; it cannot establish that no
   * runtime reader, job, script or replay path touches it. Promoting a relation
   * to a prune candidate is a human step taken with those answers in hand --
   * this function's job is to say what is known and what is still unknown.
   */
  recommendation: 'not_assessable' | 'assess_further';
}

export async function assessArchiveCandidate(input: {
  query: SqlRunner;
  schema: string;
  relation: string;
  timeColumn?: string;
}): Promise<CandidateAssessment> {
  await input.query(READ_ONLY_PREAMBLE);
  const qualified = `${input.schema}.${input.relation}`;
  const blocking: string[] = [];

  const sizes = await input.query(RELATION_SIZES_SQL);
  const match = sizes.find(
    (row) => row.schema === input.schema && row.relation === input.relation,
  );
  if (!match) {
    return {
      relation: qualified,
      exists: false,
      total_bytes: null,
      estimated_rows: null,
      inbound_foreign_keys: [],
      oldest: null,
      newest: null,
      blocking_unknowns: [`relation ${qualified} does not exist in this database`],
      recommendation: 'not_assessable',
    };
  }

  const fks = await input.query(FOREIGN_KEYS_REFERENCING_SQL);
  const inbound = fks
    .filter(
      (row) => row.referenced_schema === input.schema && row.referenced_relation === input.relation,
    )
    .map((row) => `${String(row.referencing_schema)}.${String(row.referencing_relation)} (${String(row.constraint_name)})`);
  if (inbound.length > 0) {
    blocking.push(`${inbound.length} inbound foreign key(s) reference this relation`);
  }

  let oldest: string | null = null;
  let newest: string | null = null;
  if (input.timeColumn) {
    try {
      const rows = await input.query(
        timeWindowSql(input.schema, input.relation, input.timeColumn),
      );
      oldest = rows[0]?.oldest === undefined || rows[0]?.oldest === null ? null : String(rows[0].oldest);
      newest = rows[0]?.newest === undefined || rows[0]?.newest === null ? null : String(rows[0].newest);
    } catch (error) {
      blocking.push(
        `time window could not be measured: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    blocking.push('no time column supplied, so the data window is unknown');
  }

  // Deliberately not inferable from SQL. Naming them as unknowns is the point:
  // a candidate packet that omits them would be recommending a prune on
  // incomplete evidence.
  blocking.push('runtime readers must be confirmed by code/runtime inspection, not by catalog state');
  blocking.push('proof and replay paths that read this relation must be confirmed');

  return {
    relation: qualified,
    exists: true,
    total_bytes: Number(match.total_bytes ?? 0),
    estimated_rows: Number(match.estimated_rows ?? 0),
    inbound_foreign_keys: inbound,
    oldest,
    newest,
    blocking_unknowns: blocking,
    recommendation: 'assess_further',
  };
}
