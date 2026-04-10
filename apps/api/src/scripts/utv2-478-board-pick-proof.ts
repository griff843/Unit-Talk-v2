/**
 * UTV2-478 — Board-Pick Write Path Proof Script (Phase 5)
 *
 * Live-DB proof of all T1 conditions for the governed board-pick write path
 * introduced in UTV2-476/477 (BoardPickWriter + CC review surface).
 *
 * Run: npx tsx apps/api/src/scripts/utv2-478-board-pick-proof.ts
 *
 * Exit 0 = all 7 assertions PASS
 * Exit 1 = one or more assertions FAIL
 */

import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const env = loadEnvironment();
const supabaseUrl = env.SUPABASE_URL!;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
  const { data, error, count } = await supabase
    .from('picks')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'board-construction');

  if (error) {
    return fail('A1: picks(source=board-construction) exists', { error: error.message });
  }

  const rowCount = count ?? 0;
  const evidence = { rowCount };

  if (rowCount === 0) {
    return fail('A1: picks(source=board-construction) exists', evidence);
  }
  return pass('A1: picks(source=board-construction) exists', evidence);
}

/**
 * A2: pick_candidates — all rows with pick_id IS NOT NULL have shadow_mode = false (0 violations)
 */
async function assertA2(): Promise<AssertionResult> {
  const { data, error, count } = await supabase
    .from('pick_candidates')
    .select('id', { count: 'exact', head: true })
    .not('pick_id', 'is', null)
    .eq('shadow_mode', true);

  if (error) {
    return fail('A2: linked candidates have shadow_mode=false (0 violations)', { error: error.message });
  }

  const violations = count ?? 0;
  const evidence = { violations };

  if (violations > 0) {
    return fail('A2: linked candidates have shadow_mode=false (0 violations)', evidence);
  }
  return pass('A2: linked candidates have shadow_mode=false (0 violations)', evidence);
}

/**
 * A3: pick_candidates — all rows with pick_id IS NULL have shadow_mode = true (0 violations)
 */
async function assertA3(): Promise<AssertionResult> {
  const { data, error, count } = await supabase
    .from('pick_candidates')
    .select('id', { count: 'exact', head: true })
    .is('pick_id', null)
    .eq('shadow_mode', false);

  if (error) {
    return fail('A3: unlinked candidates have shadow_mode=true (0 violations)', { error: error.message });
  }

  const violations = count ?? 0;
  const evidence = { violations };

  if (violations > 0) {
    return fail('A3: unlinked candidates have shadow_mode=true (0 violations)', evidence);
  }
  return pass('A3: unlinked candidates have shadow_mode=true (0 violations)', evidence);
}

/**
 * A4: pick_candidates — zero rows with pick_id IS NOT NULL AND shadow_mode = true (Phase 5 boundary)
 *
 * This is the primary Phase 5 invariant: once a candidate is linked to a pick,
 * shadow_mode must be false. Any row violating this means the governed write path
 * did not correctly clear shadow_mode after linking.
 */
async function assertA4(): Promise<AssertionResult> {
  const { data, error, count } = await supabase
    .from('pick_candidates')
    .select('id', { count: 'exact', head: true })
    .not('pick_id', 'is', null)
    .eq('shadow_mode', true);

  if (error) {
    return fail('A4: Phase 5 boundary — no linked candidate with shadow_mode=true', { error: error.message });
  }

  const violations = count ?? 0;
  const evidence = { violations };

  if (violations > 0) {
    return fail('A4: Phase 5 boundary — no linked candidate with shadow_mode=true', evidence);
  }
  return pass('A4: Phase 5 boundary — no linked candidate with shadow_mode=true', evidence);
}

/**
 * A5: audit_log — at least 1 row with action = 'board.pick_write.completed'
 *     AND entity_type = 'syndicate_board'
 */
async function assertA5(): Promise<AssertionResult> {
  const { data, error, count } = await supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'board.pick_write.completed')
    .eq('entity_type', 'syndicate_board');

  if (error) {
    return fail(
      "A5: audit_log has board.pick_write.completed for entity_type=syndicate_board",
      { error: error.message },
    );
  }

  const rowCount = count ?? 0;
  const evidence = { rowCount };

  if (rowCount === 0) {
    return fail(
      "A5: audit_log has board.pick_write.completed for entity_type=syndicate_board",
      evidence,
    );
  }
  return pass(
    "A5: audit_log has board.pick_write.completed for entity_type=syndicate_board",
    evidence,
  );
}

/**
 * A6: Lifecycle chain — each board-construction pick has at least 1 row in pick_lifecycle
 */
async function assertA6(): Promise<AssertionResult> {
  // Fetch all board-construction pick IDs (limit 500 — sanity ceiling)
  const { data: picks, error: picksError } = await supabase
    .from('picks')
    .select('id')
    .eq('source', 'board-construction')
    .limit(500);

  if (picksError) {
    return fail('A6: board-construction picks each have pick_lifecycle row', {
      error: picksError.message,
    });
  }

  if (!picks || picks.length === 0) {
    // No board-construction picks exist at all — A1 would already have caught this,
    // but we mark as FAIL here to avoid a vacuous pass.
    return fail('A6: board-construction picks each have pick_lifecycle row', {
      boardConstructionPickCount: 0,
      note: 'no board-construction picks found',
    });
  }

  const pickIds = picks.map((p: { id: string }) => p.id);

  // Count distinct pick_ids in pick_lifecycle that are in our set
  const { data: lifecycleRows, error: lcError } = await supabase
    .from('pick_lifecycle')
    .select('pick_id')
    .in('pick_id', pickIds);

  if (lcError) {
    return fail('A6: board-construction picks each have pick_lifecycle row', {
      error: lcError.message,
    });
  }

  const coveredPickIds = new Set((lifecycleRows ?? []).map((r: { pick_id: string }) => r.pick_id));
  const missing = pickIds.filter((id: string) => !coveredPickIds.has(id));

  const evidence = {
    totalBoardPicks: pickIds.length,
    withLifecycleRow: coveredPickIds.size,
    missingLifecycleCount: missing.length,
    sampleMissing: missing.slice(0, 5),
  };

  if (missing.length > 0) {
    return fail('A6: board-construction picks each have pick_lifecycle row', evidence);
  }
  return pass('A6: board-construction picks each have pick_lifecycle row', evidence);
}

/**
 * A7: Idempotency sanity — no two board-construction picks share the same
 *     (market, selection, odds) tuple within the same metadata->>'boardRunId'
 */
async function assertA7(): Promise<AssertionResult> {
  // Fetch all board-construction picks with the relevant fields
  const { data: picks, error } = await supabase
    .from('picks')
    .select('id, market, selection, odds, metadata')
    .eq('source', 'board-construction')
    .limit(500);

  if (error) {
    return fail(
      "A7: idempotency — no duplicate (market, selection, odds) per boardRunId",
      { error: error.message },
    );
  }

  if (!picks || picks.length === 0) {
    return fail(
      "A7: idempotency — no duplicate (market, selection, odds) per boardRunId",
      { boardConstructionPickCount: 0, note: 'no board-construction picks found' },
    );
  }

  // Group by boardRunId, then check for duplicate (market, selection, odds) tuples
  const byRun = new Map<string, Array<{ id: string; market: string; selection: string; odds: number | null }>>();

  for (const pick of picks as Array<{
    id: string;
    market: string | null;
    selection: string | null;
    odds: number | null;
    metadata: Record<string, unknown> | null;
  }>) {
    const boardRunId = (pick.metadata?.boardRunId as string | undefined) ?? '__unknown__';
    if (!byRun.has(boardRunId)) byRun.set(boardRunId, []);
    byRun.get(boardRunId)!.push({
      id: pick.id,
      market: pick.market ?? '',
      selection: pick.selection ?? '',
      odds: pick.odds,
    });
  }

  const duplicateViolations: Array<{
    boardRunId: string;
    tupleKey: string;
    duplicatePickIds: string[];
  }> = [];

  for (const [boardRunId, rows] of byRun.entries()) {
    const seen = new Map<string, string>();
    for (const row of rows) {
      const key = `${row.market}|${row.selection}|${row.odds}`;
      if (seen.has(key)) {
        duplicateViolations.push({
          boardRunId,
          tupleKey: key,
          duplicatePickIds: [seen.get(key)!, row.id],
        });
      } else {
        seen.set(key, row.id);
      }
    }
  }

  const evidence = {
    boardRunCount: byRun.size,
    totalBoardPicks: picks.length,
    duplicateViolations: duplicateViolations.length,
    sampleViolations: duplicateViolations.slice(0, 3),
  };

  if (duplicateViolations.length > 0) {
    return fail(
      "A7: idempotency — no duplicate (market, selection, odds) per boardRunId",
      evidence,
    );
  }
  return pass(
    "A7: idempotency — no duplicate (market, selection, odds) per boardRunId",
    evidence,
  );
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
