/**
 * UTV2-478 — Board-Pick Write Path Proof Script (Phase 5)
 *
 * Live-DB proof of all T1 conditions for the governed board-pick write path
 * introduced in UTV2-476/477 (BoardPickWriter + CC review surface).
 *
 * Uses direct Supabase REST API via fetch (same pattern as t1-proof-atomicity.test.ts).
 * No @supabase/supabase-js dependency needed.
 *
 * Run: npx tsx apps/api/src/scripts/utv2-478-board-pick-proof.ts
 *
 * Exit 0 = all 7 assertions PASS
 * Exit 1 = one or more assertions FAIL
 */

import { loadEnvironment } from '@unit-talk/config';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const env = loadEnvironment();
const SUPABASE_URL = env.SUPABASE_URL!;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;

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
// REST helpers
// ---------------------------------------------------------------------------

async function queryCount(
  table: string,
  filters: Record<string, string>,
): Promise<{ count: number; error?: string }> {
  const qs = new URLSearchParams({ select: 'id', ...filters }).toString();
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'HEAD',
    headers: { ...BASE_HEADERS, Prefer: 'count=exact' },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return { count: 0, error: `HTTP ${resp.status}: ${body}` };
  }
  const raw = resp.headers.get('content-range') ?? '';
  const total = parseInt(raw.split('/')[1] ?? '0', 10);
  return { count: isNaN(total) ? 0 : total };
}

async function queryRows<T>(
  table: string,
  select: string,
  filters: Record<string, string>,
  limit = 500,
): Promise<{ rows: T[]; error?: string }> {
  const qs = new URLSearchParams({ select, limit: String(limit), ...filters }).toString();
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: { ...BASE_HEADERS, Prefer: 'return=representation' },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return { rows: [], error: `HTTP ${resp.status}: ${body}` };
  }
  const rows = (await resp.json()) as T[];
  return { rows };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssertionResult {
  assertion: string;
  result: 'PASS' | 'FAIL';
  evidence: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function pass(assertion: string, evidence: Record<string, unknown>): AssertionResult {
  return { assertion, result: 'PASS', evidence };
}

function fail(assertion: string, evidence: Record<string, unknown>): AssertionResult {
  return { assertion, result: 'FAIL', evidence };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * A1: picks — at least 1 row with source = 'board-construction' exists
 */
async function assertA1(): Promise<AssertionResult> {
  const { count, error } = await queryCount('picks', { source: 'eq.board-construction' });
  if (error) return fail('A1: picks(source=board-construction) exists', { error });
  if (count === 0) return fail('A1: picks(source=board-construction) exists', { rowCount: count });
  return pass('A1: picks(source=board-construction) exists', { rowCount: count });
}

/**
 * A2: pick_candidates — all rows with pick_id IS NOT NULL have shadow_mode = false (0 violations)
 */
async function assertA2(): Promise<AssertionResult> {
  const { count, error } = await queryCount('pick_candidates', {
    pick_id: 'not.is.null',
    shadow_mode: 'eq.true',
  });
  if (error) return fail('A2: linked candidates have shadow_mode=false (0 violations)', { error });
  if (count > 0) return fail('A2: linked candidates have shadow_mode=false (0 violations)', { violations: count });
  return pass('A2: linked candidates have shadow_mode=false (0 violations)', { violations: 0 });
}

/**
 * A3: pick_candidates — all rows with pick_id IS NULL have shadow_mode = true (0 violations)
 */
async function assertA3(): Promise<AssertionResult> {
  const { count, error } = await queryCount('pick_candidates', {
    pick_id: 'is.null',
    shadow_mode: 'eq.false',
  });
  if (error) return fail('A3: unlinked candidates have shadow_mode=true (0 violations)', { error });
  if (count > 0) return fail('A3: unlinked candidates have shadow_mode=true (0 violations)', { violations: count });
  return pass('A3: unlinked candidates have shadow_mode=true (0 violations)', { violations: 0 });
}

/**
 * A4: Phase 5 boundary — zero rows with pick_id IS NOT NULL AND shadow_mode = true.
 * Primary Phase 5 invariant: once a candidate is linked, shadow_mode must be false.
 */
async function assertA4(): Promise<AssertionResult> {
  const { count, error } = await queryCount('pick_candidates', {
    pick_id: 'not.is.null',
    shadow_mode: 'eq.true',
  });
  if (error) return fail('A4: Phase 5 boundary — no linked candidate with shadow_mode=true', { error });
  if (count > 0) return fail('A4: Phase 5 boundary — no linked candidate with shadow_mode=true', { violations: count });
  return pass('A4: Phase 5 boundary — no linked candidate with shadow_mode=true', { violations: 0 });
}

/**
 * A5: audit_log — at least 1 row with action = 'board.pick_write.completed' AND entity_type = 'syndicate_board'
 */
async function assertA5(): Promise<AssertionResult> {
  const { count, error } = await queryCount('audit_log', {
    action: 'eq.board.pick_write.completed',
    entity_type: 'eq.syndicate_board',
  });
  if (error) return fail('A5: audit_log has board.pick_write.completed for entity_type=syndicate_board', { error });
  if (count === 0) return fail('A5: audit_log has board.pick_write.completed for entity_type=syndicate_board', { rowCount: count });
  return pass('A5: audit_log has board.pick_write.completed for entity_type=syndicate_board', { rowCount: count });
}

/**
 * A6: Lifecycle chain — each board-construction pick has at least 1 row in pick_lifecycle
 */
async function assertA6(): Promise<AssertionResult> {
  const { rows: picks, error: picksError } = await queryRows<{ id: string }>(
    'picks', 'id', { source: 'eq.board-construction' }, 500,
  );
  if (picksError) return fail('A6: board-construction picks each have pick_lifecycle row', { error: picksError });
  if (picks.length === 0) {
    return fail('A6: board-construction picks each have pick_lifecycle row', {
      boardConstructionPickCount: 0,
      note: 'no board-construction picks found',
    });
  }

  const pickIds = picks.map((p) => p.id);
  const { rows: lcRows, error: lcError } = await queryRows<{ pick_id: string }>(
    'pick_lifecycle', 'pick_id', { pick_id: `in.(${pickIds.join(',')})` }, 500,
  );
  if (lcError) return fail('A6: board-construction picks each have pick_lifecycle row', { error: lcError });

  const covered = new Set(lcRows.map((r) => r.pick_id));
  const missing = pickIds.filter((id) => !covered.has(id));

  const evidence = {
    totalBoardPicks: pickIds.length,
    withLifecycleRow: covered.size,
    missingLifecycleCount: missing.length,
    sampleMissing: missing.slice(0, 5),
  };
  if (missing.length > 0) return fail('A6: board-construction picks each have pick_lifecycle row', evidence);
  return pass('A6: board-construction picks each have pick_lifecycle row', evidence);
}

/**
 * A7: Idempotency sanity — no two board-construction picks share the same
 *     (market, selection, odds) tuple within the same metadata->>'boardRunId'
 */
async function assertA7(): Promise<AssertionResult> {
  const { rows: picks, error } = await queryRows<{
    id: string;
    market: string | null;
    selection: string | null;
    odds: number | null;
    metadata: Record<string, unknown> | null;
  }>('picks', 'id,market,selection,odds,metadata', { source: 'eq.board-construction' }, 500);

  if (error) return fail('A7: idempotency — no duplicate (market, selection, odds) per boardRunId', { error });
  if (picks.length === 0) {
    return fail('A7: idempotency — no duplicate (market, selection, odds) per boardRunId', {
      boardConstructionPickCount: 0,
      note: 'no board-construction picks found',
    });
  }

  const byRun = new Map<string, Array<{ id: string; key: string }>>();
  for (const pick of picks) {
    const boardRunId = (pick.metadata?.boardRunId as string | undefined) ?? '__unknown__';
    if (!byRun.has(boardRunId)) byRun.set(boardRunId, []);
    byRun.get(boardRunId)!.push({
      id: pick.id,
      key: `${pick.market ?? ''}|${pick.selection ?? ''}|${pick.odds}`,
    });
  }

  const violations: Array<{ boardRunId: string; tupleKey: string; ids: string[] }> = [];
  for (const [boardRunId, rows] of byRun.entries()) {
    const seen = new Map<string, string>();
    for (const row of rows) {
      if (seen.has(row.key)) {
        violations.push({ boardRunId, tupleKey: row.key, ids: [seen.get(row.key)!, row.id] });
      } else {
        seen.set(row.key, row.id);
      }
    }
  }

  const evidence = {
    boardRunCount: byRun.size,
    totalBoardPicks: picks.length,
    duplicateViolations: violations.length,
    sampleViolations: violations.slice(0, 3),
  };
  if (violations.length > 0) return fail('A7: idempotency — no duplicate (market, selection, odds) per boardRunId', evidence);
  return pass('A7: idempotency — no duplicate (market, selection, odds) per boardRunId', evidence);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== UTV2-478: Board-Pick Write Path Proof (Phase 5) ===\n');

  const results: AssertionResult[] = await Promise.all([
    assertA1(),
    assertA2(),
    assertA3(),
    assertA4(),
    assertA5(),
    assertA6(),
    assertA7(),
  ]);

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    console.log(JSON.stringify(r));
    if (r.result === 'PASS') {
      passed++;
    } else {
      failed++;
    }
  }

  console.log('');

  if (failed === 0) {
    console.log(`RESULT: ${passed}/7 PASS`);
    process.exit(0);
  } else {
    console.log(`RESULT: FAIL (${failed} failure${failed === 1 ? '' : 's'})`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Proof script fatal error:', err);
  process.exit(1);
});
