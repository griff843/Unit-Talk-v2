#!/usr/bin/env tsx
/**
 * DB health tripwire monitor — read-only checks on hot tables.
 * UTV2-1300 / §5 of DB_MAINTENANCE_RETENTION_SPEC.md
 * UTV2-1632 — made to actually execute, and to prove that it did.
 *
 * This module owns the side effects: the database connection, the HTTP calls,
 * the receipt file and the process exit codes. The check logic it drives lives
 * in `db-health-checks.ts`, which imports nothing and can therefore be unit
 * tested without a path from the test suite to a privileged client.
 *
 * ## What UTV2-1632 found
 *
 * This monitor had never run a single check. Two independent defects stood in
 * front of the first query, and each on its own was sufficient:
 *
 *   1. `.github/workflows/db-health-tripwire.yml` invoked `tsx` by bare binary
 *      name. `tsx` is a workspace devDependency, not on the runner's PATH, so
 *      the step exited 127 before Node started.
 *   2. `import postgres from 'postgres'` named a package that appeared in no
 *      `package.json` and had no lockfile entry anywhere in this repository.
 *      Fixing (1) alone would have moved the failure from exit 127 to a
 *      MODULE_NOT_FOUND exit 1 — still zero checks executed.
 *
 * Neither was visible from outside, because the job's only signal was a red
 * badge, and a red badge is also what a genuine finding looks like. A monitor
 * that has never worked was indistinguishable from a monitor that is working
 * and unhappy.
 *
 * ## What this file now guarantees
 *
 * **Execution is measured, not inferred.** Every check emits a row naming what
 * was measured, the threshold it was measured against, and the verdict —
 * including checks that could NOT run, which are recorded as `not_run` with a
 * reason rather than silently contributing nothing. A receipt reporting zero
 * executed checks fails the job closed (`--assert-executed`). Exit code 0 is
 * never taken as evidence that the logic ran, because that is precisely the
 * defect being fixed.
 *
 * **The three outcomes are separated.** `harness_error` (could not run),
 * `checks_passed` (ran, nothing exceeded) and `checks_tripped` (ran, something
 * exceeded) are distinct receipt outcomes surfaced by distinct workflow steps.
 * A permanently broken monitor can no longer masquerade as a real finding.
 *
 * **Read-only is enforced, not asserted.** Every catalog query runs inside a
 * transaction opened with `SET TRANSACTION READ ONLY`, and the receipt records
 * the value Postgres itself reports for `transaction_read_only`. The connection
 * string still passes through the UTV2-1628 boundary before it is opened.
 *
 * Thresholds may be overridden for a single `workflow_dispatch` run via
 * `TRIPWIRE_THRESHOLD_OVERRIDES`. That exists so the check logic can be shown
 * to *evaluate* rather than merely start: lower a threshold, watch a check
 * trip. Overrides are restricted to known threshold keys, are recorded per
 * check in the receipt, and suppress the Linear alert so a demonstration can
 * never be mistaken for a production finding.
 *
 * No writes, no DDL, no mutations.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import {
  assertPostgresConnectionAllowed,
  classifyTarget,
} from '@unit-talk/db/privileged-client-boundary';
import {
  DEFAULT_RECEIPT_PATH,
  EXIT_HARNESS_ERROR,
  HOT_TABLES,
  HarnessError,
  LINEAR_ISSUE_ID,
  RECEIPT_SCHEMA,
  TOAST_BLOAT_TABLES,
  countChecks,
  deriveOutcome,
  evaluateAutovacuumRow,
  evaluateSizeRow,
  evaluateStatementTimeoutRate,
  evaluateToastRow,
  gateReceipt,
  hasOverriddenThreshold,
  notRunCheck,
  readRunContext,
  renderCheckTable,
  resolveThresholds,
  type CheckOutcome,
  type LinearAlertDisposition,
  type SizeRow,
  type ThresholdTable,
  type ToastBloatRow,
  type TripwireReceipt,
  type VacuumRow,
} from './db-health-checks.js';

const HOURS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

function writeReceipt(receiptPath: string, receipt: TripwireReceipt): void {
  const absolute = path.resolve(receiptPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

function writeStepSummary(markdown: string): void {
  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (!summaryPath) return;
  try {
    appendFileSync(summaryPath, `${markdown}\n`, 'utf8');
  } catch {
    // The summary is a convenience. Never let it change the job outcome.
  }
}

async function runDatabaseChecks(
  sql: postgres.Sql,
  thresholds: ThresholdTable,
  now: Date,
): Promise<{ checks: CheckOutcome[]; observedReadOnly: string | null }> {
  const checks: CheckOutcome[] = [];
  let observedReadOnly: string | null = null;

  // One explicit transaction, opened read-only. `SET TRANSACTION READ ONLY`
  // (rather than a session-level setting or a startup-packet option) is the
  // form that survives a transaction-pooling connection, which is what
  // SUPABASE_DB_POOLER_URL resolves to. The value Postgres reports back is
  // recorded so read-only is measured rather than claimed.
  await sql.begin(async (tx) => {
    await tx.unsafe('SET TRANSACTION READ ONLY');
    const readOnlyRows =
      await tx.unsafe<Array<{ transaction_read_only: string }>>('SHOW transaction_read_only');
    observedReadOnly = readOnlyRows[0]?.transaction_read_only ?? null;

    const vacuumRows = await tx<VacuumRow[]>`
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
      WHERE relname = ANY(${tx.array(HOT_TABLES as unknown as string[])})
      ORDER BY relname
    `;
    const vacuumSeen = new Set(vacuumRows.map((row) => row.relname));
    for (const row of vacuumRows) checks.push(evaluateAutovacuumRow(row, thresholds, now));
    for (const table of HOT_TABLES) {
      if (!vacuumSeen.has(table)) {
        checks.push(
          notRunCheck(
            'autovacuum_staleness',
            table,
            `${table} has no row in pg_stat_user_tables; vacuum statistics could not be measured`,
          ),
        );
      }
    }

    const sizeRows = await tx<SizeRow[]>`
      SELECT
        relname,
        pg_size_pretty(pg_relation_size(relid)) AS table_size,
        pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
        pg_total_relation_size(relid)::text AS total_bytes
      FROM pg_stat_user_tables
      WHERE relname = ANY(${tx.array(HOT_TABLES as unknown as string[])})
      ORDER BY relname
    `;
    const sizeSeen = new Set(sizeRows.map((row) => row.relname));
    for (const row of sizeRows) checks.push(evaluateSizeRow(row, thresholds));
    for (const table of HOT_TABLES) {
      if (!sizeSeen.has(table)) {
        checks.push(
          notRunCheck(
            'table_size',
            table,
            `${table} has no row in pg_stat_user_tables; size could not be measured`,
          ),
        );
      }
    }

    const toastRows = await tx<ToastBloatRow[]>`
      SELECT
        relname,
        pg_size_pretty(pg_relation_size(pg_class.oid)) AS heap_size,
        pg_size_pretty(
          pg_total_relation_size(pg_class.oid) - pg_relation_size(pg_class.oid)
        ) AS toast_plus_index_size,
        pg_size_pretty(pg_total_relation_size(pg_class.oid)) AS total_size,
        ROUND(
          (pg_total_relation_size(pg_class.oid) - pg_relation_size(pg_class.oid))::numeric /
          NULLIF(pg_total_relation_size(pg_class.oid), 0) * 100,
          1
        )::text AS toast_pct
      FROM pg_class
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE nspname = 'public'
        AND relname = ANY(${tx.array(TOAST_BLOAT_TABLES as unknown as string[])})
      ORDER BY relname
    `;
    const toastSeen = new Set(toastRows.map((row) => row.relname));
    for (const row of toastRows) checks.push(evaluateToastRow(row, thresholds));
    for (const table of TOAST_BLOAT_TABLES) {
      if (!toastSeen.has(table)) {
        checks.push(
          notRunCheck('toast_bloat', table, `${table} has no row in pg_class for schema public`),
        );
      }
    }
  });

  return { checks, observedReadOnly };
}

async function runStatementTimeoutCheck(thresholds: ThresholdTable): Promise<CheckOutcome> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !serviceRoleKey) {
    return notRunCheck(
      'statement_timeout_rate',
      null,
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — the Postgres log source was unreachable',
    );
  }

  const sixHoursAgo = new Date(Date.now() - 6 * HOURS).toISOString();

  try {
    // GET only. The service-role key authenticates a read of the log endpoint;
    // no request in this file uses any other HTTP verb against the database.
    const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/get_logs?type=postgres`, {
      method: 'GET',
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });

    if (!resp.ok) {
      return notRunCheck(
        'statement_timeout_rate',
        null,
        `Postgres log endpoint returned ${resp.status} ${resp.statusText}; ` +
          'timeout rate could not be measured',
      );
    }

    const payload: unknown = await resp.json();
    if (!Array.isArray(payload)) {
      return notRunCheck(
        'statement_timeout_rate',
        null,
        'Postgres log endpoint did not return an array; timeout rate could not be measured',
      );
    }

    const logs = payload as Array<{ event_message?: string; timestamp?: string }>;
    const recent = logs.filter(
      (entry) =>
        typeof entry.timestamp === 'string' &&
        entry.timestamp >= sixHoursAgo &&
        typeof entry.event_message === 'string' &&
        entry.event_message.toLowerCase().includes('statement timeout'),
    );

    return evaluateStatementTimeoutRate(
      recent.map((entry) => new Date(entry.timestamp as string)),
      recent.length,
      thresholds,
    );
  } catch (err) {
    return notRunCheck(
      'statement_timeout_rate',
      null,
      `Postgres log fetch failed (${(err as Error).message}); timeout rate could not be measured`,
    );
  }
}

async function linearGraphql(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const resp = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await resp.json()) as { data?: Record<string, unknown>; errors?: unknown };
  if (body.errors) {
    console.warn('[tripwire] Linear API error:', JSON.stringify(body.errors));
    return null;
  }
  return body.data ?? null;
}

/**
 * `commentCreate` takes the issue's UUID, not its human identifier. The previous
 * implementation passed `'UTV2-1300'` straight through, so every alert this
 * monitor would ever have raised failed with "Issue 'UTV2-1300' not found" —
 * a third way the tripwire was dark, invisible for the same reason as the other
 * two: the failure was logged as a warning and swallowed.
 */
async function resolveLinearIssueUuid(apiKey: string, identifier: string): Promise<string | null> {
  const data = await linearGraphql(
    apiKey,
    'query IssueByIdentifier($id: String!) { issue(id: $id) { id identifier } }',
    { id: identifier },
  );
  const issue = data?.['issue'] as { id?: string } | null | undefined;
  return typeof issue?.id === 'string' ? issue.id : null;
}

async function postLinearAlert(checks: readonly CheckOutcome[]): Promise<LinearAlertDisposition> {
  const apiKey = process.env['LINEAR_API_KEY'];
  const tripped = checks.filter((c) => c.status === 'tripped');
  if (tripped.length === 0) return 'not_applicable';
  if (!apiKey) return 'skipped_no_api_key';

  const lines = tripped.map(
    (c) =>
      `- **[${(c.severity ?? 'warn').toUpperCase()}]** ${c.check}` +
      `${c.subject ? ` (${c.subject})` : ''}: ${c.detail}`,
  );
  const body =
    `## DB Health Tripwire Alert\n\nChecked at ${new Date().toISOString()}\n\n` +
    `${lines.join('\n')}\n\n` +
    '> Auto-posted by `db-health-tripwire.yml`. No DB mutation occurred. ' +
    'All execution actions remain PM-gated.';

  try {
    const issueUuid = await resolveLinearIssueUuid(apiKey, LINEAR_ISSUE_ID);
    if (!issueUuid) {
      console.warn(`[tripwire] Linear issue ${LINEAR_ISSUE_ID} could not be resolved to a UUID`);
      return 'failed';
    }

    const data = await linearGraphql(
      apiKey,
      `mutation CreateComment($issueId: String!, $body: String!) {
         commentCreate(input: { issueId: $issueId, body: $body }) { success }
       }`,
      { issueId: issueUuid, body },
    );
    const created = data?.['commentCreate'] as { success?: boolean } | undefined;
    if (created?.success !== true) {
      console.warn('[tripwire] Linear comment failed:', JSON.stringify(data));
      return 'failed';
    }
    console.log(`[tripwire] Alert posted to Linear ${LINEAR_ISSUE_ID} (${issueUuid})`);
    return 'posted';
  } catch (err) {
    console.warn('[tripwire] Linear post error:', (err as Error).message);
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function argValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function loadReceipt(receiptPath: string): unknown {
  if (!existsSync(receiptPath)) {
    throw new HarnessError(
      `receipt not found at ${receiptPath}. The tripwire step must produce a receipt; ` +
        'an absent receipt fails closed rather than passing silently.',
    );
  }
  return JSON.parse(readFileSync(receiptPath, 'utf8'));
}

/** `--assert-executed <receipt>`: fail closed unless the receipt proves checks ran. */
export function assertExecutedMode(receiptPath: string): number {
  let receipt: unknown;
  try {
    receipt = loadReceipt(receiptPath);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[tripwire:gate] FAIL — ${message}`);
    writeStepSummary(`### Tripwire execution gate: FAIL\n\n- ${message}`);
    return 1;
  }

  const result = gateReceipt(receipt);
  if (result.verdict === 'PASS') {
    const counts = (receipt as TripwireReceipt).counts;
    console.log(
      `[tripwire:gate] PASS — ${counts.executed}/${counts.total} checks executed ` +
        `(${counts.passed} pass, ${counts.tripped} tripped, ${counts.not_run} not run)`,
    );
    return 0;
  }
  console.error('[tripwire:gate] FAIL — the receipt does not prove the checks executed:');
  for (const reason of result.reasons) console.error(`  - ${reason}`);
  writeStepSummary(
    `### Tripwire execution gate: FAIL\n\n${result.reasons.map((r) => `- ${r}`).join('\n')}`,
  );
  return 1;
}

/** `--assert-healthy <receipt>`: fail only when a check genuinely tripped. */
export function assertHealthyMode(receiptPath: string): number {
  let receipt: TripwireReceipt;
  try {
    receipt = loadReceipt(receiptPath) as TripwireReceipt;
  } catch (err) {
    console.error(`[tripwire:verdict] FAIL — ${(err as Error).message}`);
    return 1;
  }

  if (receipt.outcome === 'checks_passed') {
    console.log('[tripwire:verdict] HEALTHY — every executed check is within threshold');
    return 0;
  }
  if (receipt.outcome === 'checks_tripped') {
    const tripped = receipt.checks.filter((c) => c.status === 'tripped');
    console.error(`[tripwire:verdict] FINDING — ${tripped.length} check(s) exceeded threshold:`);
    for (const c of tripped) {
      console.error(`  [${(c.severity ?? 'warn').toUpperCase()}] ${c.check}: ${c.detail}`);
    }
    return 1;
  }
  console.error(
    `[tripwire:verdict] harness_error — ${receipt.harness_error ?? 'no reason recorded'}`,
  );
  return 1;
}

export async function runTripwire(receiptPath: string): Promise<number> {
  const now = new Date();
  const run = readRunContext();
  const connectionString = process.env['SUPABASE_DB_URL'];

  const failHarness = (message: string, extra: Partial<TripwireReceipt> = {}): number => {
    console.error(`[tripwire] harness error — ${message}`);
    writeReceipt(receiptPath, {
      schema: RECEIPT_SCHEMA,
      issue: 'UTV2-1632',
      generated_at: now.toISOString(),
      outcome: 'harness_error',
      harness_error: message,
      run,
      target: { kind: 'unidentified', project_ref: null, host: null },
      read_only: { mechanism: 'SET TRANSACTION READ ONLY', observed_transaction_read_only: null },
      thresholds: {},
      threshold_override_active: false,
      counts: countChecks([]),
      checks: [],
      linear_alert: 'not_applicable',
      ...extra,
    });
    writeStepSummary(`### DB Health Tripwire: harness error\n\n\`\`\`\n${message}\n\`\`\``);
    return EXIT_HARNESS_ERROR;
  };

  let thresholds: ThresholdTable;
  try {
    thresholds = resolveThresholds();
  } catch (err) {
    return failHarness((err as Error).message);
  }

  if (!connectionString) {
    return failHarness('SUPABASE_DB_URL is not set — no database connection could be opened', {
      thresholds,
    });
  }

  const target = classifyTarget(connectionString);
  const targetBlock = { kind: target.kind, project_ref: target.projectRef, host: target.host };

  let sql: postgres.Sql;
  try {
    sql = postgres(assertPostgresConnectionAllowed(connectionString, 'db-health-tripwire'), {
      max: 1,
      connect_timeout: 10,
    });
  } catch (err) {
    return failHarness(`connection refused before opening: ${(err as Error).message}`, {
      thresholds,
      target: targetBlock,
    });
  }

  let checks: CheckOutcome[];
  let observedReadOnly: string | null;
  try {
    console.log('[tripwire] running catalog checks inside a READ ONLY transaction...');
    const result = await runDatabaseChecks(sql, thresholds, now);
    checks = result.checks;
    observedReadOnly = result.observedReadOnly;
  } catch (err) {
    return failHarness(`database checks could not complete: ${(err as Error).message}`, {
      thresholds,
      target: targetBlock,
    });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }

  console.log('[tripwire] checking statement timeout rate...');
  checks.push(await runStatementTimeoutCheck(thresholds));

  const overridden = hasOverriddenThreshold(thresholds);
  const outcome = deriveOutcome(checks);

  // A demonstration must never be able to raise a production alert.
  const linearAlert: LinearAlertDisposition = overridden
    ? 'suppressed_threshold_override'
    : await postLinearAlert(checks);

  const receipt: TripwireReceipt = {
    schema: RECEIPT_SCHEMA,
    issue: 'UTV2-1632',
    generated_at: now.toISOString(),
    outcome,
    harness_error: null,
    run,
    target: targetBlock,
    read_only: {
      mechanism: 'SET TRANSACTION READ ONLY',
      observed_transaction_read_only: observedReadOnly,
    },
    thresholds,
    threshold_override_active: overridden,
    counts: countChecks(checks),
    checks,
    linear_alert: linearAlert,
  };

  writeReceipt(receiptPath, receipt);

  // A monitor whose alert channel is broken is the same class of problem as a
  // monitor that never runs, so it is annotated rather than left in the receipt
  // alone. It is deliberately NOT a job failure: conflating "could not notify"
  // with "the database is unhealthy" is what this lane exists to undo.
  if (linearAlert === 'failed') {
    console.log(
      '::warning title=DB Health Tripwire::Checks tripped but the Linear alert could not be ' +
        `delivered to ${LINEAR_ISSUE_ID}. The finding is in the receipt artifact; the ` +
        'notification path needs repair.',
    );
  }

  const table = renderCheckTable(checks);
  console.log(table);
  console.log(
    `[tripwire] outcome=${outcome} executed=${receipt.counts.executed}/${receipt.counts.total} ` +
      `passed=${receipt.counts.passed} tripped=${receipt.counts.tripped} ` +
      `not_run=${receipt.counts.not_run}`,
  );
  writeStepSummary(
    `### DB Health Tripwire — \`${outcome}\`\n\n` +
      `${receipt.counts.executed}/${receipt.counts.total} checks executed against ` +
      `\`${targetBlock.project_ref ?? targetBlock.host ?? 'unidentified target'}\`, ` +
      `transaction_read_only=\`${observedReadOnly ?? 'unknown'}\`` +
      `${
        overridden
          ? ' — **threshold override active (diagnostic run; Linear alert suppressed)**'
          : ''
      }\n\n${table}`,
  );

  // The producer's exit code answers only "did the harness work". Whether a
  // check tripped is a separate question answered by --assert-healthy, so that
  // a broken monitor and a real finding never render as the same red step.
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const assertExecuted = argValue(argv, '--assert-executed');
  if (assertExecuted !== null) return assertExecutedMode(assertExecuted);

  const assertHealthy = argValue(argv, '--assert-healthy');
  if (assertHealthy !== null) return assertHealthyMode(assertHealthy);

  return runTripwire(argValue(argv, '--receipt') ?? DEFAULT_RECEIPT_PATH);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      // Fail closed. The previous implementation exited 0 here, which meant any
      // unexpected error was reported as a healthy monitor.
      console.error('[tripwire] unhandled harness error:', err);
      process.exitCode = EXIT_HARNESS_ERROR;
    });
}
