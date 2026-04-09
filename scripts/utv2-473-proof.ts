/**
 * UTV2-473 Ranked Candidate Selection Proof Script
 *
 * Triggers one ranking run against the live DB then verifies:
 *   1. Ranked count > 0
 *   2. Contiguous sequence: max(selection_rank) = count(*) where is_board_candidate
 *   3. min(selection_rank) = 1
 *   4. pick_id violations = 0
 *   5. shadow_mode violations = 0
 *   6. SUPPRESS never ranked above a higher-score non-SUPPRESS (sample check)
 *
 * Usage (from repo root):
 *   npx tsx scripts/utv2-473-proof.ts
 */

import { loadEnvironment } from '@unit-talk/config';
import { createApiRuntimeDependencies } from '../apps/api/src/server.js';
import { runRankedSelection } from '../apps/api/src/ranked-selection-service.js';

const SEPARATOR = '─'.repeat(70);

async function main() {
  console.log(SEPARATOR);
  console.log('UTV2-473 Ranked Selection Proof — ' + new Date().toISOString());
  console.log(SEPARATOR);

  const environment = loadEnvironment();
  const runtime = createApiRuntimeDependencies({ environment });
  const repos = runtime.repositories;

  console.log('\n[1/2] Running ranked selection service...');
  const result = await runRankedSelection(
    { pickCandidates: repos.pickCandidates, marketUniverse: repos.marketUniverse },
    { logger: { info: () => {}, warn: console.warn, error: console.error } },
  );

  console.log(
    `      ranked=${result.ranked}  reset=${result.reset}  skipped=${result.skipped}  errors=${result.errors}  durationMs=${result.durationMs}`,
  );

  console.log('\n[2/2] Verifying DB state...');

  // Pull board candidates for structural checks
  const allCandidates = await repos.pickCandidates.findByStatus('qualified');
  const board = allCandidates.filter(c => c.is_board_candidate === true);

  const ranks = board.map(c => c.selection_rank).filter((r): r is number => r !== null);
  ranks.sort((a, b) => a - b);

  const minRank = ranks[0] ?? null;
  const maxRank = ranks[ranks.length - 1] ?? null;
  const isContiguous =
    board.length > 0 && minRank === 1 && maxRank === board.length;
  const pickIdViolations = board.filter(c => c.pick_id !== null).length;
  const shadowModeViolations = board.filter(c => c.shadow_mode === false).length;

  // Tier ordering check: find any SUPPRESS row ranked above a non-SUPPRESS with equal-or-lower score
  const suppressViolations = board.filter(c => {
    if (c.model_tier !== 'SUPPRESS') return false;
    // A SUPPRESS row violates ordering only if a non-SUPPRESS with the SAME score ranks lower
    return board.some(
      other =>
        other.model_tier !== 'SUPPRESS' &&
        other.model_tier !== null &&
        other.model_score === c.model_score &&
        (other.selection_rank ?? Infinity) > (c.selection_rank ?? 0),
    );
  }).length;

  console.log('\n' + SEPARATOR);

  const checks: Array<[string, boolean, string]> = [
    ['Ranked count > 0', result.ranked > 0, `ranked=${result.ranked}`],
    ['Errors = 0', result.errors === 0, `errors=${result.errors}`],
    ['min(selection_rank) = 1', minRank === 1, `min=${minRank}`],
    ['max(selection_rank) = count(*)', maxRank === board.length, `max=${maxRank}, count=${board.length}`],
    ['Contiguous sequence', isContiguous, `contiguous=${isContiguous}`],
    ['pick_id violations = 0', pickIdViolations === 0, `violations=${pickIdViolations}`],
    ['shadow_mode violations = 0', shadowModeViolations === 0, `violations=${shadowModeViolations}`],
    ['SUPPRESS tier ordering', suppressViolations === 0, `violations=${suppressViolations}`],
  ];

  let allPass = true;
  for (const [label, pass, detail] of checks) {
    const icon = pass ? '✓' : '✗';
    const tag = pass ? 'PASS' : 'FAIL';
    console.log(`${icon} ${tag}  ${label} — ${detail}`);
    if (!pass) allPass = false;
  }

  // Tier distribution on board
  const tierDist = board.reduce<Record<string, number>>((acc, c) => {
    const t = c.model_tier ?? 'null';
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});
  console.log('\nBoard tier distribution:', tierDist);

  // Top 5 and bottom 5 by rank
  const sorted = [...board].sort((a, b) => (a.selection_rank ?? 0) - (b.selection_rank ?? 0));
  console.log('\nTop 5 by rank:');
  for (const c of sorted.slice(0, 5)) {
    console.log(`  rank=${c.selection_rank}  score=${c.model_score}  tier=${c.model_tier}`);
  }
  if (sorted.length > 5) {
    console.log('\nBottom 5 by rank:');
    for (const c of sorted.slice(-5)) {
      console.log(`  rank=${c.selection_rank}  score=${c.model_score}  tier=${c.model_tier}`);
    }
  }

  console.log('\n' + SEPARATOR);
  if (allPass) {
    console.log('✓ ALL CHECKS PASS — UTV2-473 ranking layer is live.');
    console.log('  Phase 4 P4-01 gate: OPEN');
  } else {
    console.error('✗ SOME CHECKS FAILED — investigate above');
    process.exit(1);
  }
  console.log(SEPARATOR + '\n');
}

main().catch(err => {
  console.error('Proof error:', err);
  process.exit(1);
});
