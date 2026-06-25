#!/usr/bin/env tsx
/**
 * DB health tripwire monitor — read-only checks on hot tables.
 * UTV2-1300 / §5 of DB_MAINTENANCE_RETENTION_SPEC.md
 *
 * Checks:
 *   1. Autovacuum staleness (pg_stat_user_tables)
 *   2. Table size growth (pg_total_relation_size)
 *   3. Statement timeout error rate (Supabase logs)
 *   4. TOAST bloat estimate (pg_relation_size vs pg_total_relation_size)
 *
 * No writes, no DDL, no mutations. Fail-open.
 */

import postgres from 'postgres';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const LINEAR_ISSUE_ID = 'UTV2-1300';

const SYSTEM_RUNS_THRESHOLD_MB = parseInt(
  process.env.SYSTEM_RUNS_SIZE_THRESHOLD_MB ?? '500',
  10,
);
const RAW_PAYLOADS_THRESHOLD_MB = parseInt(
  process.env.RAW_PAYLOADS_SIZE_THRESHOLD_MB ?? '300',
  10,
);
const ODDS_SNAPSHOTS_THRESHOLD_MB = parseInt(
  process.env.ODDS_SNAPSHOTS_SIZE_THRESHOLD_MB ?? '300',
  10,
);
const PROVIDER_OFFER_HISTORY_THRESHOLD_MB = parseInt(
  process.env.PROVIDER_OFFER_HISTORY_SIZE_THRESHOLD_MB ?? '300',
  10,
);
const GAME_RESULTS_THRESHOLD_MB = parseInt(
  process.env.GAME_RESULTS_SIZE_THRESHOLD_MB ?? '300',
  10,
);
const AUTOVACUUM_STALENESS_HOURS = parseInt(
  process.env.AUTOVACUUM_STALENESS_HOURS ?? '24',
  10,
);
const STATEMENT_TIMEOUT_RATE_THRESHOLD = parseInt(
  process.env.STATEMENT_TIMEOUT_RATE_THRESHOLD ?? '3',
  10,
);
const TOAST_BLOAT_RATIO_THRESHOLD = parseFloat(
  process.env.TOAST_BLOAT_RATIO_THRESHOLD ?? '0.8',
);

const HOT_TABLES = [
  'system_runs',
  'raw_payloads',
  'odds_snapshots',
  'provider_offer_history',
  'game_results',
] as const;
const TOAST_BLOAT_TABLES = ['raw_payloads', 'odds_snapshots'] as const;

type TableName = (typeof HOT_TABLES)[number];
type ToastBloatTableName = (typeof TOAST_BLOAT_TABLES)[number];

interface VacuumRow {
  relname: string;
  last_vacuum: Date | null;
  last_autovacuum: Date | null;
  last_analyze: Date | null;
  last_autoanalyze: Date | null;
  n_dead_tup: string;
  n_live_tup: string;
  dead_tup_pct: string | null;
}

interface SizeRow {
  relname: string;
  table_size: string;
  total_size: string;
  total_bytes: string;
}

interface ToastBloatRow {
  relname: string;
  heap_size: string;
  toast_plus_index_size: string;
  total_size: string;
  toast_pct: string | null;
}

interface Alert {
  check: string;
  table?: string;
  detail: string;
  severity: 'warn' | 'critical';
}

function maxEventsInOneHour(timestamps: Date[]): number {
  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
  let max = 0;
  let start = 0;

  for (let end = 0; end < sorted.length; end += 1) {
    while (sorted[end].getTime() - sorted[start].getTime() > 60 * 60 * 1000) {
      start += 1;
    }

    max = Math.max(max, end - start + 1);
  }

  return max;
}

async function checkAutovacuumStaleness(sql: postgres.Sql): Promise<Alert[]> {
  const rows = await sql<VacuumRow[]>`
    SELECT
      relname,
      last_vacuum,
      last_autovacuum,
      last_analyze,
      last_autoanalyze,
      n_dead_tup::text,
      n_live_tup::text,
      ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2)::text AS dead_tup_pct
    FROM pg_stat_user_tables
    WHERE relname = ANY(${sql.array(HOT_TABLES as unknown as string[])})
    ORDER BY n_dead_tup DESC
  `;

  const alerts: Alert[] = [];
  const cutoff = new Date(
    Date.now() - AUTOVACUUM_STALENESS_HOURS * 60 * 60 * 1000,
  );

  for (const row of rows) {
    const staleAnalyze = row.last_analyze === null || row.last_analyze < cutoff;
    const missingVacuum = row.last_vacuum === null;
    const missingAutovacuum = row.last_autovacuum === null;
    const deadTuplePct =
      row.dead_tup_pct === null ? 0 : parseFloat(row.dead_tup_pct);

    if (
      staleAnalyze ||
      missingVacuum ||
      missingAutovacuum ||
      deadTuplePct > 20
    ) {
      const lastAnalyze = row.last_analyze
        ? row.last_analyze.toISOString()
        : 'never run';
      const lastVacuum = row.last_vacuum
        ? row.last_vacuum.toISOString()
        : 'never run';
      const lastAutovacuum = row.last_autovacuum
        ? row.last_autovacuum.toISOString()
        : 'never run';
      const reasons = [
        staleAnalyze ? `last_analyze=${lastAnalyze}` : null,
        missingVacuum ? 'last_vacuum=never run' : null,
        missingAutovacuum ? 'last_autovacuum=never run' : null,
        deadTuplePct > 20 ? `dead_tup_pct=${deadTuplePct.toFixed(2)}%` : null,
      ].filter((reason): reason is string => reason !== null);

      alerts.push({
        check: 'autovacuum_staleness',
        table: row.relname,
        detail:
          `vacuum/analyze signal on ${row.relname}: ${reasons.join(', ')}; ` +
          `last_vacuum=${lastVacuum}, last_autovacuum=${lastAutovacuum}, ` +
          `dead_tup=${row.n_dead_tup}, live_tup=${row.n_live_tup}`,
        severity:
          missingVacuum ||
          deadTuplePct > 20 ||
          parseInt(row.n_dead_tup, 10) > 100_000
            ? 'critical'
            : 'warn',
      });
    }
  }

  return alerts;
}

async function checkTableSize(sql: postgres.Sql): Promise<Alert[]> {
  const rows = await sql<SizeRow[]>`
    SELECT
      relname,
      pg_size_pretty(pg_relation_size(relid)) AS table_size,
      pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
      pg_total_relation_size(relid)::text AS total_bytes
    FROM pg_stat_user_tables
    WHERE relname = ANY(${sql.array(HOT_TABLES as unknown as string[])})
  `;

  const thresholds: Record<TableName, number> = {
    system_runs: SYSTEM_RUNS_THRESHOLD_MB * 1024 * 1024,
    raw_payloads: RAW_PAYLOADS_THRESHOLD_MB * 1024 * 1024,
    odds_snapshots: ODDS_SNAPSHOTS_THRESHOLD_MB * 1024 * 1024,
    provider_offer_history: PROVIDER_OFFER_HISTORY_THRESHOLD_MB * 1024 * 1024,
    game_results: GAME_RESULTS_THRESHOLD_MB * 1024 * 1024,
  };

  const alerts: Alert[] = [];
  for (const row of rows) {
    const threshold = thresholds[row.relname as TableName];
    if (threshold === undefined) continue;
    const bytes = parseInt(row.total_bytes, 10);
    if (bytes > threshold) {
      alerts.push({
        check: 'table_size',
        table: row.relname,
        detail:
          `${row.relname} total size ${row.total_size} (heap ${row.table_size}) ` +
          `exceeds threshold ${Math.round(threshold / 1024 / 1024)}MB`,
        severity: bytes > threshold * 2 ? 'critical' : 'warn',
      });
    }
  }

  return alerts;
}

async function checkToastBloat(sql: postgres.Sql): Promise<Alert[]> {
  const rows = await sql<ToastBloatRow[]>`
    SELECT
      relname,
      pg_size_pretty(pg_relation_size(oid)) AS heap_size,
      pg_size_pretty(pg_total_relation_size(oid) - pg_relation_size(oid)) AS toast_plus_index_size,
      pg_size_pretty(pg_total_relation_size(oid)) AS total_size,
      ROUND(
        (pg_total_relation_size(oid) - pg_relation_size(oid))::numeric /
        NULLIF(pg_total_relation_size(oid), 0) * 100,
        1
      )::text AS toast_pct
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE nspname = 'public'
      AND relname = ANY(${sql.array(TOAST_BLOAT_TABLES as unknown as string[])})
  `;

  const alerts: Alert[] = [];
  for (const row of rows) {
    const toastPct = row.toast_pct === null ? 0 : parseFloat(row.toast_pct);
    if (toastPct > TOAST_BLOAT_RATIO_THRESHOLD * 100) {
      alerts.push({
        check: 'toast_bloat',
        table: row.relname as ToastBloatTableName,
        detail:
          `${row.relname} TOAST+index ratio ${toastPct.toFixed(1)}% exceeds ` +
          `${Math.round(TOAST_BLOAT_RATIO_THRESHOLD * 100)}%; ` +
          `heap=${row.heap_size}, toast_plus_index=${row.toast_plus_index_size}, total=${row.total_size}`,
        severity: toastPct > 90 ? 'critical' : 'warn',
      });
    }
  }

  return alerts;
}

async function checkStatementTimeoutRate(): Promise<Alert[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      '[tripwire] SUPABASE_URL/SERVICE_ROLE_KEY not set — skipping log check',
    );
    return [];
  }

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_logs?type=postgres`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );

    if (!resp.ok) {
      console.warn(
        `[tripwire] log fetch failed: ${resp.status} ${resp.statusText}`,
      );
      return [];
    }

    const logs: Array<{ event_message: string; timestamp: string }> =
      await resp.json();
    const recentTimeouts = logs.filter(
      (l) =>
        l.timestamp >= sixHoursAgo &&
        l.event_message?.toLowerCase().includes('statement timeout'),
    );

    const maxHourlyTimeouts = maxEventsInOneHour(
      recentTimeouts.map((timeout) => new Date(timeout.timestamp)),
    );

    if (maxHourlyTimeouts > STATEMENT_TIMEOUT_RATE_THRESHOLD) {
      return [
        {
          check: 'statement_timeout_rate',
          detail:
            `${recentTimeouts.length} statement timeouts in last 6h; ` +
            `max 1h window=${maxHourlyTimeouts}, threshold=${STATEMENT_TIMEOUT_RATE_THRESHOLD}/h`,
          severity: maxHourlyTimeouts > 10 ? 'critical' : 'warn',
        },
      ];
    }

    return [];
  } catch (err) {
    console.warn('[tripwire] log check error (fail-open):', err);
    return [];
  }
}

async function postLinearAlert(alerts: Alert[]): Promise<void> {
  if (!LINEAR_API_KEY || alerts.length === 0) return;

  const lines = alerts.map(
    (a) =>
      `- **[${a.severity.toUpperCase()}]** ${a.check}${a.table ? ` (${a.table})` : ''}: ${a.detail}`,
  );

  const body = `## DB Health Tripwire Alert\n\nChecked at ${new Date().toISOString()}\n\n${lines.join('\n')}\n\n> Auto-posted by \`db-health-tripwire.yml\`. No DB mutation occurred. All execution actions remain PM-gated.`;

  try {
    const resp = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: LINEAR_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          mutation CreateComment($issueId: String!, $body: String!) {
            commentCreate(input: { issueId: $issueId, body: $body }) {
              success
            }
          }
        `,
        variables: { issueId: LINEAR_ISSUE_ID, body },
      }),
    });

    const data = await resp.json();
    if (!data?.data?.commentCreate?.success) {
      console.warn('[tripwire] Linear comment failed:', JSON.stringify(data));
    } else {
      console.log(`[tripwire] Alert posted to Linear ${LINEAR_ISSUE_ID}`);
    }
  } catch (err) {
    console.warn('[tripwire] Linear post error (fail-open):', err);
  }
}

async function main() {
  if (!SUPABASE_DB_URL) {
    console.error('[tripwire] SUPABASE_DB_URL not set — cannot run DB checks');
    process.exit(1);
  }

  const sql = postgres(SUPABASE_DB_URL, { max: 1, connect_timeout: 10 });

  const allAlerts: Alert[] = [];

  try {
    console.log('[tripwire] Check 1: autovacuum staleness...');
    const vacuumAlerts = await checkAutovacuumStaleness(sql);
    allAlerts.push(...vacuumAlerts);

    console.log('[tripwire] Check 2: table size...');
    const sizeAlerts = await checkTableSize(sql);
    allAlerts.push(...sizeAlerts);

    console.log('[tripwire] Check 3: TOAST bloat...');
    const toastAlerts = await checkToastBloat(sql);
    allAlerts.push(...toastAlerts);
  } finally {
    await sql.end();
  }

  console.log('[tripwire] Check 4: statement timeout rate...');
  const timeoutAlerts = await checkStatementTimeoutRate();
  allAlerts.push(...timeoutAlerts);

  if (allAlerts.length === 0) {
    console.log('[tripwire] All checks PASS — no thresholds exceeded');
    process.exit(0);
  }

  console.warn(`[tripwire] ${allAlerts.length} alert(s) triggered:`);
  for (const a of allAlerts) {
    console.warn(`  [${a.severity.toUpperCase()}] ${a.check}: ${a.detail}`);
  }

  await postLinearAlert(allAlerts);

  const hasCritical = allAlerts.some((a) => a.severity === 'critical');
  process.exit(hasCritical ? 1 : 0);
}

main().catch((err) => {
  console.error('[tripwire] Fatal error (fail-open):', err);
  process.exit(0);
});
