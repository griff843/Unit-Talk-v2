/**
 * BankrollSimulator
 *
 * Simulates bankroll evolution over a series of picks using historical
 * settlement truth and optional execution simulation.
 *
 * Design law:
 *   - Settlement truth is ALWAYS from historical event data (never fabricated)
 *   - All risk enforcement is applied deterministically
 *   - Skipped bets record the reason for full auditability
 *
 * Responsibilities:
 *   - Stake sizing (flat, Kelly, fractional Kelly)
 *   - Risk enforcement (drawdown halt, exposure limits, correlation limits)
 *   - PnL accounting using executed odds and historical settlement
 *   - Bankroll curve generation with drawdown tracking
 *   - Risk event logging
 *   - Correlation event logging
 */

import { americanToDecimal, americanToImpliedProb } from './execution-simulator.js';

import type {
  StrategyConfig,
  BankrollStep,
  RiskEvent,
  RiskEventType,
  CorrelationEvent,
  SimulatedExecution,
} from './types.js';

// ─────────────────────────────────────────────────────────────
// PICK RECORD (normalized from replay finalPickState)
// ─────────────────────────────────────────────────────────────

/**
 * Normalized pick record extracted from replay finalPickState.
 * Only the fields needed for strategy simulation.
 */
export interface NormalizedPick {
  id: string;
  sport?: string;
  playerName?: string;
  odds: number; // American
  line: number;
  placedAt: string; // ISO timestamp
  settlementResult?: 'win' | 'loss' | 'push' | 'void';
  settlementStatus?: string;
  postedToDiscord: boolean;
  tier?: string; // S, A, B, C
  confidence?: number; // 0-1
}

// ─────────────────────────────────────────────────────────────
// SIMULATION OUTPUT
// ─────────────────────────────────────────────────────────────

export interface BankrollSimulationOutput {
  steps: BankrollStep[];
  riskEvents: RiskEvent[];
  correlationEvents: CorrelationEvent[];
  finalBankroll: number;
  peakBankroll: number;
  maxDrawdown: number;
  totalStaked: number;
  totalPnl: number;
  betsPlaced: number;
  betsSkipped: number;
  betsRejected: number;
  haltedAt?: string;
  haltReason?: string;
}

// ─────────────────────────────────────────────────────────────
// BANKROLL SIMULATOR
// ─────────────────────────────────────────────────────────────

export class BankrollSimulator {
  private readonly config: StrategyConfig;

  constructor(config: StrategyConfig) {
    this.config = config;
  }

  /**
   * Run the bankroll simulation over a sequence of picks.
   *
   * @param picks       Normalized picks in chronological order (by placedAt)
   * @param executions  Map from pickId to SimulatedExecution (optional friction)
   */
  simulate(
    picks: NormalizedPick[],
    executions: Map<string, SimulatedExecution>,
  ): BankrollSimulationOutput {
    const { config } = this;
    const steps: BankrollStep[] = [];
    const riskEvents: RiskEvent[] = [];
    const correlationEvents: CorrelationEvent[] = [];

    let bankroll = config.initialBankroll;
    let peakBankroll = config.initialBankroll;
    let maxDrawdown = 0;
    let totalStaked = 0;
    let totalPnl = 0;
    let betsPlaced = 0;
    let betsSkipped = 0;
    let betsRejected = 0;
    let haltedAt: string | undefined;
    let haltReason: string | undefined;
    let halted = false;

    // Cumulative exposure tracking (keyed by sport/player)
    const cumulativeSportExposure = new Map<string, number>();
    const cumulativePlayerExposure = new Map<string, number>();

    // Daily exposure tracking (keyed by YYYY-MM-DD)
    const dailyExposure = new Map<string, number>();

    for (const pick of picks) {
      const timestamp = pick.placedAt;

      // ─── Filter: posted requirement ────────────────────────
      const requirePosted = config.pickFilters?.requirePosted !== false; // default true
      if (requirePosted && !pick.postedToDiscord) {
        steps.push(
          this.buildSkipStep(
            pick,
            bankroll,
            peakBankroll,
            totalStaked,
            totalPnl,
            'not_posted',
            'Pick was not posted to Discord',
          ),
        );
        betsSkipped++;
        continue;
      }

      // ─── Filter: settlement requirement ────────────────────
      if (!pick.settlementResult) {
        steps.push(
          this.buildSkipStep(
            pick,
            bankroll,
            peakBankroll,
            totalStaked,
            totalPnl,
            'not_settled',
            'Pick has no settlement result (pending)',
          ),
        );
        betsSkipped++;
        continue;
      }

      // ─── Filter: pick filters ──────────────────────────────
      const filterResult = this.checkPickFilter(pick);
      if (!filterResult.pass) {
        steps.push(
          this.buildSkipStep(
            pick,
            bankroll,
            peakBankroll,
            totalStaked,
            totalPnl,
            'filter_failed',
            filterResult.reason ?? 'Filter failed',
          ),
        );
        betsSkipped++;
        continue;
      }

      // ─── Risk: drawdown halt ───────────────────────────────
      if (halted) {
        steps.push(
          this.buildSkipStep(
            pick,
            bankroll,
            peakBankroll,
            totalStaked,
            totalPnl,
            'drawdown_halt',
            `System halted: ${haltReason ?? 'max drawdown exceeded'}`,
          ),
        );
        betsSkipped++;
        continue;
      }

      // ─── Calculate intended stake ─────────────────────────
      const intendedStake = this.calculateStake(pick, bankroll);

      // ─── Risk: min stake ──────────────────────────────────
      const minStake = config.minStakeSize ?? 1;
      if (intendedStake < minStake) {
        const reason = `Stake ${intendedStake.toFixed(2)} below minimum ${minStake}`;
        steps.push(
          this.buildSkipStep(
            pick,
            bankroll,
            peakBankroll,
            totalStaked,
            totalPnl,
            'min_stake_skip',
            reason,
          ),
        );
        riskEvents.push({
          pickId: pick.id,
          timestamp,
          type: 'min_stake_skip',
          detail: reason,
          bankrollAtEvent: bankroll,
        });
        betsSkipped++;
        continue;
      }

      // ─── Risk: daily exposure ─────────────────────────────
      const dateKey = timestamp.slice(0, 10); // YYYY-MM-DD
      const currentDaily = dailyExposure.get(dateKey) ?? 0;
      const maxDailyAbs = config.initialBankroll * config.maxDailyExposure;
      if (currentDaily + intendedStake > maxDailyAbs) {
        const reason = `Daily exposure limit reached (${currentDaily.toFixed(0)} + ${intendedStake.toFixed(0)} > ${maxDailyAbs.toFixed(0)})`;
        steps.push(
          this.buildSkipStep(
            pick,
            bankroll,
            peakBankroll,
            totalStaked,
            totalPnl,
            'exposure_limit_daily',
            reason,
          ),
        );
        riskEvents.push({
          pickId: pick.id,
          timestamp,
          type: 'exposure_limit_daily',
          detail: reason,
          bankrollAtEvent: bankroll,
        });
        betsSkipped++;
        continue;
      }

      // ─── Risk: sport correlation ──────────────────────────
      const maxCorrAbs = config.initialBankroll * config.maxCorrExposure;
      const corrLimit =
        config.maxExposurePerSport !== undefined
          ? config.initialBankroll * config.maxExposurePerSport
          : maxCorrAbs;

      if (pick.sport) {
        const currentSportExp = cumulativeSportExposure.get(pick.sport) ?? 0;
        const projectedSportExp = currentSportExp + intendedStake;
        const corrEvt: CorrelationEvent = {
          pickIds: [pick.id],
          timestamp,
          correlationType: 'same_sport',
          correlationLabel: pick.sport,
          totalExposure: projectedSportExp,
          limitExceeded: projectedSportExp > corrLimit,
          limit: corrLimit,
        };
        correlationEvents.push(corrEvt);

        if (projectedSportExp > corrLimit) {
          const reason = `Sport correlation limit: ${pick.sport} exposure ${projectedSportExp.toFixed(0)} > limit ${corrLimit.toFixed(0)}`;
          steps.push(
            this.buildSkipStep(
              pick,
              bankroll,
              peakBankroll,
              totalStaked,
              totalPnl,
              'correlation_limit',
              reason,
            ),
          );
          riskEvents.push({
            pickId: pick.id,
            timestamp,
            type: 'correlation_limit',
            detail: reason,
            bankrollAtEvent: bankroll,
          });
          betsSkipped++;
          continue;
        }
      }

      // ─── Risk: player correlation ─────────────────────────
      if (pick.playerName && config.maxExposurePerPlayer !== undefined) {
        const maxPlayerAbs = config.initialBankroll * config.maxExposurePerPlayer;
        const currentPlayerExp = cumulativePlayerExposure.get(pick.playerName) ?? 0;
        const projectedPlayerExp = currentPlayerExp + intendedStake;
        if (projectedPlayerExp > maxPlayerAbs) {
          const reason = `Player exposure limit: ${pick.playerName} exposure ${projectedPlayerExp.toFixed(0)} > limit ${maxPlayerAbs.toFixed(0)}`;
          steps.push(
            this.buildSkipStep(
              pick,
              bankroll,
              peakBankroll,
              totalStaked,
              totalPnl,
              'exposure_limit_player',
              reason,
            ),
          );
          riskEvents.push({
            pickId: pick.id,
            timestamp,
            type: 'exposure_limit_player',
            detail: reason,
            bankrollAtEvent: bankroll,
          });
          betsSkipped++;
          continue;
        }
      }

      // ─── Apply execution simulation ────────────────────────
      const execution = executions.get(pick.id);
      let executedOdds = pick.odds;
      let actualStake = Math.min(intendedStake, bankroll * config.maxStakeCap);
      let execQuality: number | undefined;

      if (execution) {
        execQuality = execution.executionQuality;
        if (execution.rejected) {
          steps.push({
            pickId: pick.id,
            timestamp,
            ...(pick.sport !== undefined ? { sport: pick.sport } : {}),
            ...(pick.playerName !== undefined ? { playerName: pick.playerName } : {}),
            intendedOdds: pick.odds,
            executedOdds: pick.odds,
            stake: 0,
            settlementResult: pick.settlementResult,
            pnl: 0,
            bankrollBefore: bankroll,
            bankrollAfter: bankroll,
            peakBankroll,
            drawdownFromPeak: (peakBankroll - bankroll) / peakBankroll,
            cumulativeROI: totalStaked > 0 ? totalPnl / totalStaked : 0,
            totalStaked,
            totalPnl,
            skipReason: execution.rejectionReason ?? 'execution-rejected',
            riskEventType: 'execution_rejected',
            executionQuality: 0,
            rejected: true,
          });
          riskEvents.push({
            pickId: pick.id,
            timestamp,
            type: 'execution_rejected',
            detail: execution.rejectionReason ?? 'execution rejected',
            bankrollAtEvent: bankroll,
          });
          betsRejected++;
          continue;
        }
        // Use executed odds and stake from simulation
        executedOdds = execution.executedOdds;
        actualStake = Math.min(execution.executedStake, bankroll * config.maxStakeCap);
      }

      // Apply max stake cap
      const stakedAmount = Math.min(actualStake, bankroll * config.maxStakeCap);
      const isCapped = stakedAmount < actualStake;

      if (isCapped) {
        riskEvents.push({
          pickId: pick.id,
          timestamp,
          type: 'stake_capped',
          detail: `Stake capped at ${(config.maxStakeCap * 100).toFixed(1)}% of bankroll`,
          bankrollAtEvent: bankroll,
        });
      }

      // ─── Place the bet ─────────────────────────────────────
      const bankrollBefore = bankroll;
      const decimalOdds = americanToDecimal(executedOdds);

      let pnl = 0;
      const result = pick.settlementResult;

      if (result === 'win') {
        pnl = Math.round(stakedAmount * (decimalOdds - 1) * 100) / 100;
      } else if (result === 'loss') {
        pnl = -stakedAmount;
      } else {
        // push, void — no PnL
        pnl = 0;
      }

      bankroll = Math.round((bankroll + pnl) * 100) / 100;
      totalStaked += stakedAmount;
      totalPnl = Math.round((totalPnl + pnl) * 100) / 100;

      // Update peak + drawdown
      if (bankroll > peakBankroll) {
        peakBankroll = bankroll;
      }
      const currentDrawdown = peakBankroll > 0 ? (peakBankroll - bankroll) / peakBankroll : 0;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      // Update exposure trackers
      dailyExposure.set(dateKey, (dailyExposure.get(dateKey) ?? 0) + stakedAmount);
      if (pick.sport) {
        cumulativeSportExposure.set(
          pick.sport,
          (cumulativeSportExposure.get(pick.sport) ?? 0) + stakedAmount,
        );
      }
      if (pick.playerName) {
        cumulativePlayerExposure.set(
          pick.playerName,
          (cumulativePlayerExposure.get(pick.playerName) ?? 0) + stakedAmount,
        );
      }

      betsPlaced++;

      steps.push({
        pickId: pick.id,
        timestamp,
        ...(pick.sport !== undefined ? { sport: pick.sport } : {}),
        ...(pick.playerName !== undefined ? { playerName: pick.playerName } : {}),
        intendedOdds: pick.odds,
        executedOdds,
        stake: stakedAmount,
        settlementResult: result,
        pnl,
        bankrollBefore,
        bankrollAfter: bankroll,
        peakBankroll,
        drawdownFromPeak: currentDrawdown,
        cumulativeROI: totalStaked > 0 ? totalPnl / totalStaked : 0,
        totalStaked,
        totalPnl,
        ...(execQuality !== undefined ? { executionQuality: execQuality } : {}),
        ...(isCapped ? { riskEventType: 'stake_capped' as const } : {}),
      });

      // ─── Check drawdown halt ───────────────────────────────
      if (currentDrawdown >= config.maxDrawdown) {
        halted = true;
        haltedAt = timestamp;
        haltReason = `Drawdown ${(currentDrawdown * 100).toFixed(1)}% exceeded limit ${(config.maxDrawdown * 100).toFixed(1)}%`;
        riskEvents.push({
          pickId: pick.id,
          timestamp,
          type: 'drawdown_halt',
          detail: haltReason,
          bankrollAtEvent: bankroll,
        });
      }
    }

    return {
      steps,
      riskEvents,
      correlationEvents,
      finalBankroll: bankroll,
      peakBankroll,
      maxDrawdown,
      totalStaked,
      totalPnl,
      betsPlaced,
      betsSkipped,
      betsRejected,
      ...(haltedAt !== undefined ? { haltedAt } : {}),
      ...(haltReason !== undefined ? { haltReason } : {}),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STAKE CALCULATION
  // ─────────────────────────────────────────────────────────────

  private calculateStake(pick: NormalizedPick, bankroll: number): number {
    const { config } = this;

    switch (config.stakingMethod) {
      case 'flat':
        return Math.round(bankroll * config.unitSize * 100) / 100;

      case 'kelly':
      case 'fractional_kelly': {
        const kellyFraction = config.stakingMethod === 'kelly' ? 1.0 : config.kellyFraction;
        const stake = this.computeKellyStake(pick, bankroll, kellyFraction);
        return Math.round(Math.max(0, stake) * 100) / 100;
      }

      case 'custom':
        // Custom staking: use unitSize as base, scaled by confidence
        if (pick.confidence !== undefined) {
          return Math.round(bankroll * config.unitSize * pick.confidence * 2 * 100) / 100;
        }
        return Math.round(bankroll * config.unitSize * 100) / 100;

      default:
        return Math.round(bankroll * config.unitSize * 100) / 100;
    }
  }

  private computeKellyStake(
    pick: NormalizedPick,
    bankroll: number,
    kellyFraction: number,
  ): number {
    const decimalOdds = americanToDecimal(pick.odds);
    const b = decimalOdds - 1; // net odds

    // Win probability estimate:
    // Use model confidence if available, otherwise use market-implied probability
    let pWin: number;
    if (pick.confidence !== undefined && pick.confidence > 0) {
      pWin = pick.confidence;
    } else {
      pWin = americanToImpliedProb(pick.odds);
    }

    const qLose = 1 - pWin;

    // Full Kelly fraction: f = (b*p - q) / b
    if (b <= 0) return 0;
    const fullKellyFraction = (b * pWin - qLose) / b;

    if (fullKellyFraction <= 0) return 0; // No edge — skip

    const fraction = fullKellyFraction * kellyFraction;
    return bankroll * fraction;
  }

  // ─────────────────────────────────────────────────────────────
  // FILTER CHECK
  // ─────────────────────────────────────────────────────────────

  private checkPickFilter(pick: NormalizedPick): { pass: boolean; reason?: string } {
    const filters = this.config.pickFilters;
    if (!filters) return { pass: true };

    if (filters.minTier !== undefined && pick.tier !== undefined) {
      const tierOrder: Record<string, number> = { S: 4, A: 3, B: 2, C: 1 };
      const pickTierVal = tierOrder[pick.tier] ?? 0;
      const minTierVal = tierOrder[filters.minTier] ?? 0;
      if (pickTierVal < minTierVal) {
        return { pass: false, reason: `Tier ${pick.tier} below minimum ${filters.minTier}` };
      }
    }

    if (filters.minConfidence !== undefined && pick.confidence !== undefined) {
      if (pick.confidence < filters.minConfidence) {
        return {
          pass: false,
          reason: `Confidence ${pick.confidence.toFixed(2)} below minimum ${filters.minConfidence.toFixed(2)}`,
        };
      }
    }

    if (filters.sports !== undefined && pick.sport !== undefined) {
      if (!filters.sports.includes(pick.sport)) {
        return { pass: false, reason: `Sport ${pick.sport} not in whitelist` };
      }
    }

    return { pass: true };
  }

  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────

  private buildSkipStep(
    pick: NormalizedPick,
    bankroll: number,
    peakBankroll: number,
    totalStaked: number,
    totalPnl: number,
    riskEventType: RiskEventType,
    skipReason: string,
  ): BankrollStep {
    return {
      pickId: pick.id,
      timestamp: pick.placedAt,
      ...(pick.sport !== undefined ? { sport: pick.sport } : {}),
      ...(pick.playerName !== undefined ? { playerName: pick.playerName } : {}),
      intendedOdds: pick.odds,
      executedOdds: pick.odds,
      stake: 0,
      settlementResult: pick.settlementResult ?? 'pending',
      pnl: 0,
      bankrollBefore: bankroll,
      bankrollAfter: bankroll,
      peakBankroll,
      drawdownFromPeak: peakBankroll > 0 ? (peakBankroll - bankroll) / peakBankroll : 0,
      cumulativeROI: totalStaked > 0 ? totalPnl / totalStaked : 0,
      totalStaked,
      totalPnl,
      skipReason,
      riskEventType,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// PICK NORMALIZER
// ─────────────────────────────────────────────────────────────

/**
 * Normalize a raw pick record from ReplayResult.finalPickState
 * into a NormalizedPick for strategy simulation.
 */
export function normalizePick(raw: Record<string, unknown>): NormalizedPick {
  const meta = raw['meta'] as Record<string, unknown> | undefined;

  return {
    id: raw['id'] as string,
    ...(raw['sport'] !== undefined ? { sport: raw['sport'] as string } : {}),
    ...(raw['player_name'] !== undefined ? { playerName: raw['player_name'] as string } : {}),
    odds: (raw['odds'] as number | undefined) ?? -110,
    line: (raw['line'] as number | undefined) ?? 0,
    placedAt:
      (raw['placed_at'] as string | undefined) ??
      (raw['created_at'] as string | undefined) ??
      new Date(0).toISOString(),
    ...(raw['settlement_result'] !== undefined
      ? { settlementResult: raw['settlement_result'] as 'win' | 'loss' | 'push' | 'void' }
      : {}),
    ...(raw['settlement_status'] !== undefined
      ? { settlementStatus: raw['settlement_status'] as string }
      : {}),
    postedToDiscord: (raw['posted_to_discord'] as boolean | undefined) ?? false,
    ...(meta?.['tier'] !== undefined ? { tier: meta['tier'] as string } : {}),
    ...(meta?.['confidence'] !== undefined ? { confidence: meta['confidence'] as number } : {}),
  };
}
