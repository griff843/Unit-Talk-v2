#!/usr/bin/env tsx
/**
 * DB health tripwire monitor — read-only checks on hot tables.
 * UTV2-1300 / §5 of DB_MAINTENANCE_RETENTION_SPEC.md
 *
 * Checks:
 *   1. Autovacuum staleness (pg_stat_user_tables)
 *   2. Table size growth (pg_total_relation_size)
 *   3. Statement timeout error rate (Supabase logs)
 *
 * No writes, no DDL, no mutations. Fail-open.
 */

import postgres from 'postgres';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const LINEAR_ISSUE_ID = 'UTV2-1300';

const SYSTEM_RUNS_THRESHOLD_MB = parseInt(process.env.SYSTEM_RUNS_SIZE_THRESHOLD_MB ?? '500', 10);
const RAW_PAYLOADS_THRESHOLD_MB = parseInt(process.env.RAW_PAYLOADS_SIZE_THRESHOLD_MB ?? '2048', 10);
const ODDS_SNAPSHOTS_THRESHOLD_MB = parseInt(process.env.ODDS_SNAPSHOTS_SIZE_THRESHOLD_MB ?? '1024', 10);
const AUTOVACUUM_STALENESS_HOURS = parseInt(process.env.AUTOVACUUM_STALENESS_HOURS ?? '24', 10);
const STATEMENT_TIMEOUT_RATE_THRESHOLD = parseInt(process.env.STATEMENT_TIMEOUT_RATE_THRESHOLD ?? '5', 10);

const HOT_TABLES = ['system_runs', 'raw_payloads', 'odds_snapshots'] as const;

type TableName = (typeof HOT_TABLES)[number];

interface VacuumRow {
  relname: string;
  last_autovacuum: Date | null;
  last_autoanalyze: Date | null;
  n_dead_tup: string;
  n_live_tup: string;
}

interface SizeRow {
  relname: string;
  total_size: string;
  total_bytes: string;
}

interface Alert {
  check: string;
  table?: string;
  detail: string;
  severity: 'warn' | 'critical';
}

async function checkAutovacuumStaleness(sql: postgres.Sql): Promise<Alert[]> {
  const rows = await sql<VacuumRow[]>`
    SELECT
      relname,
      last_autovacuum,
      last_autoanalyze,
      n_dead_tup::text,
      n_live_tup::text
    FROM pg_stat_user_tables
    WHERE relname = ANY(${sql.array(HOT_TABLES as unknown as string[])})
    ORDER BY n_dead_tup DESC
  `;

  const alerts: Alert[] = [];
  const cutoff = new Date(Date.now() - AUTOVACUUM_STALENESS_HOURS * 60 * 60 * 1000);

  for (const row of rows) {
    if (row.last_autovacuum === null || row.last_autovacuum < cutoff) {
      const when = row.last_autovacuum
        ? `last run ${row.last_autovacuum.toISOString()}`
        : 'never run';
      alerts.push({
        check: 'autovacuum_staleness',
        table: row.relname,
        detail: `autovacuum stale on ${row.relname}: ${when}, dead_tup=${row.n_dead_tup}`,
        severity: parseInt(row.n_dead_tup, 10) > 100_000 ? 'critical' : 'warn',
      });
    }
  }

  return alerts;
}

async function checkTableSize(sql: postgres.Sql): Promise<Alert[]> {
  const rows = await sql<SizeRow[]>`
    SELECT
      relname,
      pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
      pg_total_relation_size(relid)::text AS total_bytes
    FROM pg_stat_user_tables
    WHERE relname = ANY(${sql.array(HOT_TABLES as unknown as string[])})
  `;

  const thresholds: Record<TableName, number> = {
    system_runs: SYSTEM_RUNS_THRESHOLD_MB * 1024 * 1024,
    raw_payloads: RAW_PAYLOADS_THRESHOLD_MB * 1024 * 1024,
    odds_snapshots: ODDS_SNAPSHOTS_THRESHOLD_MB * 1024 * 1024,
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
        detail: `${row.relname} size ${row.total_size} exceeds threshold ${Math.round(threshold / 1024 / 1024)}MB`,
        severity: bytes > threshold * 2 ? 'critical' : 'warn',
      });
    }
  }

  return alerts;
}

async function checkStatementTimeoutRate(): Promise<Alert[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[tripwire] SUPABASE_URL/SERVICE_ROLE_KEY not set — skipping log check');
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
      }
    );

    if (!resp.ok) {
      console.warn(`[tripwire] log fetch failed: ${resp.status} ${resp.statusText}`);
      return [];
    }

    const logs: Array<{ event_message: string; timestamp: string }> = await resp.json();
    const recentTimeouts = logs.filter(
      (l) =>
        l.timestamp >= sixHoursAgo &&
        l.event_message?.toLowerCase().includes('statement timeout')
    );

    const rate = recentTimeouts.length / 6;
    if (rate > STATEMENT_TIMEOUT_RATE_THRESHOLD) {
      return [
        {
          check: 'statement_timeout_rate',
          detail: `${recentTimeouts.length} statement timeouts in last 6h (${rate.toFixed(1)}/h), threshold=${STATEMENT_TIMEOUT_RATE_THRESHOLD}/h`,
          severity: rate > STATEMENT_TIMEOUT_RATE_THRESHOLD * 3 ? 'critical' : 'warn',
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
    (a) => `- **[${a.severity.toUpperCase()}]** ${a.check}${a.table ? ` (${a.table})` : ''}: ${a.detail}`
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
  } finally {
    await sql.end();
  }

  console.log('[tripwire] Check 3: statement timeout rate...');
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
