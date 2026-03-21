/**
 * ExecutionSimulator
 *
 * Models realistic execution friction on replayed picks.
 *
 * Design law:
 *   - NEVER modifies historical settlement truth (win/loss/push)
 *   - All randomness is seeded for determinism
 *   - Execution affects: entry odds, line, stake fill rate, and rejection only
 *
 * Models supported:
 *   - Line movement: historical | stochastic | static
 *   - Latency:       constant | empirical | distribution
 *   - Slippage:      none | proportional | empirical
 *   - Liquidity:     unlimited | tiered | empirical
 *   - Rejection:     none | probabilistic | rule-based
 */

import type { ExecutionSimConfig, SimulatedExecution } from './types.js';

// ─────────────────────────────────────────────────────────────
// SEEDED PRNG
// ─────────────────────────────────────────────────────────────

/**
 * Linear congruential generator for deterministic simulation.
 * Parameters from Numerical Recipes.
 */
class SeededPRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  /** Returns a float in [min, max]. */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns a normally-distributed float with Box-Muller transform. */
  normal(mean: number, stdDev: number): number {
    const u1 = Math.max(this.next(), 1e-10);
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  }
}

// ─────────────────────────────────────────────────────────────
// ODDS HELPERS
// ─────────────────────────────────────────────────────────────

/** Convert American odds to decimal odds. */
export function americanToDecimal(american: number): number {
  if (american < 0) {
    return 1 + 100 / Math.abs(american);
  }
  return 1 + american / 100;
}

/** Convert decimal odds to American odds (rounded). */
export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) {
    return Math.round((decimal - 1) * 100);
  }
  return Math.round(-100 / (decimal - 1));
}

/** Compute win probability from American odds (market-implied). */
export function americanToImpliedProb(american: number): number {
  if (american < 0) {
    const abs = Math.abs(american);
    return abs / (abs + 100);
  }
  return 100 / (american + 100);
}

// ─────────────────────────────────────────────────────────────
// SIMULATOR
// ─────────────────────────────────────────────────────────────

/** Context passed with each simulation call. */
export interface ExecutionContext {
  sport?: string;
  playerName?: string;
  /** Empirical latency in ms (from event timestamps). */
  empiricalLatencyMs?: number;
}

export class ExecutionSimulator {
  private readonly config: ExecutionSimConfig;
  private readonly prng: SeededPRNG;

  constructor(config: ExecutionSimConfig) {
    this.config = config;
    this.prng = new SeededPRNG(config.randomSeed ?? 42);
  }

  /**
   * Simulate execution for a single pick.
   *
   * @param pickId         Pick identifier
   * @param intendedLine   Prop line at submission (e.g., 7.5)
   * @param intendedOdds   American odds at submission (e.g., -110)
   * @param intendedStake  Stake calculated by bankroll engine (dollars)
   * @param ctx            Optional context (sport, player name, empirical latency)
   */
  simulate(
    pickId: string,
    intendedLine: number,
    intendedOdds: number,
    intendedStake: number,
    ctx: ExecutionContext = {},
  ): SimulatedExecution {
    // Step 1: Compute latency
    const latencyMs = this.computeLatency(ctx.empiricalLatencyMs);

    // Step 2: Check rejection (happens before fill)
    const { rejected, rejectionReason } = this.checkRejection(intendedStake, ctx);

    if (rejected) {
      return {
        pickId,
        intendedLine,
        intendedOdds,
        intendedStake,
        executedLine: intendedLine,
        executedOdds: intendedOdds,
        executedStake: 0,
        latencyMs,
        slippageBps: 0,
        fillRate: 0,
        rejected: true,
        ...(rejectionReason !== undefined ? { rejectionReason } : {}),
        impliedCLV: 0,
        executionQuality: 0,
      };
    }

    // Step 3: Apply line movement
    const executedLine = this.applyLineMovement(intendedLine, latencyMs);

    // Step 4: Apply slippage on odds
    const slippageBps = this.computeSlippageBps(intendedOdds, ctx);
    const executedOdds = this.applySlippage(intendedOdds, slippageBps);

    // Step 5: Compute fill rate and executed stake
    const fillRate = this.computeFillRate(intendedStake, ctx);
    const executedStake = Math.round(intendedStake * fillRate * 100) / 100;

    // Step 6: Implied CLV (change in decimal odds × 100)
    const intendedDecimal = americanToDecimal(intendedOdds);
    const executedDecimal = americanToDecimal(executedOdds);
    const impliedCLV = Math.round((executedDecimal - intendedDecimal) * 100 * 100) / 100;

    // Step 7: Execution quality composite
    const executionQuality = this.computeExecutionQuality(fillRate, slippageBps, latencyMs);

    return {
      pickId,
      intendedLine,
      intendedOdds,
      intendedStake,
      executedLine,
      executedOdds,
      executedStake,
      latencyMs,
      slippageBps,
      fillRate,
      rejected: false,
      impliedCLV,
      executionQuality,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE MODEL IMPLEMENTATIONS
  // ─────────────────────────────────────────────────────────────

  private computeLatency(empiricalMs?: number): number {
    switch (this.config.latencyModel) {
      case 'constant':
        return this.config.constantLatencyMs ?? 200;

      case 'empirical':
        return empiricalMs ?? 250;

      case 'distribution': {
        const mean = this.config.meanLatencyMs ?? 300;
        const stdDev = this.config.stdDevLatencyMs ?? 100;
        const raw = this.prng.normal(mean, stdDev);
        return Math.max(0, Math.round(raw));
      }

      default:
        return 200;
    }
  }

  private checkRejection(
    stake: number,
    _ctx: ExecutionContext,
  ): { rejected: boolean; rejectionReason?: string } {
    switch (this.config.rejectionModel) {
      case 'none':
        return { rejected: false };

      case 'probabilistic': {
        const rate = this.config.rejectionRate ?? 0.05;
        if (this.prng.next() < rate) {
          return {
            rejected: true,
            rejectionReason: `probabilistic-rejection (rate=${rate})`,
          };
        }
        return { rejected: false };
      }

      case 'rule-based': {
        const maxStake = this.config.rejectionMaxStake ?? Infinity;
        if (stake > maxStake) {
          return {
            rejected: true,
            rejectionReason: `stake-exceeds-limit (stake=${stake}, limit=${maxStake})`,
          };
        }
        return { rejected: false };
      }

      default:
        return { rejected: false };
    }
  }

  private applyLineMovement(intendedLine: number, latencyMs: number): number {
    switch (this.config.lineMovementModel) {
      case 'static':
        return intendedLine;

      case 'historical':
        // Use intended line (no historical closing line available in fixtures)
        return intendedLine;

      case 'stochastic': {
        const maxBps = this.config.lineMovementBps ?? 10;
        // Movement proportional to latency (more latency = more movement)
        const latencyFactor = Math.min(latencyMs / 1000, 1.0);
        const movement = this.prng.range(-maxBps, maxBps) * latencyFactor;
        // Round to nearest 0.5 (typical prop line increment)
        return Math.round((intendedLine + movement * 0.01) * 2) / 2;
      }

      default:
        return intendedLine;
    }
  }

  private computeSlippageBps(intendedOdds: number, _ctx: ExecutionContext): number {
    switch (this.config.slippageModel) {
      case 'none':
        return 0;

      case 'proportional':
        // Negative slippage = odds got worse for bettor
        return -(this.config.slippageBps ?? 5);

      case 'empirical': {
        // Empirical: scale by how far from fair odds (more extreme = more slippage)
        const impliedProb = americanToImpliedProb(intendedOdds);
        // Heavier favorites have less slippage; underdogs have more
        const factor = impliedProb < 0.5 ? 1.5 : 1.0;
        return -Math.round(5 * factor);
      }

      default:
        return 0;
    }
  }

  private applySlippage(intendedOdds: number, slippageBps: number): number {
    if (slippageBps === 0) return intendedOdds;

    const intendedDecimal = americanToDecimal(intendedOdds);
    // Convert slippage from basis points of decimal odds
    const slippageFraction = slippageBps / 10000;
    const executedDecimal = intendedDecimal + slippageFraction;
    // Clamp to minimum viable decimal odds
    const clampedDecimal = Math.max(1.01, executedDecimal);
    return decimalToAmerican(clampedDecimal);
  }

  private computeFillRate(stake: number, _ctx: ExecutionContext): number {
    switch (this.config.liquidityModel) {
      case 'unlimited':
        return 1.0;

      case 'tiered': {
        const tiers = this.config.liquidityTiers ?? [
          { maxStake: 200, fillRate: 1.0 },
          { maxStake: 500, fillRate: 0.9 },
          { maxStake: 1000, fillRate: 0.75 },
          { maxStake: Infinity, fillRate: 0.5 },
        ];
        // Find the first tier that covers this stake
        for (const tier of tiers) {
          if (stake <= tier.maxStake) {
            return tier.fillRate;
          }
        }
        return 0.5;
      }

      case 'empirical': {
        // Empirical: slight random fill imperfection
        const baseRate = 0.95;
        const noise = this.prng.range(-0.05, 0.05);
        return Math.max(0.5, Math.min(1.0, baseRate + noise));
      }

      default:
        return 1.0;
    }
  }

  private computeExecutionQuality(
    fillRate: number,
    slippageBps: number,
    latencyMs: number,
  ): number {
    // Quality components:
    // 1. Fill rate contributes 40%
    const fillScore = fillRate * 0.4;

    // 2. Slippage contributes 40% (0 bps = perfect, -100 bps = 0)
    const maxAdverseBps = 100;
    const slippageScore = Math.max(0, 1 - Math.abs(slippageBps) / maxAdverseBps) * 0.4;

    // 3. Latency contributes 20% (0ms = perfect, 2000ms = 0)
    const maxLatencyMs = 2000;
    const latencyScore = Math.max(0, 1 - latencyMs / maxLatencyMs) * 0.2;

    return Math.round((fillScore + slippageScore + latencyScore) * 1000) / 1000;
  }
}
