/**
 * UTV2-432 MLB Simulation Baseline Certification - R1-R5 Driver
 *
 * Certifies the R1-R5 verification & simulation engine for MLB using the
 * canonical sport simulation certification framework.
 *
 * Framework: docs/05_operations/SPORT_SIMULATION_CERTIFICATION_FRAMEWORK.md
 * Canonical model: UTV2-320 (NBA) - closed Done 2026-04-07
 *
 * MLB market families covered (>= 3 picks each):
 *   player_strikeouts_ou  - pitcher strikeout props
 *   player_hits_ou        - batter hit props
 *   player_total_bases_ou - total bases props
 *   player_runs_ou        - runs scored props
 *   player_rbis_ou        - RBI props
 *
 * Proof set: 50 MLB picks, April 7 - May 12 2026
 *   Results : 40W / 10L = 80% hit rate (synthetic, designed-in)
 *   Tiers   : ~37A / 10B / 3C
 *   Loss cluster: April 22 2026 (3 consecutive) - tests drawdown resilience
 *   Pitchers: Burnes, Cole, Strider, Cease, Wheeler, Peralta
 *   Hitters : Ohtani, Judge, Tatis Jr., Acuna Jr., Soto, Rodriguez,
 *             Alvarez, Betts, Turner, Devers, Guerrero Jr., Trout
 *
 * mlb-kelly-sim: SIMULATION-ONLY variant. Identical to canonical kelly-025
 * except maxExposurePerSport: 0.80. Defined inline. Does NOT modify
 * PREDEFINED_STRATEGIES. Label: SIMULATION-ONLY.
 *
 * Run: npx tsx scripts/utv2-432-mlb-simulation.ts
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
// GATE 1: 50-PICK MLB PROOF SET (April 7 - May 12 2026)
// 40W / 10L = 80% hit rate, tier mix, 3-pick loss cluster April 22
// MLB games: night games at 23:05 UTC (7:05 PM ET), day games at 17:10 UTC
// Settled at +4h (after game ends)
// ---------------------------------------------------------------------------

const MLB_PROOF_SET: ProofPick[] = [
  // -- April 7: Cubs vs Brewers / Yankees vs Red Sox -------------------------
  { id: 'pick-mlb-001', gameTime: '2026-04-07T23:10:00Z', playerName: 'Corbin Burnes',      market: 'player_strikeouts_ou', selection: 'Player Over 6.5',  line: 6.5,  odds: -130, result: 'win',  tier: 'A', confidence: 0.77 },
  { id: 'pick-mlb-002', gameTime: '2026-04-07T23:20:00Z', playerName: 'Shohei Ohtani',      market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: 110,  result: 'win',  tier: 'A', confidence: 0.74 },
  { id: 'pick-mlb-003', gameTime: '2026-04-07T23:30:00Z', playerName: 'Aaron Judge',        market: 'player_total_bases_ou',selection: 'Player Over 1.5',  line: 1.5,  odds: -120, result: 'win',  tier: 'A', confidence: 0.76 },
  // -- April 9: Padres vs Dodgers / Braves vs Mets ---------------------------
  { id: 'pick-mlb-004', gameTime: '2026-04-09T23:10:00Z', playerName: 'Dylan Cease',        market: 'player_strikeouts_ou', selection: 'Player Over 7.5',  line: 7.5,  odds: 105,  result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-mlb-005', gameTime: '2026-04-09T23:20:00Z', playerName: 'Fernando Tatis Jr.', market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -110, result: 'win',  tier: 'A', confidence: 0.73 },
  { id: 'pick-mlb-006', gameTime: '2026-04-09T23:30:00Z', playerName: 'Ronald Acuna Jr.',   market: 'player_runs_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -140, result: 'win',  tier: 'A', confidence: 0.79 },
  // -- April 11: Yankees vs Blue Jays / Astros vs Mariners ------------------
  { id: 'pick-mlb-007', gameTime: '2026-04-11T23:10:00Z', playerName: 'Gerrit Cole',        market: 'player_strikeouts_ou', selection: 'Player Over 7.5',  line: 7.5,  odds: -125, result: 'win',  tier: 'A', confidence: 0.78 },
  { id: 'pick-mlb-008', gameTime: '2026-04-11T23:20:00Z', playerName: 'Aaron Judge',        market: 'player_rbis_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -135, result: 'win',  tier: 'A', confidence: 0.80 },
  { id: 'pick-mlb-009', gameTime: '2026-04-11T23:30:00Z', playerName: 'Julio Rodriguez',    market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -105, result: 'win',  tier: 'B', confidence: 0.68 },
  // -- April 13: Cardinals vs Cubs / Giants vs Dodgers ----------------------
  { id: 'pick-mlb-010', gameTime: '2026-04-13T23:10:00Z', playerName: 'Spencer Strider',    market: 'player_strikeouts_ou', selection: 'Player Over 8.5',  line: 8.5,  odds: 115,  result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-mlb-011', gameTime: '2026-04-13T23:20:00Z', playerName: 'Juan Soto',          market: 'player_total_bases_ou',selection: 'Player Over 1.5',  line: 1.5,  odds: -115, result: 'loss', tier: 'B', confidence: 0.66 },
  { id: 'pick-mlb-012', gameTime: '2026-04-13T23:30:00Z', playerName: 'Yordan Alvarez',     market: 'player_rbis_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -140, result: 'win',  tier: 'A', confidence: 0.80 },
  // -- April 15: Phillies vs Braves / Angels vs Astros ----------------------
  { id: 'pick-mlb-013', gameTime: '2026-04-15T23:10:00Z', playerName: 'Zack Wheeler',       market: 'player_strikeouts_ou', selection: 'Player Over 7.5',  line: 7.5,  odds: -120, result: 'win',  tier: 'A', confidence: 0.77 },
  { id: 'pick-mlb-014', gameTime: '2026-04-15T23:20:00Z', playerName: 'Mookie Betts',       market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -110, result: 'win',  tier: 'A', confidence: 0.74 },
  { id: 'pick-mlb-015', gameTime: '2026-04-15T23:30:00Z', playerName: 'Mike Trout',         market: 'player_runs_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -130, result: 'win',  tier: 'A', confidence: 0.75 },
  // -- April 17: Red Sox vs Yankees / Brewers vs Cubs -----------------------
  { id: 'pick-mlb-016', gameTime: '2026-04-17T23:10:00Z', playerName: 'Corbin Burnes',      market: 'player_strikeouts_ou', selection: 'Player Over 6.5',  line: 6.5,  odds: -115, result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-mlb-017', gameTime: '2026-04-17T23:20:00Z', playerName: 'Vladimir Guerrero', market: 'player_total_bases_ou',selection: 'Player Over 1.5',  line: 1.5,  odds: 100,  result: 'win',  tier: 'B', confidence: 0.69 },
  { id: 'pick-mlb-018', gameTime: '2026-04-17T23:30:00Z', playerName: 'Trea Turner',        market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -110, result: 'win',  tier: 'A', confidence: 0.73 },
  // -- April 19: Mariners vs Angels / Mets vs Phillies ----------------------
  { id: 'pick-mlb-019', gameTime: '2026-04-19T23:10:00Z', playerName: 'Freddy Peralta',     market: 'player_strikeouts_ou', selection: 'Player Over 6.5',  line: 6.5,  odds: 105,  result: 'win',  tier: 'A', confidence: 0.74 },
  { id: 'pick-mlb-020', gameTime: '2026-04-19T23:20:00Z', playerName: 'Julio Rodriguez',    market: 'player_total_bases_ou',selection: 'Player Over 1.5',  line: 1.5,  odds: -115, result: 'win',  tier: 'B', confidence: 0.67 },
  { id: 'pick-mlb-021', gameTime: '2026-04-19T23:30:00Z', playerName: 'Rafael Devers',      market: 'player_rbis_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -130, result: 'win',  tier: 'A', confidence: 0.77 },
  // -- April 21: Dodgers vs Padres / Cardinals vs Reds ----------------------
  { id: 'pick-mlb-022', gameTime: '2026-04-21T23:10:00Z', playerName: 'Shohei Ohtani',      market: 'player_total_bases_ou',selection: 'Player Over 2.5',  line: 2.5,  odds: 110,  result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-mlb-023', gameTime: '2026-04-21T23:20:00Z', playerName: 'Fernando Tatis Jr.', market: 'player_runs_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -125, result: 'win',  tier: 'A', confidence: 0.78 },
  { id: 'pick-mlb-024', gameTime: '2026-04-21T23:30:00Z', playerName: 'Dylan Cease',        market: 'player_strikeouts_ou', selection: 'Player Over 7.5',  line: 7.5,  odds: 100,  result: 'win',  tier: 'A', confidence: 0.75 },
  // -- April 22: LOSS CLUSTER (3 consecutive) - Yankees vs Orioles ----------
  { id: 'pick-mlb-025', gameTime: '2026-04-22T23:10:00Z', playerName: 'Aaron Judge',        market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -130, result: 'loss', tier: 'C', confidence: 0.62 },
  { id: 'pick-mlb-026', gameTime: '2026-04-22T23:20:00Z', playerName: 'Gerrit Cole',        market: 'player_strikeouts_ou', selection: 'Player Over 8.5',  line: 8.5,  odds: 120,  result: 'loss', tier: 'B', confidence: 0.65 },
  { id: 'pick-mlb-027', gameTime: '2026-04-22T23:30:00Z', playerName: 'Juan Soto',          market: 'player_rbis_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: 115,  result: 'loss', tier: 'C', confidence: 0.63 },
  // -- April 24: Braves vs Cubs / Astros vs Rangers -------------------------
  { id: 'pick-mlb-028', gameTime: '2026-04-24T23:10:00Z', playerName: 'Ronald Acuna Jr.',   market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -115, result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-mlb-029', gameTime: '2026-04-24T23:20:00Z', playerName: 'Yordan Alvarez',     market: 'player_total_bases_ou',selection: 'Player Over 2.5',  line: 2.5,  odds: 105,  result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-mlb-030', gameTime: '2026-04-24T23:30:00Z', playerName: 'Spencer Strider',    market: 'player_strikeouts_ou', selection: 'Player Over 8.5',  line: 8.5,  odds: 110,  result: 'win',  tier: 'A', confidence: 0.77 },
  // -- April 26: Phillies vs Mets / Giants vs Padres -------------------------
  { id: 'pick-mlb-031', gameTime: '2026-04-26T23:10:00Z', playerName: 'Zack Wheeler',       market: 'player_strikeouts_ou', selection: 'Player Over 7.5',  line: 7.5,  odds: -120, result: 'win',  tier: 'A', confidence: 0.78 },
  { id: 'pick-mlb-032', gameTime: '2026-04-26T23:20:00Z', playerName: 'Mookie Betts',       market: 'player_runs_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -130, result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-mlb-033', gameTime: '2026-04-26T23:30:00Z', playerName: 'Trea Turner',        market: 'player_rbis_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -125, result: 'loss', tier: 'B', confidence: 0.66 },
  // -- April 28: Blue Jays vs Yankees / Mariners vs Astros ------------------
  { id: 'pick-mlb-034', gameTime: '2026-04-28T23:10:00Z', playerName: 'Vladimir Guerrero', market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -110, result: 'win',  tier: 'B', confidence: 0.69 },
  { id: 'pick-mlb-035', gameTime: '2026-04-28T23:20:00Z', playerName: 'Corbin Burnes',      market: 'player_strikeouts_ou', selection: 'Player Over 6.5',  line: 6.5,  odds: -125, result: 'win',  tier: 'A', confidence: 0.77 },
  { id: 'pick-mlb-036', gameTime: '2026-04-28T23:30:00Z', playerName: 'Julio Rodriguez',    market: 'player_runs_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -120, result: 'win',  tier: 'B', confidence: 0.68 },
  // -- April 30: Cubs vs Cardinals / Dodgers vs Giants ----------------------
  { id: 'pick-mlb-037', gameTime: '2026-04-30T23:10:00Z', playerName: 'Freddy Peralta',     market: 'player_strikeouts_ou', selection: 'Player Over 6.5',  line: 6.5,  odds: 110,  result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-mlb-038', gameTime: '2026-04-30T23:20:00Z', playerName: 'Shohei Ohtani',      market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -115, result: 'win',  tier: 'A', confidence: 0.76 },
  { id: 'pick-mlb-039', gameTime: '2026-04-30T23:30:00Z', playerName: 'Rafael Devers',      market: 'player_total_bases_ou',selection: 'Player Over 1.5',  line: 1.5,  odds: -110, result: 'loss', tier: 'B', confidence: 0.67 },
  // -- May 2: Padres vs Braves / Rangers vs Astros --------------------------
  { id: 'pick-mlb-040', gameTime: '2026-05-02T23:10:00Z', playerName: 'Fernando Tatis Jr.', market: 'player_total_bases_ou',selection: 'Player Over 2.5',  line: 2.5,  odds: 115,  result: 'win',  tier: 'A', confidence: 0.74 },
  { id: 'pick-mlb-041', gameTime: '2026-05-02T23:20:00Z', playerName: 'Yordan Alvarez',     market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -115, result: 'win',  tier: 'A', confidence: 0.77 },
  { id: 'pick-mlb-042', gameTime: '2026-05-02T23:30:00Z', playerName: 'Dylan Cease',        market: 'player_strikeouts_ou', selection: 'Player Over 7.5',  line: 7.5,  odds: 105,  result: 'win',  tier: 'A', confidence: 0.76 },
  // -- May 5: Mets vs Phillies / Angels vs Mariners -------------------------
  { id: 'pick-mlb-043', gameTime: '2026-05-05T23:10:00Z', playerName: 'Juan Soto',          market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -120, result: 'win',  tier: 'A', confidence: 0.75 },
  { id: 'pick-mlb-044', gameTime: '2026-05-05T23:20:00Z', playerName: 'Mike Trout',         market: 'player_total_bases_ou',selection: 'Player Over 1.5',  line: 1.5,  odds: -110, result: 'win',  tier: 'A', confidence: 0.73 },
  { id: 'pick-mlb-045', gameTime: '2026-05-05T23:30:00Z', playerName: 'Gerrit Cole',        market: 'player_strikeouts_ou', selection: 'Player Over 8.5',  line: 8.5,  odds: 120,  result: 'loss', tier: 'C', confidence: 0.61 },
  // -- May 7: Cardinals vs Brewers / Blue Jays vs Orioles -------------------
  { id: 'pick-mlb-046', gameTime: '2026-05-07T23:10:00Z', playerName: 'Mookie Betts',       market: 'player_rbis_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -130, result: 'win',  tier: 'A', confidence: 0.78 },
  { id: 'pick-mlb-047', gameTime: '2026-05-07T23:20:00Z', playerName: 'Vladimir Guerrero', market: 'player_runs_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -120, result: 'win',  tier: 'B', confidence: 0.68 },
  { id: 'pick-mlb-048', gameTime: '2026-05-07T23:30:00Z', playerName: 'Trea Turner',        market: 'player_total_bases_ou',selection: 'Player Over 1.5',  line: 1.5,  odds: -110, result: 'win',  tier: 'A', confidence: 0.74 },
  // -- May 10: Dodgers vs Cubs / Yankees vs Red Sox -------------------------
  { id: 'pick-mlb-049', gameTime: '2026-05-10T23:10:00Z', playerName: 'Shohei Ohtani',      market: 'player_rbis_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -135, result: 'win',  tier: 'A', confidence: 0.79 },
  { id: 'pick-mlb-050', gameTime: '2026-05-10T23:20:00Z', playerName: 'Rafael Devers',      market: 'player_runs_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -125, result: 'loss', tier: 'B', confidence: 0.65 },
];

// ---------------------------------------------------------------------------
// GATE 4: ADVERSE PROOF SET (10L / 0W) — standard across all sports
// ---------------------------------------------------------------------------

const MLB_PROOF_SET_ADVERSE: ProofPick[] = [
  { id: 'pick-adv-001', gameTime: '2026-05-20T23:10:00Z', playerName: 'Pitcher A', market: 'player_strikeouts_ou', selection: 'Player Over 6.5',  line: 6.5,  odds: -115, result: 'loss', tier: 'B', confidence: 0.63 },
  { id: 'pick-adv-002', gameTime: '2026-05-20T23:20:00Z', playerName: 'Batter B',  market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -110, result: 'loss', tier: 'B', confidence: 0.64 },
  { id: 'pick-adv-003', gameTime: '2026-05-20T23:30:00Z', playerName: 'Batter C',  market: 'player_total_bases_ou',selection: 'Player Over 1.5',  line: 1.5,  odds: -110, result: 'loss', tier: 'C', confidence: 0.61 },
  { id: 'pick-adv-004', gameTime: '2026-05-20T23:40:00Z', playerName: 'Batter D',  market: 'player_runs_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -105, result: 'loss', tier: 'B', confidence: 0.62 },
  { id: 'pick-adv-005', gameTime: '2026-05-20T23:50:00Z', playerName: 'Batter E',  market: 'player_rbis_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: 100,  result: 'loss', tier: 'C', confidence: 0.60 },
  { id: 'pick-adv-006', gameTime: '2026-05-21T00:00:00Z', playerName: 'Pitcher F', market: 'player_strikeouts_ou', selection: 'Player Over 7.5',  line: 7.5,  odds: 110,  result: 'loss', tier: 'B', confidence: 0.63 },
  { id: 'pick-adv-007', gameTime: '2026-05-21T00:10:00Z', playerName: 'Batter G',  market: 'player_hits_ou',       selection: 'Player Over 1.5',  line: 1.5,  odds: -120, result: 'loss', tier: 'C', confidence: 0.61 },
  { id: 'pick-adv-008', gameTime: '2026-05-21T00:20:00Z', playerName: 'Batter H',  market: 'player_total_bases_ou',selection: 'Player Over 1.5',  line: 1.5,  odds: -110, result: 'loss', tier: 'B', confidence: 0.62 },
  { id: 'pick-adv-009', gameTime: '2026-05-21T00:30:00Z', playerName: 'Batter I',  market: 'player_runs_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -115, result: 'loss', tier: 'B', confidence: 0.64 },
  { id: 'pick-adv-010', gameTime: '2026-05-21T00:40:00Z', playerName: 'Batter J',  market: 'player_rbis_ou',       selection: 'Player Over 0.5',  line: 0.5,  odds: -105, result: 'loss', tier: 'C', confidence: 0.60 },
];

// ---------------------------------------------------------------------------
// EVENT STORE BUILDER (sport-agnostic, reused from NBA pattern)
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
    const settledAt = t(4 * 60 * 60 * 1000); // +4 hours (after game)

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
          sport: 'MLB',
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
      timestamp: settledAt,
      payload: { result: pick.result, source: 'simulation' },
    });
  }

  rawEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const event of rawEvents) {
    store.appendEvent(event);
  }

  return store;
}

// ---------------------------------------------------------------------------
// INLINE STRATEGY VARIANT (simulation-only, not in PREDEFINED_STRATEGIES)
// ---------------------------------------------------------------------------

/**
 * mlb-kelly-sim: SIMULATION-ONLY.
 *
 * Identical to canonical kelly-025 except maxExposurePerSport: 0.80.
 * Required because canonical kelly-025 has maxExposurePerSport: 0.15
 * which correctly blocks all-but-one bet on a single-sport dataset.
 * This variant allows a meaningful comparison on an all-MLB proof set.
 *
 * Does NOT modify PREDEFINED_STRATEGIES. Defined inline. Labeled SIMULATION-ONLY.
 */
const MLB_KELLY_SIM = {
  strategyId: 'mlb-kelly-sim',
  description: 'SIMULATION-ONLY: kelly-025 with relaxed sport cap for all-MLB dataset',
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
const RUN_ID = `utv2-432-mlb-sim-${new Date().toISOString().replace(/[:.]/g, '-')}`;

const PROOF_WINS   = MLB_PROOF_SET.filter(p => p.result === 'win').length;
const PROOF_LOSSES = MLB_PROOF_SET.filter(p => p.result === 'loss').length;
const TIER_A = MLB_PROOF_SET.filter(p => p.tier === 'A').length;
const TIER_B = MLB_PROOF_SET.filter(p => p.tier === 'B').length;
const TIER_C = MLB_PROOF_SET.filter(p => p.tier === 'C').length;

async function main(): Promise<void> {
  console.log('======================================================');
  console.log('  UTV2-432 MLB Simulation Baseline Certification');
  console.log('  Framework: SPORT_SIMULATION_CERTIFICATION_FRAMEWORK');
  console.log('======================================================');
  console.log(`  runId    : ${RUN_ID}`);
  console.log(`  sport    : MLB`);
  console.log(`  picks    : ${MLB_PROOF_SET.length} (${PROOF_WINS}W / ${PROOF_LOSSES}L)`);
  console.log(`  tiers    : ${TIER_A}A / ${TIER_B}B / ${TIER_C}C`);
  console.log(`  dates    : 2026-04-07 to 2026-05-10`);
  console.log(`  hit rate : ${(PROOF_WINS / MLB_PROOF_SET.length * 100).toFixed(1)}%`);
  console.log('');

  // -- R1: Clock + Adapters --------------------------------------------------
  console.log('[ R1 ] Initializing virtual clocks and simulation adapters...');
  const store1 = buildEventStore(MLB_PROOF_SET);
  const store2 = buildEventStore(MLB_PROOF_SET);
  const clock1 = new VirtualEventClock(new Date('2026-04-07T23:05:00Z'));
  const clock2 = new VirtualEventClock(new Date('2026-04-07T23:05:00Z'));
  const adapters1 = createReplaySimulationManifest(store1);
  const adapters2 = createReplaySimulationManifest(store2);
  console.log(`       event store : ${store1.size} events per store (2 independent stores)`);
  console.log('');

  // -- R2: Deterministic Replay run 1 ---------------------------------------
  console.log('[ R2 ] Running ReplayOrchestrator (run 1 of 2)...');
  const replayOrchestrator1 = new ReplayOrchestrator({
    runId: `${RUN_ID}-r2-run1`,
    eventStore: store1,
    clock: clock1,
    adapters: adapters1,
  });
  const replayResult1 = await replayOrchestrator1.run();
  console.log(`       events processed : ${replayResult1.eventsProcessed}`);
  console.log(`       picks created    : ${replayResult1.picksCreated}`);
  console.log(`       errors           : ${replayResult1.errors.length}`);
  console.log(`       determinism hash : ${replayResult1.determinismHash}`);

  if (replayResult1.errors.length > 0) {
    for (const err of replayResult1.errors) {
      console.warn(`         [${err.eventType}] pick=${err.pickId ?? 'n/a'} : ${err.error}`);
    }
  }

  // -- R2: Deterministic Replay run 2 (cross-validation) -------------------
  console.log('');
  console.log('[ R2 ] Running ReplayOrchestrator (run 2 of 2 - determinism cross-validation)...');
  const replayOrchestrator2 = new ReplayOrchestrator({
    runId: `${RUN_ID}-r2-run2`,
    eventStore: store2,
    clock: clock2,
    adapters: adapters2,
  });
  const replayResult2 = await replayOrchestrator2.run();
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
    console.error(`       CRITICAL: hash divergence — engine has state leak`);
    console.error(`       run1: ${replayResult1.determinismHash}`);
    console.error(`       run2: ${replayResult2.determinismHash}`);
  }

  const replayWriter = new ReplayProofWriter(REPO_ROOT);
  const r2BundlePath = replayWriter.write(replayResult1, store1.getAllEvents());
  console.log(`       proof bundle : ${r2BundlePath}`);
  console.log('');

  // -- R4: Fault Injection (F1 - Idempotency) --------------------------------
  console.log('[ R4 ] Running FaultOrchestrator (F1: duplicate publish idempotency)...');
  const f1Setup = SCENARIO_CATALOG['F1']!();
  const faultClock = new VirtualEventClock(new Date('2024-01-15T11:59:59Z'));
  const faultOrchestrator = new FaultOrchestrator(f1Setup, faultClock, `${RUN_ID}-r4-f1`);
  const faultResult = await faultOrchestrator.run(f1Setup.assertors);

  const r4Passed = faultResult.assertions.filter(a => a.pass).length;
  const r4Failed = faultResult.assertions.filter(a => !a.pass).length;
  console.log(`       scenario         : ${faultResult.scenarioName}`);
  console.log(`       assertions       : ${r4Passed} passed / ${r4Failed} failed`);
  console.log(`       overall pass     : ${faultResult.pass ? 'PASS' : 'FAIL'}`);

  if (!faultResult.pass) {
    for (const a of faultResult.assertions.filter(x => !x.pass)) {
      console.warn(`         FAIL [${a.assertionId}]: ${a.failureReason ?? 'no reason'}`);
    }
  }

  const faultWriter = new FaultProofWriter(REPO_ROOT);
  const r4BundlePath = faultWriter.write(faultResult, f1Setup.scenario.proofArtifactName);
  console.log(`       proof bundle     : ${r4BundlePath}`);
  console.log('');

  // -- R5: Strategy Evaluation (flat-unit + mlb-kelly-sim) ------------------
  console.log('[ R5 ] Running StrategyEvaluationEngine...');
  console.log('       NOTE: mlb-kelly-sim is a SIMULATION-ONLY variant.');
  console.log('             Canonical kelly-025 config is not modified.');
  const engine = new StrategyEvaluationEngine();
  const runAt = new Date().toISOString();

  const flatConfig = PREDEFINED_STRATEGIES['flat-unit']!;
  const flatResult = engine.run(replayResult1, flatConfig, runAt);
  const mlbKellyResult = engine.run(replayResult1, MLB_KELLY_SIM, runAt);

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
  console.log('       mlb-kelly-sim (simulation variant):');
  console.log(`         bets placed   : ${mlbKellyResult.betsPlaced}`);
  console.log(`         bets skipped  : ${mlbKellyResult.betsSkipped}`);
  console.log(`         hit rate      : ${(mlbKellyResult.hitRate * 100).toFixed(1)}%`);
  console.log(`         ROI           : ${(mlbKellyResult.roi * 100).toFixed(2)}%`);
  console.log(`         bankroll      : $${mlbKellyResult.initialBankroll.toFixed(0)} -> $${mlbKellyResult.finalBankroll.toFixed(2)}`);
  console.log(`         max drawdown  : ${(mlbKellyResult.maxDrawdown * 100).toFixed(2)}%`);
  if (mlbKellyResult.haltedAt) {
    console.warn(`         HALTED at ${mlbKellyResult.haltedAt}: ${mlbKellyResult.haltReason}`);
  }

  const comparator = new StrategyComparator();
  const comparison = comparator.compare(flatResult, mlbKellyResult, runAt);
  console.log('');
  console.log('       comparison (flat-unit vs mlb-kelly-sim):');
  console.log(`         ROI winner      : ${comparison.winner.roi}`);
  console.log(`         drawdown winner : ${comparison.winner.maxDrawdown}`);
  console.log(`         bankroll winner : ${comparison.winner.bankrollGrowth}`);

  const strategyWriter = new StrategyProofWriter(REPO_ROOT);
  const r5FlatPath = strategyWriter.writeEvaluation(flatResult);
  const r5KellyPath = strategyWriter.writeEvaluation(mlbKellyResult);
  const r5CmpPath = strategyWriter.writeComparison(comparison);
  console.log('');
  console.log(`       flat-unit bundle    : ${r5FlatPath}`);
  console.log(`       mlb-kelly-sim bundle: ${r5KellyPath}`);
  console.log(`       comparison         : ${r5CmpPath}`);
  console.log('');

  // -- ADVERSE: Gate 4 -------------------------------------------------------
  console.log('[ ADVERSE ] Running adverse scenario (10L / 0W - drawdown guard test)...');
  const adverseStore = buildEventStore(MLB_PROOF_SET_ADVERSE);
  const adverseClock = new VirtualEventClock(new Date('2026-05-20T23:05:00Z'));
  const adverseAdapters = createReplaySimulationManifest(adverseStore);
  const adverseOrchestrator = new ReplayOrchestrator({
    runId: `${RUN_ID}-adverse`,
    eventStore: adverseStore,
    clock: adverseClock,
    adapters: adverseAdapters,
  });
  const adverseReplay = await adverseOrchestrator.run();
  const adverseFlatResult = engine.run(adverseReplay, flatConfig, runAt);

  const adverseExpectedFloor = 8500;
  const adverseExpectedCeiling = 9200;
  const adverseBankrollInRange = adverseFlatResult.finalBankroll > adverseExpectedFloor &&
                                  adverseFlatResult.finalBankroll < adverseExpectedCeiling;
  const adverseNoErrors  = adverseReplay.errors.length === 0;
  const adverseNoNegative = adverseFlatResult.finalBankroll > 0;
  const adversePass = adverseNoErrors && adverseNoNegative && adverseBankrollInRange;

  console.log(`         picks           : ${MLB_PROOF_SET_ADVERSE.length} (all losses)`);
  console.log(`         R2 errors       : ${adverseReplay.errors.length}`);
  console.log(`         bets placed     : ${adverseFlatResult.betsPlaced}`);
  console.log(`         final bankroll  : $${adverseFlatResult.finalBankroll.toFixed(2)} (expected $${adverseExpectedFloor}-$${adverseExpectedCeiling})`);
  console.log(`         max drawdown    : ${(adverseFlatResult.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`         guard halted    : ${adverseFlatResult.haltedAt ? `YES at ${adverseFlatResult.haltedAt}` : 'NO (correct: drawdown < 50% halt threshold)'}`);
  console.log(`         bankroll in range: ${adverseBankrollInRange ? 'YES' : 'NO'}`);
  console.log(`         GATE 4 ADVERSE  : ${adversePass ? 'PASS' : 'FAIL'}`);
  console.log('');

  // -- Gate evaluation -------------------------------------------------------
  const r2Pass = replayResult1.errors.length === 0 && replayResult2.errors.length === 0;
  const r3Pass = deterministicMatch;
  const r4Pass = faultResult.pass;
  const r5Pass = flatResult.betsPlaced >= 30 && mlbKellyResult.betsPlaced >= 5;

  const gates = {
    gate1Volume:      { pass: r2Pass,     label: 'Volume (50 MLB picks, 0 R2 errors, tier mix, Apr 22 loss cluster)' },
    gate2Strategy:    { pass: r5Pass,     label: `Strategy (flat>=30, kelly-sim>=5): flat=${flatResult.betsPlaced}, mlb-kelly=${mlbKellyResult.betsPlaced} [corr limits active]` },
    gate3Determinism: { pass: r3Pass,     label: 'Determinism (run1 hash == run2 hash)' },
    gate4Adverse:     { pass: adversePass, label: 'Adverse (10L/0W, bankroll in range, no crash)' },
  };

  console.log('------------------------------------------------------');
  console.log('  GATE SUMMARY (UTV2-432 MLB Certification)');
  console.log('------------------------------------------------------');
  for (const [key, gate] of Object.entries(gates)) {
    console.log(`  ${gate.pass ? '[PASS]' : '[FAIL]'} ${key}: ${gate.label}`);
  }
  console.log('');

  const allGatesPass = Object.values(gates).every(g => g.pass);
  const verdict = allGatesPass ? 'PASS' : 'FAIL';

  // -- Summary JSON ----------------------------------------------------------
  const marketCoverage: Record<string, number> = {};
  for (const p of MLB_PROOF_SET) {
    marketCoverage[p.market] = (marketCoverage[p.market] ?? 0) + 1;
  }

  const summary = {
    runId: RUN_ID,
    issue: 'UTV2-432',
    sport: 'MLB',
    framework: 'docs/05_operations/SPORT_SIMULATION_CERTIFICATION_FRAMEWORK.md',
    generatedAt: runAt,
    proofSet: {
      pickCount: MLB_PROOF_SET.length,
      dateRange: '2026-04-07 to 2026-05-10',
      wins: PROOF_WINS,
      losses: PROOF_LOSSES,
      hitRate: `${(PROOF_WINS / MLB_PROOF_SET.length * 100).toFixed(1)}%`,
      tiers: { A: TIER_A, B: TIER_B, C: TIER_C },
      marketCoverage,
      players: [...new Set(MLB_PROOF_SET.map(p => p.playerName))],
      lossCluster: 'April 22 2026 (picks 025-027, 3 consecutive losses)',
    },
    gates: {
      gate1Volume: {
        pass: r2Pass,
        run1Events: replayResult1.eventsProcessed,
        run1Picks: replayResult1.picksCreated,
        run1Errors: replayResult1.errors.length,
        run2Errors: replayResult2.errors.length,
        bundlePath: r2BundlePath,
      },
      gate2Strategy: {
        pass: r5Pass,
        flatUnit: {
          betsPlaced: flatResult.betsPlaced,
          hitRate: flatResult.hitRate,
          roi: flatResult.roi,
          finalBankroll: flatResult.finalBankroll,
          maxDrawdown: flatResult.maxDrawdown,
          bundlePath: r5FlatPath,
        },
        mlbKellySim: {
          note: 'SIMULATION-ONLY variant. Canonical kelly-025 not modified.',
          betsPlaced: mlbKellyResult.betsPlaced,
          hitRate: mlbKellyResult.hitRate,
          roi: mlbKellyResult.roi,
          finalBankroll: mlbKellyResult.finalBankroll,
          maxDrawdown: mlbKellyResult.maxDrawdown,
          bundlePath: r5KellyPath,
        },
        comparisonPath: r5CmpPath,
      },
      gate3Determinism: {
        pass: deterministicMatch,
        run1Hash: replayResult1.determinismHash,
        run2Hash: replayResult2.determinismHash,
        verdict: deterministicMatch ? 'IDENTICAL' : 'DIVERGED',
      },
      gate4Adverse: {
        pass: adversePass,
        pickCount: MLB_PROOF_SET_ADVERSE.length,
        r2Errors: adverseReplay.errors.length,
        betsPlaced: adverseFlatResult.betsPlaced,
        finalBankroll: adverseFlatResult.finalBankroll,
        maxDrawdown: adverseFlatResult.maxDrawdown,
        guardHalted: adverseFlatResult.haltedAt ?? null,
        bankrollInExpectedRange: adverseBankrollInRange,
        noNegativeBankroll: adverseNoNegative,
      },
    },
    r4Fault: {
      pass: r4Pass,
      scenario: 'F1 - Duplicate publish idempotency',
      assertionsPassed: r4Passed,
      assertionsFailed: r4Failed,
      bundlePath: r4BundlePath,
    },
    verdict,
    simulationBaselineComplete: allGatesPass,
    notProven: [
      'Hit rate (80%) is designed-in, not model-derived. This proves pipeline correctness only.',
      'MLB live production-readiness gate is not satisfied. Requires clvBackedOutcomeCount >= 10 and openCloseRowCount >= 5 in live DB.',
      'F2-F10 fault scenarios not run. Only F1 (idempotency) is required for certification.',
      'R3 shadow mode not exercised. Not meaningful for single-lane synthetic proof.',
    ],
    notes: [
      'mlb-kelly-sim is SIMULATION-ONLY. Production uses canonical kelly-025.',
      'Gate 2 thresholds (flat>=30, kelly-sim>=5) reflect correct corr-limit behavior on single-sport dataset.',
      'MLB market families: player_strikeouts_ou, player_hits_ou, player_total_bases_ou, player_runs_ou, player_rbis_ou.',
    ],
  };

  const outDir = join(REPO_ROOT, 'out');
  mkdirSync(outDir, { recursive: true });
  const summaryPath = join(outDir, 'utv2-432-mlb-simulation-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  console.log('======================================================');
  console.log(`  VERDICT : ${verdict}`);
  if (allGatesPass) {
    console.log('  All 4 framework gates PASS.');
    console.log('  MLB simulation baseline COMPLETE.');
    console.log('  Live production-readiness tracked under Issue B (UTV2-433).');
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
