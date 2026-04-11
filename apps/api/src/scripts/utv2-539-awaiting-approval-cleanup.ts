/**
 * UTV2-539 / DEBT-002 — Stranded `awaiting_approval` cleanup — PLAN + EXECUTE
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
 * Operating modes
 * ---------------
 * - Default: read-only DRY-RUN. Only SELECT queries against the live DB.
 * - `--execute` (with both env gates set): EXECUTE PRODUCTION MUTATION.
 *   Sequentially deletes the 7 fixture rows (audit_log + pick_lifecycle +
 *   picks DELETE per row, status='awaiting_approval' filter as drift guard)
 *   and then sequentially calls the
 *   `public.backfill_pick_awaiting_approval(p_pick_id, p_linear_issue)` RPC
 *   (shipped in `supabase/migrations/202604110001_utv2_539_backfill_pick_awaiting_approval_rpc.sql`)
 *   for each of the 17 production-backfill rows. The RPC writes the missing
 *   `pick_lifecycle` row + matching `audit_log` row atomically and is
 *   protected by an `INVALID_BACKFILL_STATE` drift guard and an
 *   `ALREADY_BACKFILLED` idempotency guard at the SQL layer.
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
 *   # Execute path — performs production mutation. Requires BOTH env gates.
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
// REST helpers (write — execute path only)
// ---------------------------------------------------------------------------

interface RestResult<T = unknown> {
  ok: boolean;
  status: number;
  body: T | null;
  error: string | null;
}

/**
 * Issue a DELETE against a Supabase REST table. Filters are PostgREST-style
 * (`status: 'eq.awaiting_approval'`). Returns the deleted rows when the
 * server honours `Prefer: return=representation`.
 *
 * Used by the fixture-delete loop. The status filter is the drift guard:
 * if the row was moved out of `awaiting_approval` between dry-run and
 * execute, the DELETE matches zero rows and the loop reports the drift
 * before continuing.
 */
async function deleteRows<T = unknown>(
  table: string,
  filters: Record<string, string>,
): Promise<RestResult<T[]>> {
  const qs = new URLSearchParams(filters).toString();
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'DELETE',
      headers: { ...BASE_HEADERS, Prefer: 'return=representation' },
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const text = await resp.text().catch(() => '');
  if (!resp.ok) {
    return { ok: false, status: resp.status, body: null, error: `HTTP ${resp.status}: ${text}` };
  }

  let parsed: T[] | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as T[];
    } catch {
      parsed = null;
    }
  }
  return { ok: true, status: resp.status, body: parsed, error: null };
}

/**
 * POST to a Supabase REST RPC endpoint. Used by the production-backfill
 * loop to call `public.backfill_pick_awaiting_approval(p_pick_id, p_linear_issue)`.
 * The RPC enforces drift + idempotency at the SQL layer; this helper just
 * surfaces the response shape.
 */
async function callRpc<T = unknown>(
  fn: string,
  body: Record<string, unknown>,
): Promise<RestResult<T>> {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { ...BASE_HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const text = await resp.text().catch(() => '');
  if (!resp.ok) {
    return { ok: false, status: resp.status, body: null, error: `HTTP ${resp.status}: ${text}` };
  }

  let parsed: T | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      parsed = null;
    }
  }
  return { ok: true, status: resp.status, body: parsed, error: null };
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
// Execute path — production mutation (gated)
// ---------------------------------------------------------------------------

interface PerRowResult {
  pick_id: string;
  classification: Classification;
  ok: boolean;
  detail: string;
  lifecycle_event_id?: string | null;
}

interface ExecuteSummary {
  executedAt: string;
  fixturesDeleted: number;
  backfillsPersisted: number;
  failedAt: string | null;
  perRowResults: PerRowResult[];
}

const POST_EXEC_VERIFY_QUERIES = `
-- §5 post-execution verification queries (run after the mutation pass)

-- (1) Must return 0 — no stranded picks remain
SELECT COUNT(*) FROM picks p
WHERE p.status = 'awaiting_approval'
  AND NOT EXISTS (
    SELECT 1 FROM pick_lifecycle l
    WHERE l.pick_id = p.id AND l.to_state = 'awaiting_approval'
  );

-- (2) Must equal 17 — one backfilled lifecycle row per production-backfill pick
SELECT COUNT(*) FROM pick_lifecycle
WHERE to_state = 'awaiting_approval'
  AND reason = 'backfill_utv2_519_remediation';

-- (3) Must equal 17 — one audit row per backfilled lifecycle row
SELECT COUNT(*) FROM audit_log
WHERE action = 'pick.governance_brake.backfilled'
  AND payload->>'linear_issue' = 'UTV2-539';

-- (4) Must equal 0 — no surviving fixture rows from this run
SELECT COUNT(*) FROM picks
WHERE id = ANY(<7 fixture ids printed by the execute summary>::uuid[]);
`;

function emitVerifyQueries(): void {
  console.error('');
  console.error('Post-execution verification queries (run manually after PM witness):');
  console.error('-'.repeat(72));
  console.error(POST_EXEC_VERIFY_QUERIES);
}

/**
 * Execute production mutation. Assumes all env gates have already passed
 * and the dry-run report has been built (so we can re-classify and check
 * drift before touching anything).
 */
async function runExecute(report: DryRunReport): Promise<ExecuteSummary> {
  const summary: ExecuteSummary = {
    executedAt: new Date().toISOString(),
    fixturesDeleted: 0,
    backfillsPersisted: 0,
    failedAt: null,
    perRowResults: [],
  };

  // Drift guard: total must match plan target.
  if (report.actual_stranded_total !== PLAN_TARGET_TOTAL) {
    summary.failedAt = `inventory_drift: actual=${report.actual_stranded_total} expected=${PLAN_TARGET_TOTAL}`;
    return summary;
  }
  if (report.drift_detected) {
    summary.failedAt = `inventory_drift: ${report.drift_notes.join('; ')}`;
    return summary;
  }
  // Unclassified guard: refuse to mutate if any row is unclassified.
  if (report.counts.unclassified > 0) {
    summary.failedAt = `unclassified_rows_present: count=${report.counts.unclassified}`;
    return summary;
  }

  console.error('');
  console.error('='.repeat(72));
  console.error('EXECUTING PRODUCTION MUTATION — UTV2-539 / DEBT-002');
  console.error('='.repeat(72));
  console.error(`UTV2_539_PM_APPROVED=${process.env['UTV2_539_PM_APPROVED'] ?? '<unset>'}`);
  console.error(`UTV2_539_EXECUTE_CONFIRMED=${process.env['UTV2_539_EXECUTE_CONFIRMED'] ?? '<unset>'}`);
  console.error(`UTV2_539_DRY_RUN_ONLY=${process.env['UTV2_539_DRY_RUN_ONLY'] ?? '<unset>'}`);
  console.error(`fixtures=${report.counts.fixture}  productionBackfill=${report.counts.productionBackfill}  unclassified=${report.counts.unclassified}`);
  console.error('-'.repeat(72));

  const fixtureRows = report.rows.filter((r) => r.classification === 'fixture');
  const backfillRows = report.rows.filter((r) => r.classification === 'production-backfill');

  // ---- Phase 1: fixture DELETE loop ----------------------------------------
  for (const row of fixtureRows) {
    // (a) Delete the suppression audit_log rows that the proof-script writes
    // produced. These are tied to entity_type='pick_promotion_history' /
    // action='promotion.suppressed' / entity_ref=<pick id>.
    const auditDel = await deleteRows('audit_log', {
      entity_ref: `eq.${row.pick_id}`,
      entity_type: 'eq.pick_promotion_history',
      action: 'eq.promotion.suppressed',
    });
    if (!auditDel.ok) {
      summary.failedAt = `fixture_audit_delete: pick_id=${row.pick_id}: ${auditDel.error}`;
      summary.perRowResults.push({
        pick_id: row.pick_id,
        classification: 'fixture',
        ok: false,
        detail: `audit_delete_failed: ${auditDel.error}`,
      });
      console.error(`  FAIL fixture ${row.pick_id} (audit_log delete): ${auditDel.error}`);
      return summary;
    }

    // (b) Delete the prior pick_lifecycle row (validated state) for this pick.
    const lcDel = await deleteRows('pick_lifecycle', {
      pick_id: `eq.${row.pick_id}`,
    });
    if (!lcDel.ok) {
      summary.failedAt = `fixture_lifecycle_delete: pick_id=${row.pick_id}: ${lcDel.error}`;
      summary.perRowResults.push({
        pick_id: row.pick_id,
        classification: 'fixture',
        ok: false,
        detail: `lifecycle_delete_failed: ${lcDel.error}`,
      });
      console.error(`  FAIL fixture ${row.pick_id} (pick_lifecycle delete): ${lcDel.error}`);
      return summary;
    }

    // (c) Delete the picks row itself, status filter as drift guard.
    const pickDel = await deleteRows<PickRow>('picks', {
      id: `eq.${row.pick_id}`,
      status: 'eq.awaiting_approval',
    });
    if (!pickDel.ok) {
      summary.failedAt = `fixture_pick_delete: pick_id=${row.pick_id}: ${pickDel.error}`;
      summary.perRowResults.push({
        pick_id: row.pick_id,
        classification: 'fixture',
        ok: false,
        detail: `pick_delete_failed: ${pickDel.error}`,
      });
      console.error(`  FAIL fixture ${row.pick_id} (picks delete): ${pickDel.error}`);
      return summary;
    }

    const matched = Array.isArray(pickDel.body) ? pickDel.body.length : 0;
    if (matched === 0) {
      // Drift detected: pick was moved out of awaiting_approval since the
      // dry-run snapshot. Fail closed.
      summary.failedAt = `fixture_drift: pick_id=${row.pick_id} no longer status=awaiting_approval`;
      summary.perRowResults.push({
        pick_id: row.pick_id,
        classification: 'fixture',
        ok: false,
        detail: 'drift: zero rows matched picks DELETE with status=awaiting_approval',
      });
      console.error(`  FAIL fixture ${row.pick_id} (drift): zero-row picks DELETE`);
      return summary;
    }

    summary.fixturesDeleted += 1;
    summary.perRowResults.push({
      pick_id: row.pick_id,
      classification: 'fixture',
      ok: true,
      detail: `audit_log+pick_lifecycle+picks deleted (matched=${matched})`,
    });
    console.error(`  OK   fixture ${row.pick_id} deleted`);
  }

  // ---- Intermediate checkpoint --------------------------------------------
  // Re-query the stranded set and verify every backfill target is still
  // stranded before calling any RPC. This catches drift introduced between
  // the fixture phase and the backfill phase.
  const checkpoint = await buildDryRunReport(true, null);
  for (const target of backfillRows) {
    const stillStranded = checkpoint.rows.find(
      (r) => r.pick_id === target.pick_id && r.classification === 'production-backfill',
    );
    if (!stillStranded) {
      summary.failedAt = `checkpoint_drift: pick_id=${target.pick_id} no longer stranded as production-backfill`;
      console.error(`  FAIL checkpoint: ${target.pick_id} drifted between phases`);
      return summary;
    }
  }
  console.error(`  OK   checkpoint: all ${backfillRows.length} backfill targets still stranded`);

  // ---- Phase 2: production BACKFILL loop ----------------------------------
  for (const row of backfillRows) {
    const rpcResp = await callRpc<{ pickId: string; lifecycleEventId: string; backfilledAt: string }>(
      'backfill_pick_awaiting_approval',
      { p_pick_id: row.pick_id, p_linear_issue: 'UTV2-539' },
    );
    if (!rpcResp.ok) {
      summary.failedAt = `backfill_rpc: pick_id=${row.pick_id}: ${rpcResp.error}`;
      summary.perRowResults.push({
        pick_id: row.pick_id,
        classification: 'production-backfill',
        ok: false,
        detail: `rpc_failed: ${rpcResp.error}`,
      });
      console.error(`  FAIL backfill ${row.pick_id} (rpc): ${rpcResp.error}`);
      return summary;
    }

    const lifecycleEventId = rpcResp.body?.lifecycleEventId ?? null;
    summary.backfillsPersisted += 1;
    summary.perRowResults.push({
      pick_id: row.pick_id,
      classification: 'production-backfill',
      ok: true,
      detail: `rpc ok lifecycleEventId=${lifecycleEventId ?? '?'}`,
      lifecycle_event_id: lifecycleEventId,
    });
    console.error(`  OK   backfill ${row.pick_id} -> lifecycle ${lifecycleEventId ?? '?'}`);
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const wantExecute = argv.includes('--execute');

  // Env gates — evaluated BEFORE any work so misconfiguration is visible
  // and blocks execution before any live-DB query is issued.
  const pmApproved = process.env['UTV2_539_PM_APPROVED'] === '1';
  const execConfirmed = process.env['UTV2_539_EXECUTE_CONFIRMED'] === 'yes';
  const dryRunOnly = process.env['UTV2_539_DRY_RUN_ONLY'] === '1';

  let executeBlockedReason: string | null = null;
  let executeRefused = false;
  if (wantExecute) {
    if (dryRunOnly) {
      // Soft downgrade: --execute is honored as a dry-run.
      executeBlockedReason = 'UTV2_539_DRY_RUN_ONLY=1 — downgrading --execute to dry-run';
    } else if (!pmApproved) {
      executeBlockedReason = 'UTV2_539_PM_APPROVED=1 required';
      executeRefused = true;
    } else if (!execConfirmed) {
      executeBlockedReason = 'UTV2_539_EXECUTE_CONFIRMED=yes required';
      executeRefused = true;
    }
  }

  // Hard refusal — emit a REFUSING message and exit 2 BEFORE any live-DB
  // query is performed. This is the env-gate guard.
  if (executeRefused) {
    console.error('');
    console.error('REFUSING to execute UTV2-539 cleanup: missing required env gate.');
    console.error(`Reason: ${executeBlockedReason}`);
    console.error('Required env gates for --execute:');
    console.error('  UTV2_539_PM_APPROVED=1');
    console.error('  UTV2_539_EXECUTE_CONFIRMED=yes');
    console.error('Set UTV2_539_DRY_RUN_ONLY=1 to force a dry-run downgrade instead.');
    console.error('');
    process.exit(2);
  }

  // Build the dry-run report (read-only). This re-queries the live DB and
  // re-classifies every stranded row from scratch; the execute path consumes
  // the same report, so dry-run and execute always agree on the row set.
  const report = await buildDryRunReport(wantExecute, executeBlockedReason);

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  // If execute was requested AND all gates pass AND not downgraded — run the
  // production mutation pass.
  if (wantExecute && executeBlockedReason === null) {
    const summary = await runExecute(report);
    console.log('');
    console.log('UTV2-539 EXECUTE SUMMARY');
    console.log(JSON.stringify(summary, null, 2));
    emitVerifyQueries();
    if (summary.failedAt !== null) {
      process.exitCode = 1;
    }
    return;
  }

  // Otherwise exit cleanly from the dry-run.
  // Note: unclassified rows do not fail the dry-run exit code — they are
  // surfaced in the report and must be resolved before exec is run.
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
