/**
 * UTV2-434 NHL Simulation Baseline Certification - R1-R5 Driver
 *
 * Certifies the R1-R5 verification & simulation engine for NHL using the
 * canonical sport simulation certification framework.
 *
 * Framework: docs/05_operations/SPORT_SIMULATION_CERTIFICATION_FRAMEWORK.md
 * Canonical model: UTV2-320 (NBA) - closed Done 2026-04-07
 *
 * NHL market families covered (>= 3 picks each):
 *   player_shots_ou   - shots on goal
 *   player_goals_ou   - goals scored (Over 0.5)
 *   player_assists_ou - assists (Over 0.5)
 *   player_points_ou  - points / points scored (Over 0.5)
 *   player_saves_ou   - goalie saves (Over 25.5 / 27.5 / 28.5)
 *
 * Proof set: 50 NHL picks, April 17 - May 22 2026 (playoffs window)
 *   Results : 40W / 10L = 80% hit rate (synthetic, designed-in)
 *   Tiers   : ~36A / 11B / 3C
 *   Loss cluster: May 3 2026 (picks 025-027, 3 consecutive)
 *   Skaters : McDavid, Draisaitl, MacKinnon, Matthews, Pastrnak,
 *             Ovechkin, Makar, Hughes, Stamkos, Marchessault
 *   Goalies : Vasilevskiy, Hellebuyck, Shesterkin, Saros
 *
 * nhl-kelly-sim: SIMULATION-ONLY variant. Identical to canonical kelly-025
 * except maxExposurePerSport: 0.80. Defined inline. PREDEFINED_STRATEGIES
 * not modified.
 *
 * Run: npx tsx scripts/utv2-434-nhl-simulation.ts
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
// TYPES
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

// ---------------------------------------------------------------------------
// GATE 1: 50-PICK NHL PROOF SET (April 17 - May 22 2026, playoffs window)
// 40W / 10L = 80% hit rate, tier mix, 3-pick loss cluster May 3
// NHL games: 23:05 UTC (7:05 PM ET). Settled +4h (post-game).
// ---------------------------------------------------------------------------

const NHL_PROOF_SET: ProofPick[] = [
  // -- Apr 17: Oilers vs Kings / Avs vs Stars --------------------------------
  { id: 'pick-nhl-001', gameTime: '2026-04-17T23:05:00Z', playerName: 'Connor McDavid',      market: 'player_shots_ou',   selection: 'Player Over 3.5',  line: 3.5,  odds: -115, result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-nhl-002', gameTime: '2026-04-17T23:15:00Z', playerName: 'Nathan MacKinnon',    market: 'player_points_ou',  selection: 'Player Over 0.5',  line: 0.5,  odds: -140, result: 'win',  tier: 'A', confidence: 0.80 },
  { id: 'pick-nhl-003', gameTime: '2026-04-17T23:25:00Z', playerName: 'Andrei Vasilevskiy', market: 'player_saves_ou',   selection: 'Player Over 27.5', line: 27.5, odds: -115, result: 'loss', tier: 'B', confidence: 0.66 },
  // -- Apr 19: Maple Leafs vs Lightning / Panthers vs Bruins ----------------
  { id: 'pick-nhl-004', gameTime: '2026-04-19T23:05:00Z', playerName: 'Auston Matthews',     market: 'player_shots_ou',   selection: 'Player Over 3.5',  line: 3.5,  odds: -120, result: 'win',  tier: 'A', confidence: 0.77 },
  { id: 'pick-nhl-005', gameTime: '2026-04-19T23:15:00Z', playerName: 'David Pastrnak',      market: 'player_goals_ou',   selection: 'Player Over 0.5',  line: 0.5,  odds: 160,  result: 'win',  tier: 'A', confidence: 0.74 },
  { id: 'pick-nhl-006', gameTime: '2026-04-19T23:25:00Z', playerName: 'Connor Hellebuyck',   market: 'player_saves_ou',   selection: 'Player Over 27.5', line: 27.5, odds: -110, result: 'win',  tier: 'A', confidence: 0.75 },
  // -- Apr 21: Oilers vs Kings / Rangers vs Capitals ------------------------
  { id: 'pick-nhl-007', gameTime: '2026-04-21T23:05:00Z', playerName: 'Leon Draisaitl',      market: 'player_goals_ou',   selection: 'Player Over 0.5',  line: 0.5,  odds: 155,  result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-nhl-008', gameTime: '2026-04-21T23:15:00Z', playerName: 'Alex Ovechkin',       market: 'player_shots_ou',   selection: 'Player Over 3.5',  line: 3.5,  odds: -110, result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-nhl-009', gameTime: '2026-04-21T23:25:00Z', playerName: 'Igor Shesterkin',     market: 'player_saves_ou',   selection: 'Player Over 28.5', line: 28.5, odds: 105,  result: 'loss', tier: 'B', confidence: 0.65 },
  // -- Apr 23: Panthers vs Bruins / Jets vs Predators -----------------------
  { id: 'pick-nhl-010', gameTime: '2026-04-23T23:05:00Z', playerName: 'David Pastrnak',      market: 'player_assists_ou', selection: 'Player Over 0.5',  line: 0.5,  odds: 130,  result: 'win',  tier: 'A', confidence: 0.74 },
  { id: 'pick-nhl-011', gameTime: '2026-04-23T23:15:00Z', playerName: 'Cale Makar',          market: 'player_points_ou',  selection: 'Player Over 0.5',  line: 0.5,  odds: -130, result: 'win',  tier: 'A', confidence: 0.78 },
  { id: 'pick-nhl-012', gameTime: '2026-04-23T23:25:00Z', playerName: 'Juuse Saros',         market: 'player_saves_ou',   selection: 'Player Over 27.5', line: 27.5, odds: -115, result: 'loss', tier: 'C', confidence: 0.62 },
  // -- Apr 25: Avs vs Stars / Maple Leafs vs Lightning ----------------------
  { id: 'pick-nhl-013', gameTime: '2026-04-25T23:05:00Z', playerName: 'Nathan MacKinnon',    market: 'player_assists_ou', selection: 'Player Over 0.5',  line: 0.5,  odds: 120,  result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-nhl-014', gameTime: '2026-04-25T23:15:00Z', playerName: 'Auston Matthews',     market: 'player_goals_ou',   selection: 'Player Over 0.5',  line: 0.5,  odds: 165,  result: 'win',  tier: 'A', confidence: 0.74 },
  { id: 'pick-nhl-015', gameTime: '2026-04-25T23:25:00Z', playerName: 'Andrei Vasilevskiy', market: 'player_saves_ou',   selection: 'Player Over 25.5', line: 25.5, odds: -125, result: 'win',  tier: 'A', confidence: 0.77 },
  // -- Apr 27: Oilers vs Kings / Panthers vs Bruins -------------------------
  { id: 'pick-nhl-016', gameTime: '2026-04-27T23:05:00Z', playerName: 'Connor McDavid',      market: 'player_points_ou',  selection: 'Player Over 0.5',  line: 0.5,  odds: -145, result: 'win',  tier: 'A', confidence: 0.81 },
  { id: 'pick-nhl-017', gameTime: '2026-04-27T23:15:00Z', playerName: 'Quinn Hughes',        market: 'player_assists_ou', selection: 'Player Over 0.5',  line: 0.5,  odds: 125,  result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-nhl-018', gameTime: '2026-04-27T23:25:00Z', playerName: 'Leon Draisaitl',      market: 'player_shots_ou',   selection: 'Player Over 3.5',  line: 3.5,  odds: -115, result: 'win',  tier: 'B', confidence: 0.68 },
  // -- Apr 29: Rangers vs Capitals / Jets vs Predators ----------------------
  { id: 'pick-nhl-019', gameTime: '2026-04-29T23:05:00Z', playerName: 'Alex Ovechkin',       market: 'player_goals_ou',   selection: 'Player Over 0.5',  line: 0.5,  odds: 170,  result: 'win',  tier: 'A', confidence: 0.73 },
  { id: 'pick-nhl-020', gameTime: '2026-04-29T23:15:00Z', playerName: 'Cale Makar',          market: 'player_assists_ou', selection: 'Player Over 0.5',  line: 0.5,  odds: 115,  result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-nhl-021', gameTime: '2026-04-29T23:25:00Z', playerName: 'Connor Hellebuyck',   market: 'player_saves_ou',   selection: 'Player Over 28.5', line: 28.5, odds: 110,  result: 'loss', tier: 'B', confidence: 0.64 },
  // -- May 1: Avs vs Stars / Oilers vs Kings --------------------------------
  { id: 'pick-nhl-022', gameTime: '2026-05-01T23:05:00Z', playerName: 'Nathan MacKinnon',    market: 'player_shots_ou',   selection: 'Player Over 3.5',  line: 3.5,  odds: -120, result: 'win',  tier: 'A', confidence: 0.77 },
  { id: 'pick-nhl-023', gameTime: '2026-05-01T23:15:00Z', playerName: 'David Pastrnak',      market: 'player_points_ou',  selection: 'Player Over 0.5',  line: 0.5,  odds: -135, result: 'win',  tier: 'A', confidence: 0.79 },
  { id: 'pick-nhl-024', gameTime: '2026-05-01T23:25:00Z', playerName: 'Quinn Hughes',        market: 'player_points_ou',  selection: 'Player Over 0.5',  line: 0.5,  odds: -125, result: 'win',  tier: 'A', confidence: 0.76 },
  // -- May 3: LOSS CLUSTER (3 consecutive) - Panthers vs Maple Leafs -------
  { id: 'pick-nhl-025', gameTime: '2026-05-03T23:05:00Z', playerName: 'Auston Matthews',     market: 'player_goals_ou',   selection: 'Player Over 0.5',  line: 0.5,  odds: 160,  result: 'loss', tier: 'C', confidence: 0.63 },
  { id: 'pick-nhl-026', gameTime: '2026-05-03T23:15:00Z', playerName: 'Igor Shesterkin',     market: 'player_saves_ou',   selection: 'Player Over 27.5', line: 27.5, odds: -110, result: 'loss', tier: 'B', confidence: 0.65 },
  { id: 'pick-nhl-027', gameTime: '2026-05-03T23:25:00Z', playerName: 'Leon Draisaitl',      market: 'player_goals_ou',   selection: 'Player Over 0.5',  line: 0.5,  odds: 155,  result: 'loss', tier: 'B', confidence: 0.64 },
  // -- May 5: Oilers vs Kings / Avs vs Stars --------------------------------
  { id: 'pick-nhl-028', gameTime: '2026-05-05T23:05:00Z', playerName: 'Connor McDavid',      market: 'player_shots_ou',   selection: 'Player Over 4.5',  line: 4.5,  odds: 110,  result: 'win',  tier: 'A', confidence: 0.74 },
  { id: 'pick-nhl-029', gameTime: '2026-05-05T23:15:00Z', playerName: 'Nathan MacKinnon',    market: 'player_points_ou',  selection: 'Player Over 0.5',  line: 0.5,  odds: -140, result: 'win',  tier: 'A', confidence: 0.80 },
  { id: 'pick-nhl-030', gameTime: '2026-05-05T23:25:00Z', playerName: 'Andrei Vasilevskiy', market: 'player_saves_ou',   selection: 'Player Over 26.5', line: 26.5, odds: -120, result: 'win',  tier: 'A', confidence: 0.77 },
  // -- May 7: Rangers vs Panthers / Jets vs Oilers --------------------------
  { id: 'pick-nhl-031', gameTime: '2026-05-07T23:05:00Z', playerName: 'David Pastrnak',      market: 'player_shots_ou',   selection: 'Player Over 3.5',  line: 3.5,  odds: -110, result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-nhl-032', gameTime: '2026-05-07T23:15:00Z', playerName: 'Cale Makar',          market: 'player_points_ou',  selection: 'Player Over 0.5',  line: 0.5,  odds: -130, result: 'win',  tier: 'A', confidence: 0.78 },
  { id: 'pick-nhl-033', gameTime: '2026-05-07T23:25:00Z', playerName: 'Connor Hellebuyck',   market: 'player_saves_ou',   selection: 'Player Over 27.5', line: 27.5, odds: -115, result: 'win',  tier: 'B', confidence: 0.68 },
  // -- May 9: Avs vs Oilers / Panthers vs Rangers ---------------------------
  { id: 'pick-nhl-034', gameTime: '2026-05-09T23:05:00Z', playerName: 'Connor McDavid',      market: 'player_assists_ou', selection: 'Player Over 0.5',  line: 0.5,  odds: 115,  result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-nhl-035', gameTime: '2026-05-09T23:15:00Z', playerName: 'Alex Ovechkin',       market: 'player_shots_ou',   selection: 'Player Over 3.5',  line: 3.5,  odds: -115, result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-nhl-036', gameTime: '2026-05-09T23:25:00Z', playerName: 'Juuse Saros',         market: 'player_saves_ou',   selection: 'Player Over 27.5', line: 27.5, odds: -110, result: 'loss', tier: 'B', confidence: 0.66 },
  // -- May 11: Oilers vs Avs / Panthers vs Rangers --------------------------
  { id: 'pick-nhl-037', gameTime: '2026-05-11T23:05:00Z', playerName: 'Leon Draisaitl',      market: 'player_assists_ou', selection: 'Player Over 0.5',  line: 0.5,  odds: 120,  result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-nhl-038', gameTime: '2026-05-11T23:15:00Z', playerName: 'Nathan MacKinnon',    market: 'player_goals_ou',   selection: 'Player Over 0.5',  line: 0.5,  odds: 155,  result: 'win',  tier: 'A', confidence: 0.74 },
  { id: 'pick-nhl-039', gameTime: '2026-05-11T23:25:00Z', playerName: 'Quinn Hughes',        market: 'player_shots_ou',   selection: 'Player Over 2.5',  line: 2.5,  odds: -120, result: 'win',  tier: 'A', confidence: 0.76 },
  // -- May 13: Oilers vs Panthers / Avs vs Rangers --------------------------
  { id: 'pick-nhl-040', gameTime: '2026-05-13T23:05:00Z', playerName: 'Connor McDavid',      market: 'player_goals_ou',   selection: 'Player Over 0.5',  line: 0.5,  odds: 150,  result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-nhl-041', gameTime: '2026-05-13T23:15:00Z', playerName: 'David Pastrnak',      market: 'player_assists_ou', selection: 'Player Over 0.5',  line: 0.5,  odds: 125,  result: 'win',  tier: 'A', confidence: 0.74 },
  { id: 'pick-nhl-042', gameTime: '2026-05-13T23:25:00Z', playerName: 'Andrei Vasilevskiy', market: 'player_saves_ou',   selection: 'Player Over 27.5', line: 27.5, odds: -115, result: 'win',  tier: 'B', confidence: 0.69 },
  // -- May 15: Oilers vs Panthers / Avs vs Rangers --------------------------
  { id: 'pick-nhl-043', gameTime: '2026-05-15T23:05:00Z', playerName: 'Leon Draisaitl',      market: 'player_points_ou',  selection: 'Player Over 0.5',  line: 0.5,  odds: -130, result: 'win',  tier: 'A', confidence: 0.79 },
  { id: 'pick-nhl-044', gameTime: '2026-05-15T23:15:00Z', playerName: 'Cale Makar',          market: 'player_shots_ou',   selection: 'Player Over 2.5',  line: 2.5,  odds: -115, result: 'win',  tier: 'A', confidence: 0.77 },
  { id: 'pick-nhl-045', gameTime: '2026-05-15T23:25:00Z', playerName: 'Connor Hellebuyck',   market: 'player_saves_ou',   selection: 'Player Over 28.5', line: 28.5, odds: 115,  result: 'loss', tier: 'C', confidence: 0.62 },
  // -- May 18: Stanley Cup Semis - Oilers vs Panthers -----------------------
  { id: 'pick-nhl-046', gameTime: '2026-05-18T23:05:00Z', playerName: 'Connor McDavid',      market: 'player_points_ou',  selection: 'Player Over 0.5',  line: 0.5,  odds: -145, result: 'win',  tier: 'A', confidence: 0.81 },
  { id: 'pick-nhl-047', gameTime: '2026-05-18T23:15:00Z', playerName: 'Alex Ovechkin',       market: 'player_assists_ou', selection: 'Player Over 0.5',  line: 0.5,  odds: 130,  result: 'win',  tier: 'B', confidence: 0.67 },
  // -- May 22: Stanley Cup Semis - Avs vs Rangers ---------------------------
  { id: 'pick-nhl-048', gameTime: '2026-05-22T23:05:00Z', playerName: 'Nathan MacKinnon',    market: 'player_assists_ou', selection: 'Player Over 0.5',  line: 0.5,  odds: 120,  result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-nhl-049', gameTime: '2026-05-22T23:15:00Z', playerName: 'Igor Shesterkin',     market: 'player_saves_ou',   selection: 'Player Over 27.5', line: 27.5, odds: -115, result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-nhl-050', gameTime: '2026-05-22T23:25:00Z', playerName: 'David Pastrnak',      market: 'player_goals_ou',   selection: 'Player Over 0.5',  line: 0.5,  odds: 160,  result: 'loss', tier: 'B', confidence: 0.65 },
];

// ---------------------------------------------------------------------------
// GATE 4: ADVERSE PROOF SET (10L / 0W) — standard across all sports
// ---------------------------------------------------------------------------

const NHL_PROOF_SET_ADVERSE: ProofPick[] = [
  { id: 'pick-adv-001', gameTime: '2026-05-30T23:05:00Z', playerName: 'Skater A',  market: 'player_shots_ou',   selection: 'Player Over 3.5',  line: 3.5,  odds: -115, result: 'loss', tier: 'B', confidence: 0.63 },
  { id: 'pick-adv-002', gameTime: '2026-05-30T23:15:00Z', playerName: 'Skater B',  market: 'player_goals_ou',   selection: 'Player Over 0.5',  line: 0.5,  odds: 155,  result: 'loss', tier: 'B', confidence: 0.64 },
  { id: 'pick-adv-003', gameTime: '2026-05-30T23:25:00Z', playerName: 'Skater C',  market: 'player_assists_ou', selection: 'Player Over 0.5',  line: 0.5,  odds: 120,  result: 'loss', tier: 'C', confidence: 0.61 },
  { id: 'pick-adv-004', gameTime: '2026-05-30T23:35:00Z', playerName: 'Skater D',  market: 'player_points_ou',  selection: 'Player Over 0.5',  line: 0.5,  odds: -130, result: 'loss', tier: 'B', confidence: 0.62 },
  { id: 'pick-adv-005', gameTime: '2026-05-30T23:45:00Z', playerName: 'Goalie E',  market: 'player_saves_ou',   selection: 'Player Over 27.5', line: 27.5, odds: -110, result: 'loss', tier: 'C', confidence: 0.60 },
  { id: 'pick-adv-006', gameTime: '2026-05-31T00:00:00Z', playerName: 'Skater F',  market: 'player_shots_ou',   selection: 'Player Over 3.5',  line: 3.5,  odds: 110,  result: 'loss', tier: 'B', confidence: 0.63 },
  { id: 'pick-adv-007', gameTime: '2026-05-31T00:10:00Z', playerName: 'Skater G',  market: 'player_goals_ou',   selection: 'Player Over 0.5',  line: 0.5,  odds: 160,  result: 'loss', tier: 'C', confidence: 0.61 },
  { id: 'pick-adv-008', gameTime: '2026-05-31T00:20:00Z', playerName: 'Skater H',  market: 'player_assists_ou', selection: 'Player Over 0.5',  line: 0.5,  odds: 125,  result: 'loss', tier: 'B', confidence: 0.62 },
  { id: 'pick-adv-009', gameTime: '2026-05-31T00:30:00Z', playerName: 'Goalie I',  market: 'player_saves_ou',   selection: 'Player Over 28.5', line: 28.5, odds: 105,  result: 'loss', tier: 'B', confidence: 0.64 },
  { id: 'pick-adv-010', gameTime: '2026-05-31T00:40:00Z', playerName: 'Skater J',  market: 'player_points_ou',  selection: 'Player Over 0.5',  line: 0.5,  odds: -120, result: 'loss', tier: 'C', confidence: 0.60 },
];

// ---------------------------------------------------------------------------
// EVENT STORE BUILDER (identical pattern across all sports)
// ---------------------------------------------------------------------------

function buildEventStore(picks: ProofPick[]): JournalEventStore {
  const store = JournalEventStore.createInMemory();

  type RawEvent = {
    eventId: string;
    eventType: 'PICK_SUBMITTED' | 'PICK_GRADED' | 'PICK_POSTED' | 'PICK_SETTLED' | 'RECAP_TRIGGERED';
    pickId: string;
    timestamp: string;
    payload: Record<string, unknown>;
  };

  const rawEvents: RawEvent[] = [];

  for (const pick of picks) {
    const baseMs = new Date(pick.gameTime).getTime();
    const t = (offsetMs: number): string => new Date(baseMs + offsetMs).toISOString();

    rawEvents.push({
      eventId: `${pick.id}-e1`,
      eventType: 'PICK_SUBMITTED',
      pickId: pick.id,
      timestamp: t(0),
      payload: {
        pick: {
          id: pick.id,
          status: 'posted',
          posted_to_discord: true,
          sport: 'NHL',
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
      timestamp: t(60_000),
      payload: {
        gradingData: {
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
      timestamp: t(120_000),
      payload: { posting: { channel: 'discord-best-bets' } },
    });

    rawEvents.push({
      eventId: `${pick.id}-e4`,
      eventType: 'PICK_SETTLED',
      pickId: pick.id,
      timestamp: t(4 * 60 * 60 * 1000),
      payload: { result: pick.result, source: 'simulation' },
    });
  }

  rawEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const event of rawEvents) store.appendEvent(event);
  return store;
}

// ---------------------------------------------------------------------------
// INLINE STRATEGY VARIANT (simulation-only)
// ---------------------------------------------------------------------------

/**
 * nhl-kelly-sim: SIMULATION-ONLY.
 * Identical to canonical kelly-025 except maxExposurePerSport: 0.80.
 * Does NOT modify PREDEFINED_STRATEGIES.
 */
const NHL_KELLY_SIM = {
  strategyId: 'nhl-kelly-sim',
  description: 'SIMULATION-ONLY: kelly-025 with relaxed sport cap for all-NHL dataset',
  stakingMethod: 'fractional_kelly' as const,
  initialBankroll: 10000,
  unitSize: 0.01,
  kellyFraction: 0.25,
  maxStakeCap: 0.1,
  maxDrawdown: 0.4,
  maxDailyExposure: 0.3,
  maxCorrExposure: 0.15,
  maxExposurePerSport: 0.80,
  pickFilters: { requirePosted: true, minTier: 'A' as const },
};

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ID = `utv2-434-nhl-sim-${new Date().toISOString().replace(/[:.]/g, '-')}`;

const PROOF_WINS   = NHL_PROOF_SET.filter(p => p.result === 'win').length;
const PROOF_LOSSES = NHL_PROOF_SET.filter(p => p.result === 'loss').length;
const TIER_A = NHL_PROOF_SET.filter(p => p.tier === 'A').length;
const TIER_B = NHL_PROOF_SET.filter(p => p.tier === 'B').length;
const TIER_C = NHL_PROOF_SET.filter(p => p.tier === 'C').length;

async function main(): Promise<void> {
  console.log('======================================================');
  console.log('  UTV2-434 NHL Simulation Baseline Certification');
  console.log('  Framework: SPORT_SIMULATION_CERTIFICATION_FRAMEWORK');
  console.log('======================================================');
  console.log(`  runId    : ${RUN_ID}`);
  console.log(`  sport    : NHL`);
  console.log(`  picks    : ${NHL_PROOF_SET.length} (${PROOF_WINS}W / ${PROOF_LOSSES}L)`);
  console.log(`  tiers    : ${TIER_A}A / ${TIER_B}B / ${TIER_C}C`);
  console.log(`  dates    : 2026-04-17 to 2026-05-22 (playoffs)`);
  console.log(`  hit rate : ${(PROOF_WINS / NHL_PROOF_SET.length * 100).toFixed(1)}%`);
  console.log('');

  // R1
  console.log('[ R1 ] Initializing virtual clocks and simulation adapters...');
  const store1 = buildEventStore(NHL_PROOF_SET);
  const store2 = buildEventStore(NHL_PROOF_SET);
  const clock1 = new VirtualEventClock(new Date('2026-04-17T23:00:00Z'));
  const clock2 = new VirtualEventClock(new Date('2026-04-17T23:00:00Z'));
  const adapters1 = createReplaySimulationManifest(store1);
  const adapters2 = createReplaySimulationManifest(store2);
  console.log(`       event store : ${store1.size} events per store (2 independent stores)`);
  console.log('');

  // R2 run 1
  console.log('[ R2 ] Running ReplayOrchestrator (run 1 of 2)...');
  const replayResult1 = await new ReplayOrchestrator({ runId: `${RUN_ID}-r2-run1`, eventStore: store1, clock: clock1, adapters: adapters1 }).run();
  console.log(`       events processed : ${replayResult1.eventsProcessed}`);
  console.log(`       picks created    : ${replayResult1.picksCreated}`);
  console.log(`       errors           : ${replayResult1.errors.length}`);
  console.log(`       determinism hash : ${replayResult1.determinismHash}`);
  if (replayResult1.errors.length > 0) {
    for (const e of replayResult1.errors) console.warn(`         [${e.eventType}] ${e.pickId}: ${e.error}`);
  }

  // R2 run 2 (cross-validation)
  console.log('');
  console.log('[ R2 ] Running ReplayOrchestrator (run 2 of 2 - determinism cross-validation)...');
  const replayResult2 = await new ReplayOrchestrator({ runId: `${RUN_ID}-r2-run2`, eventStore: store2, clock: clock2, adapters: adapters2 }).run();
  console.log(`       events processed : ${replayResult2.eventsProcessed}`);
  console.log(`       picks created    : ${replayResult2.picksCreated}`);
  console.log(`       errors           : ${replayResult2.errors.length}`);
  console.log(`       determinism hash : ${replayResult2.determinismHash}`);

  const deterministicMatch = replayResult1.determinismHash === replayResult2.determinismHash;
  console.log('');
  console.log(`[ R2 ] DETERMINISM CROSS-VALIDATION : ${deterministicMatch ? 'PASS' : 'FAIL'}`);
  if (deterministicMatch) {
    console.log(`       Identical hash: ${replayResult1.determinismHash}`);
  } else {
    console.error(`       CRITICAL: hash divergence — run1=${replayResult1.determinismHash} run2=${replayResult2.determinismHash}`);
  }

  const replayWriter = new ReplayProofWriter(REPO_ROOT);
  const r2BundlePath = replayWriter.write(replayResult1, store1.getAllEvents());
  console.log(`       proof bundle : ${r2BundlePath}`);
  console.log('');

  // R4 Fault (F1)
  console.log('[ R4 ] Running FaultOrchestrator (F1: duplicate publish idempotency)...');
  const f1Setup = SCENARIO_CATALOG['F1']!();
  const faultResult = await new FaultOrchestrator(f1Setup, new VirtualEventClock(new Date('2024-01-15T11:59:59Z')), `${RUN_ID}-r4-f1`).run(f1Setup.assertors);
  const r4Passed = faultResult.assertions.filter(a => a.pass).length;
  const r4Failed = faultResult.assertions.filter(a => !a.pass).length;
  console.log(`       scenario     : ${faultResult.scenarioName}`);
  console.log(`       assertions   : ${r4Passed} passed / ${r4Failed} failed`);
  console.log(`       overall pass : ${faultResult.pass ? 'PASS' : 'FAIL'}`);
  if (!faultResult.pass) {
    for (const a of faultResult.assertions.filter(x => !x.pass)) console.warn(`         FAIL [${a.assertionId}]: ${a.failureReason}`);
  }
  const faultWriter = new FaultProofWriter(REPO_ROOT);
  const r4BundlePath = faultWriter.write(faultResult, f1Setup.scenario.proofArtifactName);
  console.log(`       proof bundle : ${r4BundlePath}`);
  console.log('');

  // R5 Strategy
  console.log('[ R5 ] Running StrategyEvaluationEngine...');
  console.log('       NOTE: nhl-kelly-sim is a SIMULATION-ONLY variant.');
  const engine = new StrategyEvaluationEngine();
  const runAt = new Date().toISOString();
  const flatResult = engine.run(replayResult1, PREDEFINED_STRATEGIES['flat-unit']!, runAt);
  const nhlKellyResult = engine.run(replayResult1, NHL_KELLY_SIM, runAt);

  console.log('');
  console.log('       flat-unit:');
  console.log(`         bets placed  : ${flatResult.betsPlaced}`);
  console.log(`         bets skipped : ${flatResult.betsSkipped}`);
  console.log(`         hit rate     : ${(flatResult.hitRate * 100).toFixed(1)}%`);
  console.log(`         ROI          : ${(flatResult.roi * 100).toFixed(2)}%`);
  console.log(`         bankroll     : $${flatResult.initialBankroll.toFixed(0)} -> $${flatResult.finalBankroll.toFixed(2)}`);
  console.log(`         max drawdown : ${(flatResult.maxDrawdown * 100).toFixed(2)}%`);
  if (flatResult.haltedAt) console.warn(`         HALTED at ${flatResult.haltedAt}: ${flatResult.haltReason}`);

  console.log('');
  console.log('       nhl-kelly-sim (simulation variant):');
  console.log(`         bets placed  : ${nhlKellyResult.betsPlaced}`);
  console.log(`         bets skipped : ${nhlKellyResult.betsSkipped}`);
  console.log(`         hit rate     : ${(nhlKellyResult.hitRate * 100).toFixed(1)}%`);
  console.log(`         ROI          : ${(nhlKellyResult.roi * 100).toFixed(2)}%`);
  console.log(`         bankroll     : $${nhlKellyResult.initialBankroll.toFixed(0)} -> $${nhlKellyResult.finalBankroll.toFixed(2)}`);
  console.log(`         max drawdown : ${(nhlKellyResult.maxDrawdown * 100).toFixed(2)}%`);
  if (nhlKellyResult.haltedAt) console.warn(`         HALTED at ${nhlKellyResult.haltedAt}: ${nhlKellyResult.haltReason}`);

  const comparison = new StrategyComparator().compare(flatResult, nhlKellyResult, runAt);
  console.log('');
  console.log('       comparison (flat-unit vs nhl-kelly-sim):');
  console.log(`         ROI winner      : ${comparison.winner.roi}`);
  console.log(`         drawdown winner : ${comparison.winner.maxDrawdown}`);
  console.log(`         bankroll winner : ${comparison.winner.bankrollGrowth}`);

  const stratWriter = new StrategyProofWriter(REPO_ROOT);
  const r5FlatPath  = stratWriter.writeEvaluation(flatResult);
  const r5KellyPath = stratWriter.writeEvaluation(nhlKellyResult);
  const r5CmpPath   = stratWriter.writeComparison(comparison);
  console.log('');
  console.log(`       flat-unit bundle   : ${r5FlatPath}`);
  console.log(`       nhl-kelly-sim bundle: ${r5KellyPath}`);
  console.log(`       comparison         : ${r5CmpPath}`);
  console.log('');

  // Adverse (Gate 4)
  console.log('[ ADVERSE ] Running adverse scenario (10L / 0W)...');
  const adverseStore    = buildEventStore(NHL_PROOF_SET_ADVERSE);
  const adverseClock    = new VirtualEventClock(new Date('2026-05-30T23:00:00Z'));
  const adverseAdapters = createReplaySimulationManifest(adverseStore);
  const adverseReplay   = await new ReplayOrchestrator({ runId: `${RUN_ID}-adverse`, eventStore: adverseStore, clock: adverseClock, adapters: adverseAdapters }).run();
  const adverseFlat     = engine.run(adverseReplay, PREDEFINED_STRATEGIES['flat-unit']!, runAt);

  const adverseInRange = adverseFlat.finalBankroll > 8500 && adverseFlat.finalBankroll < 9200;
  const adversePass    = adverseReplay.errors.length === 0 && adverseFlat.finalBankroll > 0 && adverseInRange;
  console.log(`         picks           : ${NHL_PROOF_SET_ADVERSE.length} (all losses)`);
  console.log(`         R2 errors       : ${adverseReplay.errors.length}`);
  console.log(`         bets placed     : ${adverseFlat.betsPlaced}`);
  console.log(`         final bankroll  : $${adverseFlat.finalBankroll.toFixed(2)} (expected $8500-$9200)`);
  console.log(`         max drawdown    : ${(adverseFlat.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`         guard halted    : ${adverseFlat.haltedAt ? `YES at ${adverseFlat.haltedAt}` : 'NO (correct)'}`);
  console.log(`         bankroll range  : ${adverseInRange ? 'YES' : 'NO'}`);
  console.log(`         GATE 4 ADVERSE  : ${adversePass ? 'PASS' : 'FAIL'}`);
  console.log('');

  // Gate evaluation
  const r2Pass = replayResult1.errors.length === 0 && replayResult2.errors.length === 0;
  const r3Pass = deterministicMatch;
  const r4Pass = faultResult.pass;
  const r5Pass = flatResult.betsPlaced >= 30 && nhlKellyResult.betsPlaced >= 5;

  const gates = {
    gate1Volume:      { pass: r2Pass,     label: 'Volume (50 NHL picks, 0 R2 errors, tier mix, May 3 loss cluster)' },
    gate2Strategy:    { pass: r5Pass,     label: `Strategy (flat>=30, kelly-sim>=5): flat=${flatResult.betsPlaced}, nhl-kelly=${nhlKellyResult.betsPlaced} [corr limits active]` },
    gate3Determinism: { pass: r3Pass,     label: 'Determinism (run1 hash == run2 hash)' },
    gate4Adverse:     { pass: adversePass, label: 'Adverse (10L/0W, bankroll in range, no crash)' },
  };

  console.log('------------------------------------------------------');
  console.log('  GATE SUMMARY (UTV2-434 NHL Certification)');
  console.log('------------------------------------------------------');
  for (const [key, gate] of Object.entries(gates)) {
    console.log(`  ${gate.pass ? '[PASS]' : '[FAIL]'} ${key}: ${gate.label}`);
  }
  console.log('');

  const allPass = Object.values(gates).every(g => g.pass);
  const verdict = allPass ? 'PASS' : 'FAIL';

  // Summary JSON
  const marketCoverage: Record<string, number> = {};
  for (const p of NHL_PROOF_SET) marketCoverage[p.market] = (marketCoverage[p.market] ?? 0) + 1;

  const summary = {
    runId: RUN_ID,
    issue: 'UTV2-434',
    sport: 'NHL',
    framework: 'docs/05_operations/SPORT_SIMULATION_CERTIFICATION_FRAMEWORK.md',
    generatedAt: runAt,
    proofSet: {
      pickCount: NHL_PROOF_SET.length,
      dateRange: '2026-04-17 to 2026-05-22',
      context: 'NHL playoffs window',
      wins: PROOF_WINS,
      losses: PROOF_LOSSES,
      hitRate: `${(PROOF_WINS / NHL_PROOF_SET.length * 100).toFixed(1)}%`,
      tiers: { A: TIER_A, B: TIER_B, C: TIER_C },
      marketCoverage,
      players: [...new Set(NHL_PROOF_SET.map(p => p.playerName))],
      lossCluster: 'May 3 2026 (picks 025-027, 3 consecutive losses)',
    },
    gates: {
      gate1Volume: { pass: r2Pass, run1Events: replayResult1.eventsProcessed, run1Picks: replayResult1.picksCreated, run1Errors: replayResult1.errors.length, run2Errors: replayResult2.errors.length, bundlePath: r2BundlePath },
      gate2Strategy: {
        pass: r5Pass,
        flatUnit:   { betsPlaced: flatResult.betsPlaced,     hitRate: flatResult.hitRate,     roi: flatResult.roi,     finalBankroll: flatResult.finalBankroll,     maxDrawdown: flatResult.maxDrawdown,     bundlePath: r5FlatPath },
        nhlKellySim: { note: 'SIMULATION-ONLY. Canonical kelly-025 not modified.', betsPlaced: nhlKellyResult.betsPlaced, hitRate: nhlKellyResult.hitRate, roi: nhlKellyResult.roi, finalBankroll: nhlKellyResult.finalBankroll, maxDrawdown: nhlKellyResult.maxDrawdown, bundlePath: r5KellyPath },
        comparisonPath: r5CmpPath,
      },
      gate3Determinism: { pass: deterministicMatch, run1Hash: replayResult1.determinismHash, run2Hash: replayResult2.determinismHash, verdict: deterministicMatch ? 'IDENTICAL' : 'DIVERGED' },
      gate4Adverse: { pass: adversePass, pickCount: 10, r2Errors: adverseReplay.errors.length, betsPlaced: adverseFlat.betsPlaced, finalBankroll: adverseFlat.finalBankroll, maxDrawdown: adverseFlat.maxDrawdown, guardHalted: adverseFlat.haltedAt ?? null, bankrollInExpectedRange: adverseInRange, noNegativeBankroll: adverseFlat.finalBankroll > 0 },
    },
    r4Fault: { pass: r4Pass, scenario: 'F1 - Duplicate publish idempotency', assertionsPassed: r4Passed, assertionsFailed: r4Failed, bundlePath: r4BundlePath },
    verdict,
    simulationBaselineComplete: allPass,
    notProven: [
      'Hit rate is designed-in, not model-derived. Pipeline correctness only.',
      'NHL live production-readiness gate not satisfied. Requires clvBackedOutcomeCount >= 10 and openCloseRowCount >= 5.',
      'F2-F10 fault scenarios not run. Only F1 required for certification.',
      'R3 shadow mode not exercised. Not required for single-lane synthetic proof.',
    ],
    notes: [
      'nhl-kelly-sim is SIMULATION-ONLY. Production uses canonical kelly-025.',
      'NHL market families: player_shots_ou, player_goals_ou, player_assists_ou, player_points_ou, player_saves_ou.',
      'Proof set covers playoffs window (Apr 17 - May 22 2026). Goalie save props included.',
      'Gate 2 thresholds (flat>=30, kelly-sim>=5) reflect correct corr-limit behavior on single-sport dataset.',
    ],
  };

  const outDir = join(REPO_ROOT, 'out');
  mkdirSync(outDir, { recursive: true });
  const summaryPath = join(outDir, 'utv2-434-nhl-simulation-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  console.log('======================================================');
  console.log(`  VERDICT : ${verdict}`);
  if (allPass) {
    console.log('  All 4 framework gates PASS.');
    console.log('  NHL simulation baseline COMPLETE.');
    console.log('  Live production-readiness tracked under Issue B (UTV2-435).');
  } else {
    const failing = Object.entries(gates).filter(([, g]) => !g.pass).map(([k]) => k);
    console.log(`  Failing gates: ${failing.join(', ')}`);
  }
  console.log(`  Summary : ${summaryPath}`);
  console.log('======================================================');
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
