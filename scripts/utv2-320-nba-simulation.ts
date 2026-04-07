/**
 * UTV2-320 NBA Baseline Simulation - R1-R5 Driver
 *
 * Runs a controlled 15-pick synthetic NBA proof set through the R1-R5
 * verification & simulation engine. Produces a complete strategy proof
 * bundle for PM review without requiring live data.
 *
 * This replicates what syndicates do: build and test the model on a
 * controlled dataset before committing to live operations.
 *
 * Layers executed:
 *   R1 - VirtualEventClock + AdapterManifest (simulation mode)
 *   R2 - ReplayOrchestrator (15-pick lifecycle: SUBMITTED -> GRADED -> POSTED -> SETTLED)
 *   R4 - FaultOrchestrator (F1: idempotency guard, all assertions must pass)
 *   R5 - StrategyEvaluationEngine (flat-unit + kelly-025) + StrategyComparator
 *
 * Proof set: 15 NBA player-prop picks across 7 game days (Jan 6-18 2026)
 *   Markets: turnovers, points, assists, rebounds, blocks
 *   Results: 12W / 3L = 80% hit rate (synthetic, deterministic)
 *
 * Output:
 *   out/strategy-runs/flat-unit/<date>/   - R5 flat-unit proof bundle
 *   out/strategy-runs/kelly-025/<date>/   - R5 kelly-025 proof bundle
 *   out/strategy-runs/cmp-flat-vs-kelly/   - R5 comparison report
 *   out/utv2-320-simulation-summary.json  - top-level summary
 *
 * Run: npx tsx scripts/utv2-320-nba-simulation.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VirtualEventClock } from '../packages/verification/src/engine/clock.js';
import { JournalEventStore } from '../packages/verification/src/engine/event-store.js';
import { ReplayOrchestrator } from '../packages/verification/src/engine/replay-orchestrator.js';
import { ReplayProofWriter } from '../packages/verification/src/engine/replay-proof-writer.js';
import { FaultOrchestrator } from '../packages/verification/src/engine/fault/fault-orchestrator.js';
import { FaultProofWriter } from '../packages/verification/src/engine/fault/fault-proof-writer.js';
import { SCENARIO_CATALOG } from '../packages/verification/src/engine/fault/scenarios/index.js';
import { createReplaySimulationManifest } from '../packages/verification/src/engine/simulation-adapters.js';
import {
  StrategyEvaluationEngine,
  PREDEFINED_STRATEGIES,
} from '../packages/domain/src/strategy/strategy-evaluation-engine.js';
import { StrategyComparator } from '../packages/domain/src/strategy/strategy-comparator.js';
import { StrategyProofWriter } from '../packages/verification/src/engine/strategy/strategy-proof-writer.js';

// ---------------------------------------------------------------------------
// SYNTHETIC NBA PROOF SET
// ---------------------------------------------------------------------------

interface ProofPick {
  id: string;
  gameTime: string;
  playerName: string;
  market: string;
  selection: string;
  line: number;
  odds: number;
  result: 'win' | 'loss' | 'push';
  tier: 'S' | 'A' | 'B' | 'C';
  confidence: number;
}

/**
 * 15 synthetic NBA player-prop picks spanning Jan 6-18 2026.
 * Results are deterministic: 12W / 3L = 80% hit rate.
 * Markets cover all 5 core all-game prop families (turnovers, points,
 * assists, rebounds, blocks) aliased in UTV2-394.
 */
const NBA_PROOF_SET: ProofPick[] = [
  // Jan 6 -- Cleveland / New York
  { id: 'pick-nba-001', gameTime: '2026-01-06T19:00:00Z', playerName: 'Darius Garland',        market: 'player_turnovers_ou', selection: 'Player Under 2.5', line: 2.5,  odds: -115, result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-nba-002', gameTime: '2026-01-06T19:10:00Z', playerName: 'Jalen Brunson',          market: 'player_assists_ou',   selection: 'Player Over 6.5',  line: 6.5,  odds: -139, result: 'win',  tier: 'A', confidence: 0.80 },
  // Jan 8 -- Boston / Golden State
  { id: 'pick-nba-003', gameTime: '2026-01-08T19:00:00Z', playerName: 'Jayson Tatum',           market: 'player_points_ou',    selection: 'Player Over 29.5', line: 29.5, odds: 105,  result: 'win',  tier: 'A', confidence: 0.72 },
  { id: 'pick-nba-004', gameTime: '2026-01-08T19:10:00Z', playerName: 'Stephen Curry',          market: 'player_points_ou',    selection: 'Player Over 25.5', line: 25.5, odds: -125, result: 'win',  tier: 'A', confidence: 0.78 },
  // Jan 10 -- LA / Denver
  { id: 'pick-nba-005', gameTime: '2026-01-10T19:00:00Z', playerName: 'LeBron James',           market: 'player_points_ou',    selection: 'Player Over 26.5', line: 26.5, odds: -110, result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-nba-006', gameTime: '2026-01-10T19:10:00Z', playerName: 'Anthony Davis',          market: 'player_rebounds_ou',  selection: 'Player Over 13.5', line: 13.5, odds: -115, result: 'win',  tier: 'A', confidence: 0.74 },
  // Jan 12 -- Denver / Milwaukee
  { id: 'pick-nba-007', gameTime: '2026-01-12T19:00:00Z', playerName: 'Nikola Jokic',           market: 'player_rebounds_ou',  selection: 'Player Over 12.5', line: 12.5, odds: -120, result: 'win',  tier: 'A', confidence: 0.79 },
  { id: 'pick-nba-008', gameTime: '2026-01-12T19:10:00Z', playerName: 'Giannis Antetokounmpo',  market: 'player_points_ou',    selection: 'Player Over 29.5', line: 29.5, odds: -130, result: 'loss', tier: 'A', confidence: 0.73 },
  // Jan 14 -- New York / Boston
  { id: 'pick-nba-009', gameTime: '2026-01-14T19:00:00Z', playerName: 'Jalen Brunson',          market: 'player_points_ou',    selection: 'Player Over 22.5', line: 22.5, odds: -120, result: 'win',  tier: 'A', confidence: 0.77 },
  { id: 'pick-nba-010', gameTime: '2026-01-14T19:10:00Z', playerName: 'Jayson Tatum',           market: 'player_rebounds_ou',  selection: 'Player Under 8.5', line: 8.5,  odds: -105, result: 'win',  tier: 'A', confidence: 0.71 },
  // Jan 16 -- Cleveland / Golden State
  { id: 'pick-nba-011', gameTime: '2026-01-16T19:00:00Z', playerName: 'Darius Garland',         market: 'player_turnovers_ou', selection: 'Player Under 2.5', line: 2.5,  odds: -110, result: 'loss', tier: 'A', confidence: 0.73 },
  { id: 'pick-nba-012', gameTime: '2026-01-16T19:10:00Z', playerName: 'Stephen Curry',          market: 'player_assists_ou',   selection: 'Player Over 5.5',  line: 5.5,  odds: 100,  result: 'win',  tier: 'A', confidence: 0.75 },
  // Jan 18 -- LA / Denver / Milwaukee
  { id: 'pick-nba-013', gameTime: '2026-01-18T19:00:00Z', playerName: 'LeBron James',           market: 'player_rebounds_ou',  selection: 'Player Over 7.5',  line: 7.5,  odds: -130, result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-nba-014', gameTime: '2026-01-18T19:10:00Z', playerName: 'Nikola Jokic',           market: 'player_assists_ou',   selection: 'Player Over 8.5',  line: 8.5,  odds: 105,  result: 'win',  tier: 'A', confidence: 0.80 },
  { id: 'pick-nba-015', gameTime: '2026-01-18T19:20:00Z', playerName: 'Anthony Davis',          market: 'player_blocks_ou',    selection: 'Player Over 1.5',  line: 1.5,  odds: 115,  result: 'loss', tier: 'A', confidence: 0.70 },
];

// ---------------------------------------------------------------------------
// EVENT STORE BUILDER
// ---------------------------------------------------------------------------

/**
 * Builds a JournalEventStore populated with 15 NBA pick lifecycles.
 *
 * Each pick generates 4 events:
 *   PICK_SUBMITTED -> PICK_GRADED -> PICK_POSTED -> PICK_SETTLED
 *
 * Events are sorted by timestamp (monotonically increasing) before
 * appending so VirtualEventClock never has to move backward.
 *
 * Settlement results are embedded in PICK_SETTLED payloads so that
 * ReplaySettlementAdapter can resolve them from the event store.
 */
function buildNbaEventStore(): JournalEventStore {
  const store = JournalEventStore.createInMemory();

  type RawEvent = {
    eventId: string;
    eventType: 'PICK_SUBMITTED' | 'PICK_GRADED' | 'PICK_POSTED' | 'PICK_SETTLED' | 'RECAP_TRIGGERED';
    pickId: string;
    timestamp: string;
    payload: Record<string, unknown>;
  };

  const rawEvents: RawEvent[] = [];

  for (const pick of NBA_PROOF_SET) {
    const baseMs = new Date(pick.gameTime).getTime();
    const t = (offsetMs: number): string => new Date(baseMs + offsetMs).toISOString();
    const settledAt = t(4 * 60 * 60 * 1000); // +4 hours (after game)

    rawEvents.push({
      eventId: `${pick.id}-e1`,
      eventType: 'PICK_SUBMITTED',
      pickId: pick.id,
      timestamp: t(0),
      payload: {
        pick: {
          id: pick.id,
          // Initialize directly in 'posted' state so settle() can do
          // posted -> settled (valid transition).  claimForPosting() in
          // PICK_POSTED will be a no-op (already posted, idempotent).
          status: 'posted',
          posted_to_discord: true,
          sport: 'NBA',
          player_name: pick.playerName,
          market: pick.market,
          selection: pick.selection,
          line: pick.line,
          odds: pick.odds,
          placed_at: t(0),
          created_at: t(0),
          meta: { tier: pick.tier, confidence: pick.confidence },
        },
      },
    });

    rawEvents.push({
      eventId: `${pick.id}-e2`,
      eventType: 'PICK_GRADED',
      pickId: pick.id,
      timestamp: t(60_000), // +1 min
      payload: {
        gradingData: {
          // No status transition here -- pick is already 'posted'
          promotion_status: 'qualified',
          promotion_queued_at: t(60_000),
          meta: { tier: pick.tier, confidence: pick.confidence, grade_score: 82 },
        },
      },
    });

    rawEvents.push({
      eventId: `${pick.id}-e3`,
      eventType: 'PICK_POSTED',
      pickId: pick.id,
      timestamp: t(120_000), // +2 min
      payload: { posting: { channel: 'discord-best-bets' } },
    });

    // Settlement result embedded for ReplaySettlementAdapter
    rawEvents.push({
      eventId: `${pick.id}-e4`,
      eventType: 'PICK_SETTLED',
      pickId: pick.id,
      timestamp: settledAt,
      payload: { result: pick.result, source: 'simulation' },
    });
  }

  // Sort ascending by timestamp so VirtualEventClock advances monotonically
  rawEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (const event of rawEvents) {
    store.appendEvent(event);
  }

  return store;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ID = `utv2-320-nba-sim-${new Date().toISOString().replace(/[:.]/g, '-')}`;

async function main(): Promise<void> {
  console.log('======================================================');
  console.log('  UTV2-320 NBA Baseline Simulation - R1-R5 Driver');
  console.log('======================================================');
  console.log(`  runId    : ${RUN_ID}`);
  console.log(`  picks    : ${NBA_PROOF_SET.length}`);
  console.log(`  dates    : 2026-01-06 to 2026-01-18`);
  console.log(`  hit rate : 12W / 3L = 80%`);
  console.log('');

  // -- R1: Clock + Adapters --------------------------------------------------
  console.log('[ R1 ] Initializing virtual clock and simulation adapters...');
  const store = buildNbaEventStore();
  const clock = new VirtualEventClock(new Date('2026-01-06T18:59:59Z'));
  const adapters = createReplaySimulationManifest(store);
  console.log(`       event store : ${store.size} events`);
  console.log('');

  // -- R2: Deterministic Replay ----------------------------------------------
  console.log('[ R2 ] Running ReplayOrchestrator...');
  const replayOrchestrator = new ReplayOrchestrator({
    runId: `${RUN_ID}-r2`,
    eventStore: store,
    clock,
    adapters,
  });

  const replayResult = await replayOrchestrator.run();
  console.log(`       events processed : ${replayResult.eventsProcessed}`);
  console.log(`       picks created    : ${replayResult.picksCreated}`);
  console.log(`       errors           : ${replayResult.errors.length}`);
  console.log(`       determinism hash : ${replayResult.determinismHash}`);

  if (replayResult.errors.length > 0) {
    console.warn('       R2 ERRORS:');
    for (const err of replayResult.errors) {
      console.warn(`         [${err.eventType}] pick=${err.pickId ?? 'n/a'} : ${err.error}`);
    }
  }

  const replayWriter = new ReplayProofWriter(REPO_ROOT);
  const r2BundlePath = replayWriter.write(replayResult, store.getAllEvents());
  console.log(`       proof bundle     : ${r2BundlePath}`);
  console.log('');

  // -- R4: Fault Injection (F1 - Idempotency) --------------------------------
  console.log('[ R4 ] Running FaultOrchestrator (F1: duplicate publish idempotency)...');
  const f1Setup = SCENARIO_CATALOG['F1']!();
  // F1 event store uses 2024-01-15 timestamps -- clock must start before that
  const faultClock = new VirtualEventClock(new Date('2024-01-15T11:59:59Z'));
  const faultOrchestrator = new FaultOrchestrator(f1Setup, faultClock, `${RUN_ID}-r4-f1`);
  const faultResult = await faultOrchestrator.run(f1Setup.assertors);

  const r4Passed = faultResult.assertions.filter(a => a.pass).length;
  const r4Failed = faultResult.assertions.filter(a => !a.pass).length;
  console.log(`       scenario         : ${faultResult.scenarioName}`);
  console.log(`       assertions       : ${r4Passed} passed / ${r4Failed} failed`);
  console.log(`       faults activated : ${faultResult.faultsActivated}`);
  console.log(`       overall pass     : ${faultResult.pass ? 'PASS' : 'FAIL'}`);

  if (!faultResult.pass) {
    for (const assertion of faultResult.assertions.filter(a => !a.pass)) {
      console.warn(`         FAIL [${assertion.assertionId}]: ${assertion.failureReason ?? 'no reason'}`);
    }
  }

  const faultWriter = new FaultProofWriter(REPO_ROOT);
  const r4BundlePath = faultWriter.write(faultResult, f1Setup.scenario.proofArtifactName);
  console.log(`       proof bundle     : ${r4BundlePath}`);
  console.log('');

  // -- R5: Strategy Evaluation -----------------------------------------------
  console.log('[ R5 ] Running StrategyEvaluationEngine (flat-unit + kelly-025)...');
  const engine = new StrategyEvaluationEngine();
  const runAt = new Date().toISOString();

  const flatConfig = PREDEFINED_STRATEGIES['flat-unit']!;
  const kellyConfig = PREDEFINED_STRATEGIES['kelly-025']!;

  const flatResult = engine.run(replayResult, flatConfig, runAt);
  const kellyResult = engine.run(replayResult, kellyConfig, runAt);

  console.log('');
  console.log('       flat-unit:');
  console.log(`         bets placed   : ${flatResult.betsPlaced}`);
  console.log(`         bets skipped  : ${flatResult.betsSkipped}`);
  console.log(`         hit rate      : ${(flatResult.hitRate * 100).toFixed(1)}%`);
  console.log(`         ROI           : ${(flatResult.roi * 100).toFixed(2)}%`);
  console.log(`         bankroll      : $${flatResult.initialBankroll.toFixed(0)} -> $${flatResult.finalBankroll.toFixed(2)}`);
  console.log(`         max drawdown  : ${(flatResult.maxDrawdown * 100).toFixed(2)}%`);
  if (flatResult.haltedAt) {
    console.warn(`         HALTED at ${flatResult.haltedAt}: ${flatResult.haltReason}`);
  }

  console.log('');
  console.log('       kelly-025:');
  console.log(`         bets placed   : ${kellyResult.betsPlaced}`);
  console.log(`         bets skipped  : ${kellyResult.betsSkipped}`);
  console.log(`         hit rate      : ${(kellyResult.hitRate * 100).toFixed(1)}%`);
  console.log(`         ROI           : ${(kellyResult.roi * 100).toFixed(2)}%`);
  console.log(`         bankroll      : $${kellyResult.initialBankroll.toFixed(0)} -> $${kellyResult.finalBankroll.toFixed(2)}`);
  console.log(`         max drawdown  : ${(kellyResult.maxDrawdown * 100).toFixed(2)}%`);
  if (kellyResult.haltedAt) {
    console.warn(`         HALTED at ${kellyResult.haltedAt}: ${kellyResult.haltReason}`);
  }

  const comparator = new StrategyComparator();
  const comparison = comparator.compare(flatResult, kellyResult, runAt);

  console.log('');
  console.log('       comparison (flat-unit vs kelly-025):');
  console.log(`         ROI winner        : ${comparison.winner.roi}`);
  console.log(`         drawdown winner   : ${comparison.winner.maxDrawdown}`);
  console.log(`         bankroll winner   : ${comparison.winner.bankrollGrowth}`);

  const strategyWriter = new StrategyProofWriter(REPO_ROOT);
  const r5FlatPath = strategyWriter.writeEvaluation(flatResult);
  const r5KellyPath = strategyWriter.writeEvaluation(kellyResult);
  const r5CmpPath = strategyWriter.writeComparison(comparison);
  console.log('');
  console.log(`       flat-unit bundle : ${r5FlatPath}`);
  console.log(`       kelly-025 bundle : ${r5KellyPath}`);
  console.log(`       comparison       : ${r5CmpPath}`);
  console.log('');

  // -- Summary ---------------------------------------------------------------
  const r2Pass = replayResult.errors.length === 0;
  const r4Pass = faultResult.pass;
  const r5Pass = flatResult.betsPlaced > 0 && kellyResult.betsPlaced > 0;
  const verdict = r2Pass && r4Pass && r5Pass ? 'PASS' : 'FAIL';

  const summary = {
    runId: RUN_ID,
    generatedAt: runAt,
    issue: 'UTV2-320',
    description: 'NBA Baseline Simulation - R1-R5 proof bundle',
    proofSet: {
      pickCount: NBA_PROOF_SET.length,
      dateRange: '2026-01-06 to 2026-01-18',
      markets: [...new Set(NBA_PROOF_SET.map(p => p.market))],
      players: [...new Set(NBA_PROOF_SET.map(p => p.playerName))],
      wins: NBA_PROOF_SET.filter(p => p.result === 'win').length,
      losses: NBA_PROOF_SET.filter(p => p.result === 'loss').length,
      hitRate: '80.0%',
    },
    r2: {
      pass: r2Pass,
      eventsProcessed: replayResult.eventsProcessed,
      picksCreated: replayResult.picksCreated,
      errors: replayResult.errors.length,
      determinismHash: replayResult.determinismHash,
      bundlePath: r2BundlePath,
    },
    r4: {
      pass: r4Pass,
      scenario: 'F1 - Duplicate publish idempotency',
      assertionsPassed: r4Passed,
      assertionsFailed: r4Failed,
      bundlePath: r4BundlePath,
    },
    r5: {
      pass: r5Pass,
      flatUnit: {
        betsPlaced: flatResult.betsPlaced,
        hitRate: flatResult.hitRate,
        roi: flatResult.roi,
        finalBankroll: flatResult.finalBankroll,
        maxDrawdown: flatResult.maxDrawdown,
        bundlePath: r5FlatPath,
      },
      kelly025: {
        betsPlaced: kellyResult.betsPlaced,
        hitRate: kellyResult.hitRate,
        roi: kellyResult.roi,
        finalBankroll: kellyResult.finalBankroll,
        maxDrawdown: kellyResult.maxDrawdown,
        bundlePath: r5KellyPath,
      },
      comparisonPath: r5CmpPath,
    },
    verdict,
    utv2320Readiness: verdict === 'PASS'
      ? 'Simulation proof complete. UTV2-320 can be reopened on the simulation path.'
      : 'Simulation has failures. Resolve before reopening UTV2-320.',
  };

  const outDir = join(REPO_ROOT, 'out');
  mkdirSync(outDir, { recursive: true });
  const summaryPath = join(outDir, 'utv2-320-simulation-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  console.log('======================================================');
  console.log(`  VERDICT : ${verdict}`);
  console.log(`  ${summary.utv2320Readiness}`);
  console.log(`  Summary : ${summaryPath}`);
  console.log('======================================================');
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
