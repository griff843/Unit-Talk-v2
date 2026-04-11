/**
 * UTV2-539 / DEBT-002 — Stranded `awaiting_approval` cleanup — PLAN + DRY-RUN
 *
 * Purpose
 * -------
 * Re-verifies and classifies the set of `picks` rows that are stuck in
 * `status='awaiting_approval'` with NO corresponding `pick_lifecycle` event
 * of `to_state='awaiting_approval'`. Those rows are the residue of the
 * pre-UTV2-519 non-atomic `transitionPickLifecycle()` bug, in which the
 * `picks.status` UPDATE committed while the sibling `pick_lifecycle` INSERT
 * was rejected by `pick_lifecycle_to_state_check`.
 *
 * Hard constraints
 * ----------------
 * - This script is READ-ONLY by default. It issues only SELECT queries.
 * - The `--execute` path is a STUB that immediately exits 2. Actual mutation
 *   wiring ships in a follow-up PR after PM ratification of the plan this
 *   script produces.
 * - There is no DELETE, UPDATE, INSERT, or RPC call against the live DB
 *   anywhere in this file.
 *
 * Classification
 * --------------
 * Each stranded row is classified into one of three buckets:
 *
 *   FIXTURE
 *     metadata has `proof_script`, `proof_fixture_id`, or `test_key`,
 *     OR the `selection` string matches /utv2-494|lane-c|fresh\s*proof/i.
 *     Rationale: proof-script artifacts from UTV2-494 Phase 7A fresh-proof
 *     runs against live DB. Safe to DELETE in the follow-up exec pass.
 *
 *   PRODUCTION-BACKFILL
 *     source = 'system-pick-scanner' AND
 *     metadata.systemGenerated = true AND
 *     metadata.idempotencyKey startsWith 'system-pick:sgo:'.
 *     Rationale: legitimate scanner submissions that hit the constraint gap.
 *     Must be BACKFILLED in the follow-up exec pass: insert the missing
 *     `pick_lifecycle` row (`to_state='awaiting_approval'`, reason noting the
 *     DEBT-002 backfill) and a corresponding `audit_log` row, so the chain
 *     becomes structurally consistent without mutating the original pick.
 *
 *   UNCLASSIFIED
 *     Anything else. The script stops short of producing an execution plan
 *     if any row lands here — those rows require human review before any
 *     cleanup can be proposed.
 *
 * Usage
 * -----
 *   # Dry-run (default) — prints human-readable plan
 *   npx tsx apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts
 *
 *   # Dry-run with machine-readable JSON
 *   npx tsx apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts --json
 *
 *   # "Execute" path — currently a hard stub, exits 2
 *   UTV2_539_PM_APPROVED=1 UTV2_539_EXECUTE_CONFIRMED=yes \
 *     npx tsx apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts --execute
 *
 * Env gates (all required for --execute, even once wired)
 * -------------------------------------------------------
 *   --execute                         CLI flag
 *   UTV2_539_PM_APPROVED=1            explicit PM approval marker
 *   UTV2_539_EXECUTE_CONFIRMED=yes    second confirmation marker
 *   UTV2_539_DRY_RUN_ONLY=1           downgrades --execute to dry-run
 *
 * Drift guard
 * -----------
 * The actualStrandedTotal reported by the fresh query is compared against
 * the last-known plan target (`PLAN_TARGET_TOTAL` below). If they differ,
 * the script exits 1 before any mutation could ever be attempted. That
 * behavior remains in place once the exec wiring lands.
 */

import { loadEnvironment } from '@unit-talk/config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Baseline recorded in KNOWN_DEBT.md DEBT-002 at 2026-04-10:
 *   24 rows total (20 system-pick-scanner, 2 alert-agent, 2 model-driven).
 * The dry-run compares the live count to this baseline and reports drift.
 * The number is informational in the dry-run; in the exec pass it becomes
 * a hard gate.
 */
const PLAN_TARGET_TOTAL = 24;
const PLAN_TARGET_BY_SOURCE: Record<string, number> = {
  'system-pick-scanner': 20,
  'alert-agent': 2,
  'model-driven': 2,
};

const FIXTURE_SELECTION_REGEX = /utv2-494|lane-c|fresh\s*proof/i;

// ---------------------------------------------------------------------------
// Env + client setup (read-only)
// ---------------------------------------------------------------------------

const env = loadEnvironment();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PickRow {
  id: string;
  status: string;
  source: string | null;
  selection: string | null;
  approval_status: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface LifecycleRow {
  pick_id: string;
  to_state: string;
}

type Classification = 'fixture' | 'production-backfill' | 'unclassified';

interface ClassifiedRow {
  pick_id: string;
  source: string | null;
  created_at: string;
  classification: Classification;
  reason: string;
  selection_preview: string;
  idempotency_key_preview: string | null;
}

interface DryRunReport {
  issue: 'UTV2-539';
  debt: 'DEBT-002';
  supabase_project_ref: string;
  generated_at: string;
  mode: 'dry-run';
  execute_requested: boolean;
  execute_blocked_reason: string | null;
  plan_target_total: number;
  plan_target_by_source: Record<string, number>;
  actual_stranded_total: number;
  actual_stranded_by_source: Record<string, number>;
  drift_detected: boolean;
  drift_notes: string[];
  counts: {
    fixture: number;
    productionBackfill: number;
    unclassified: number;
  };
  rows: ClassifiedRow[];
}

// ---------------------------------------------------------------------------
// REST helpers (read-only)
// ---------------------------------------------------------------------------

async function selectRows<T>(
  table: string,
  select: string,
  filters: Record<string, string> = {},
  limit = 500,
): Promise<T[]> {
  const qs = new URLSearchParams({ select, limit: String(limit), ...filters }).toString();
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}`;
  const resp = await fetch(url, { headers: BASE_HEADERS });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`supabase ${table} query failed: HTTP ${resp.status}: ${body}`);
  }
  return (await resp.json()) as T[];
}

// ---------------------------------------------------------------------------
// Re-inventory (fresh live query)
// ---------------------------------------------------------------------------

async function fetchAwaitingApprovalPicks(): Promise<PickRow[]> {
  return selectRows<PickRow>(
    'picks',
    'id,status,source,selection,approval_status,created_at,metadata',
    { status: 'eq.awaiting_approval' },
    1000,
  );
}

async function fetchLifecyclePickIdsForAwaitingApproval(
  pickIds: string[],
): Promise<Set<string>> {
  if (pickIds.length === 0) return new Set();
  // Batch the IN filter to avoid hitting URL length limits with many UUIDs
  const batchSize = 50;
  const seen = new Set<string>();
  for (let i = 0; i < pickIds.length; i += batchSize) {
    const batch = pickIds.slice(i, i + batchSize);
    const inList = batch.join(',');
    const rows = await selectRows<LifecycleRow>(
      'pick_lifecycle',
      'pick_id,to_state',
      {
        to_state: 'eq.awaiting_approval',
        pick_id: `in.(${inList})`,
      },
      1000,
    );
    for (const r of rows) seen.add(r.pick_id);
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function readString(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}

function readBool(obj: unknown, key: string): boolean | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'boolean' ? v : undefined;
  }
  return undefined;
}

function classifyRow(pick: PickRow): { classification: Classification; reason: string } {
  const meta = pick.metadata ?? {};
  const proofScript = readString(meta, 'proof_script');
  const proofFixtureId = readString(meta, 'proof_fixture_id');
  const testKey = readString(meta, 'test_key');
  const selection = pick.selection ?? '';

  // ---- FIXTURE -----------------------------------------------------------
  if (proofScript) {
    return { classification: 'fixture', reason: `metadata.proof_script=${proofScript}` };
  }
  if (proofFixtureId) {
    return { classification: 'fixture', reason: `metadata.proof_fixture_id=${proofFixtureId}` };
  }
  if (testKey) {
    return { classification: 'fixture', reason: `metadata.test_key=${testKey}` };
  }
  if (FIXTURE_SELECTION_REGEX.test(selection)) {
    return { classification: 'fixture', reason: `selection matches /${FIXTURE_SELECTION_REGEX.source}/i` };
  }

  // ---- PRODUCTION-BACKFILL -----------------------------------------------
  const idempotencyKey = readString(meta, 'idempotencyKey');
  const systemGenerated = readBool(meta, 'systemGenerated');
  if (
    pick.source === 'system-pick-scanner' &&
    systemGenerated === true &&
    typeof idempotencyKey === 'string' &&
    idempotencyKey.startsWith('system-pick:sgo:')
  ) {
    return {
      classification: 'production-backfill',
      reason: `scanner systemGenerated=true idempotencyKey=${idempotencyKey}`,
    };
  }

  // ---- UNCLASSIFIED ------------------------------------------------------
  return {
    classification: 'unclassified',
    reason: `source=${pick.source ?? 'null'} no fixture markers, no scanner backfill markers`,
  };
}

function previewSelection(s: string | null): string {
  if (!s) return '';
  const trimmed = s.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

async function buildDryRunReport(executeRequested: boolean, executeBlockedReason: string | null): Promise<DryRunReport> {
  const picks = await fetchAwaitingApprovalPicks();
  const pickIds = picks.map((p) => p.id);
  const withLifecycle = await fetchLifecyclePickIdsForAwaitingApproval(pickIds);

  // Stranded = awaiting_approval pick with NO awaiting_approval lifecycle row
  const stranded = picks.filter((p) => !withLifecycle.has(p.id));

  const bySource: Record<string, number> = {};
  for (const p of stranded) {
    const key = p.source ?? 'null';
    bySource[key] = (bySource[key] ?? 0) + 1;
  }

  const classified: ClassifiedRow[] = stranded.map((p) => {
    const { classification, reason } = classifyRow(p);
    const meta = p.metadata ?? {};
    return {
      pick_id: p.id,
      source: p.source,
      created_at: p.created_at,
      classification,
      reason,
      selection_preview: previewSelection(p.selection),
      idempotency_key_preview: readString(meta, 'idempotencyKey') ?? null,
    };
  });

  const counts = {
    fixture: classified.filter((r) => r.classification === 'fixture').length,
    productionBackfill: classified.filter((r) => r.classification === 'production-backfill').length,
    unclassified: classified.filter((r) => r.classification === 'unclassified').length,
  };

  // Drift detection (informational in dry-run, gating in exec)
  const driftNotes: string[] = [];
  if (stranded.length !== PLAN_TARGET_TOTAL) {
    driftNotes.push(
      `actualStrandedTotal=${stranded.length} differs from PLAN_TARGET_TOTAL=${PLAN_TARGET_TOTAL}`,
    );
  }
  for (const [src, expected] of Object.entries(PLAN_TARGET_BY_SOURCE)) {
    const actual = bySource[src] ?? 0;
    if (actual !== expected) {
      driftNotes.push(`source=${src} actual=${actual} expected=${expected}`);
    }
  }
  for (const [src, actual] of Object.entries(bySource)) {
    if (!(src in PLAN_TARGET_BY_SOURCE)) {
      driftNotes.push(`unexpected source=${src} actual=${actual} (not in PLAN_TARGET_BY_SOURCE)`);
    }
  }

  return {
    issue: 'UTV2-539',
    debt: 'DEBT-002',
    supabase_project_ref: 'feownrheeefbcsehtsiw',
    generated_at: new Date().toISOString(),
    mode: 'dry-run',
    execute_requested: executeRequested,
    execute_blocked_reason: executeBlockedReason,
    plan_target_total: PLAN_TARGET_TOTAL,
    plan_target_by_source: PLAN_TARGET_BY_SOURCE,
    actual_stranded_total: stranded.length,
    actual_stranded_by_source: bySource,
    drift_detected: driftNotes.length > 0,
    drift_notes: driftNotes,
    counts,
    rows: classified,
  };
}

function printHumanReport(r: DryRunReport): void {
  console.log('');
  console.log('UTV2-539 / DEBT-002 — stranded awaiting_approval cleanup — DRY-RUN');
  console.log('='.repeat(72));
  console.log(`generated_at:          ${r.generated_at}`);
  console.log(`supabase_project_ref:  ${r.supabase_project_ref}`);
  console.log(`mode:                  ${r.mode}`);
  console.log(`execute_requested:     ${r.execute_requested}`);
  if (r.execute_blocked_reason) {
    console.log(`execute_blocked:       ${r.execute_blocked_reason}`);
  }
  console.log('');
  console.log('Inventory');
  console.log('-'.repeat(72));
  console.log(`actual_stranded_total: ${r.actual_stranded_total} (plan target: ${r.plan_target_total})`);
  console.log('actual_stranded_by_source:');
  for (const [src, n] of Object.entries(r.actual_stranded_by_source)) {
    const target = r.plan_target_by_source[src];
    const tag = target === undefined ? '[UNEXPECTED SOURCE]' : target === n ? '' : `[plan=${target}]`;
    console.log(`  ${src.padEnd(24)} ${String(n).padStart(3)}  ${tag}`);
  }
  console.log('');
  console.log('Classification counts');
  console.log('-'.repeat(72));
  console.log(`  fixture              ${r.counts.fixture}`);
  console.log(`  production-backfill  ${r.counts.productionBackfill}`);
  console.log(`  unclassified         ${r.counts.unclassified}`);
  console.log('');
  console.log('Drift');
  console.log('-'.repeat(72));
  if (r.drift_detected) {
    for (const n of r.drift_notes) console.log(`  * ${n}`);
  } else {
    console.log('  none');
  }
  console.log('');
  console.log('Rows');
  console.log('-'.repeat(72));
  for (const row of r.rows) {
    console.log(
      `  ${row.pick_id}  ${String(row.source ?? 'null').padEnd(20)}  ${row.classification.padEnd(20)}  ${row.reason}`,
    );
  }
  console.log('');
  if (r.counts.unclassified > 0) {
    console.log('STOP: unclassified rows present — do not propose execution plan until resolved.');
  } else {
    console.log('OK: all rows classified — plan is ready for PM review.');
  }
}

// ---------------------------------------------------------------------------
// Execute path — HARD STUB
// ---------------------------------------------------------------------------

function executeStubAndExit(): never {
  console.error('');
  console.error('UTV2-539 execute path not wired — see follow-up PR UTV2-539-exec');
  console.error('This pass is PLAN + DRY-RUN ONLY. No production mutation is performed.');
  console.error('');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const wantExecute = argv.includes('--execute');

  // Env gates — evaluated BEFORE any work so misconfiguration is visible.
  const pmApproved = process.env['UTV2_539_PM_APPROVED'] === '1';
  const execConfirmed = process.env['UTV2_539_EXECUTE_CONFIRMED'] === 'yes';
  const dryRunOnly = process.env['UTV2_539_DRY_RUN_ONLY'] === '1';

  let executeBlockedReason: string | null = null;
  if (wantExecute) {
    if (dryRunOnly) {
      executeBlockedReason = 'UTV2_539_DRY_RUN_ONLY=1 — downgrading --execute to dry-run';
    } else if (!pmApproved) {
      executeBlockedReason = 'UTV2_539_PM_APPROVED=1 required';
    } else if (!execConfirmed) {
      executeBlockedReason = 'UTV2_539_EXECUTE_CONFIRMED=yes required';
    }
  }

  // Build the dry-run report (read-only).
  const report = await buildDryRunReport(wantExecute, executeBlockedReason);

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  // If execute was requested AND all gates pass AND not downgraded — stub.
  if (wantExecute && executeBlockedReason === null) {
    executeStubAndExit();
  }

  // Otherwise exit cleanly from the dry-run.
  // Note: unclassified rows do not fail the dry-run exit code — they are
  // surfaced in the report and must be resolved before exec wiring ships.
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
