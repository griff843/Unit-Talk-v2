/**
 * Strategy Evaluation Types
 *
 * Canonical type contracts for execution simulation and strategy evaluation.
 *
 * Design law:
 *   - No production state. All types are for in-memory simulation only.
 *   - Settlement truth is always read from historical event store / replay output.
 *   - Execution simulation only affects entry realism and bankroll path.
 *   - Strategy configs must be serializable for proof artifacts.
 */

// ─────────────────────────────────────────────────────────────
// EXECUTION SIMULATION CONFIG
// ─────────────────────────────────────────────────────────────

/** Line movement model for execution simulation. */
export type LineMovementModel = 'historical' | 'stochastic' | 'static';

/** Latency model for execution simulation. */
export type LatencyModel = 'constant' | 'empirical' | 'distribution';

/** Slippage model for execution simulation. */
export type SlippageModel = 'none' | 'proportional' | 'empirical';

/** Liquidity model for execution simulation. */
export type LiquidityModel = 'unlimited' | 'tiered' | 'empirical';

/** Rejection model for execution simulation. */
export type RejectionModel = 'none' | 'probabilistic' | 'rule-based';

/**
 * Configuration for execution simulation.
 * Controls realistic execution friction layered on top of replay picks.
 * All configurations are serializable for proof artifacts.
 */
export interface ExecutionSimConfig {
  /** How the opening line moves from intended to executed time. */
  lineMovementModel: LineMovementModel;
  /** Latency from signal to execution in milliseconds. */
  latencyModel: LatencyModel;
  /** Odds slippage from intended to executed price. */
  slippageModel: SlippageModel;
  /** Liquidity constraints affecting fill rate. */
  liquidityModel: LiquidityModel;
  /** Bet rejection probability or rule set. */
  rejectionModel: RejectionModel;

  // ─── Per-model parameters ───────────────────────────────────

  /** Constant latency in ms. Used when latencyModel='constant'. */
  constantLatencyMs?: number;
  /** Mean latency in ms. Used when latencyModel='distribution'. */
  meanLatencyMs?: number;
  /** StdDev of latency in ms. Used when latencyModel='distribution'. */
  stdDevLatencyMs?: number;

  /** Slippage in basis points. Used when slippageModel='proportional'. */
  slippageBps?: number;

  /**
   * Max line movement in basis points (half-spread).
   * Used when lineMovementModel='stochastic'.
   * Line can move ±lineMovementBps from intended.
   */
  lineMovementBps?: number;

  /** Rejection rate 0-1. Used when rejectionModel='probabilistic'. */
  rejectionRate?: number;
  /** Reject if stake exceeds this absolute amount. Used when rejectionModel='rule-based'. */
  rejectionMaxStake?: number;

  /**
   * Fill rate tiers by stake size.
   * Used when liquidityModel='tiered'.
   * Each tier specifies max stake up to which this fill rate applies.
   */
  liquidityTiers?: Array<{ maxStake: number; fillRate: number }>;

  /** Seed for deterministic PRNG in simulation. Default: 42. */
  randomSeed?: number;
}

// ─────────────────────────────────────────────────────────────
// SIMULATED EXECUTION
// ─────────────────────────────────────────────────────────────

/**
 * Canonical result of executing a single pick under simulated conditions.
 *
 * Design law:
 *   - intendedX fields = what was requested (historical)
 *   - executedX fields = what happened after friction was applied
 *   - Settlement truth (win/loss/push) is NEVER modified here
 */
export interface SimulatedExecution {
  /** Pick identifier. */
  pickId: string;

  /** Intended prop line at pick creation time. */
  intendedLine: number;
  /** Intended odds in American format (e.g., -110, +150). */
  intendedOdds: number;
  /** Intended stake amount in dollars. */
  intendedStake: number;

  /** Executed line after movement model applied. */
  executedLine: number;
  /** Executed odds in American format after slippage applied. */
  executedOdds: number;
  /** Executed stake = intendedStake * fillRate (0 if rejected). */
  executedStake: number;

  /** Simulated latency in milliseconds. */
  latencyMs: number;
  /** Slippage in basis points (negative = worse odds for bettor). */
  slippageBps: number;
  /** Fill rate 0.0–1.0 (1.0 = full fill, 0.0 = rejected). */
  fillRate: number;

  /** Whether the bet was rejected entirely. */
  rejected: boolean;
  /** Rejection reason if rejected=true. */
  rejectionReason?: string;

  /**
   * Implied closing line value in basis points.
   * Measured as change in decimal odds × 100.
   * Negative = execution was worse than intended (slippage / movement).
   */
  impliedCLV: number;

  /** Execution quality score 0.0–1.0 (1.0 = perfect execution). */
  executionQuality: number;
}

// ─────────────────────────────────────────────────────────────
// STRATEGY CONFIG
// ─────────────────────────────────────────────────────────────

/** Staking method for bet sizing. */
export type StakingMethod = 'flat' | 'kelly' | 'fractional_kelly' | 'custom';

/**
 * Configuration contract for a betting strategy.
 * Must be serializable for proof artifacts.
 */
export interface StrategyConfig {
  /** Unique identifier for this strategy configuration. */
  strategyId: string;
  /** Human-readable description. */
  description?: string;

  /** How to size bets. */
  stakingMethod: StakingMethod;

  /** Starting bankroll in dollars. */
  initialBankroll: number;

  /**
   * For flat/custom staking: fraction of bankroll per bet (e.g., 0.01 = 1%).
   * Ignored for kelly/fractional_kelly where Kelly formula determines fraction.
   */
  unitSize: number;

  /**
   * Kelly fraction 0-1.
   * For stakingMethod='kelly': use full Kelly (effectively 1.0).
   * For stakingMethod='fractional_kelly': fraction of full Kelly recommendation.
   * Ignored for flat staking.
   */
  kellyFraction: number;

  /** Maximum single stake as fraction of current bankroll (e.g., 0.05 = 5%). */
  maxStakeCap: number;

  /**
   * Halt simulation if bankroll drops this fraction from its peak.
   * E.g., 0.30 halts when bankroll is 30% below peak.
   */
  maxDrawdown: number;

  /**
   * Maximum fraction of bankroll wagered per calendar day.
   * E.g., 0.20 = stop placing bets once 20% of bankroll has been staked today.
   */
  maxDailyExposure: number;

  /**
   * Maximum fraction of initial bankroll staked cumulatively on
   * any single sport/player/game (correlation constraint).
   * E.g., 0.15 = max 15% of initial bankroll staked on NBA picks total.
   */
  maxCorrExposure: number;

  /** Max cumulative exposure per sport as fraction of initial bankroll. */
  maxExposurePerSport?: number;
  /** Max cumulative exposure per player as fraction of initial bankroll. */
  maxExposurePerPlayer?: number;
  /** Max cumulative exposure per game as fraction of initial bankroll. */
  maxExposurePerGame?: number;

  /**
   * Skip a bet if the calculated stake (before cap) is below this amount.
   * Prevents placing trivially small bets.
   */
  minStakeSize?: number;

  /** Pick filters applied before sizing. */
  pickFilters?: {
    /** Minimum tier to include: 'S' > 'A' > 'B' > 'C'. */
    minTier?: 'S' | 'A' | 'B' | 'C';
    /** Minimum confidence score 0-1. */
    minConfidence?: number;
    /** Whitelist of sports to include. Omit = all sports. */
    sports?: string[];
    /** Only include picks with posted_to_discord === true. Default: true. */
    requirePosted?: boolean;
  };

  /**
   * Execution simulation config.
   * If undefined, bets execute at intended odds/stakes (no friction).
   */
  executionSimConfig?: ExecutionSimConfig;
}

// ─────────────────────────────────────────────────────────────
// BANKROLL CURVE
// ─────────────────────────────────────────────────────────────

/** Type of risk event that was triggered. */
export type RiskEventType =
  | 'drawdown_halt'
  | 'exposure_limit_sport'
  | 'exposure_limit_player'
  | 'exposure_limit_daily'
  | 'correlation_limit'
  | 'min_stake_skip'
  | 'stake_capped'
  | 'execution_rejected'
  | 'not_posted'
  | 'not_settled'
  | 'filter_failed';

/**
 * A single step in the bankroll simulation timeline.
 * One row per pick considered (placed or skipped).
 */
export interface BankrollStep {
  /** Pick identifier. */
  pickId: string;
  /** ISO timestamp from pick's placed_at. */
  timestamp: string;
  /** Sport (e.g., 'NBA', 'NFL'). */
  sport?: string;
  /** Player name. */
  playerName?: string;

  /** Intended odds (American). */
  intendedOdds: number;
  /** Executed odds (American). Equals intendedOdds if no friction. */
  executedOdds: number;

  /** Stake actually placed (0 if skipped/rejected). */
  stake: number;
  /** Historical settlement result. */
  settlementResult: 'win' | 'loss' | 'push' | 'void' | 'pending';

  /** Profit/loss from this bet. */
  pnl: number;
  /** Bankroll before this bet is settled. */
  bankrollBefore: number;
  /** Bankroll after this bet is settled. */
  bankrollAfter: number;

  /** Peak bankroll seen up to this point. */
  peakBankroll: number;
  /** Current drawdown from peak (fraction 0–1). */
  drawdownFromPeak: number;

  /** Cumulative ROI up to this point (fraction). */
  cumulativeROI: number;
  /** Total amount staked up to and including this step. */
  totalStaked: number;
  /** Total PnL up to and including this step. */
  totalPnl: number;

  /** Why this bet was skipped (absent if placed). */
  skipReason?: string;
  /** Risk event type if a limit was triggered. */
  riskEventType?: RiskEventType;

  /** Execution quality score (0–1). Present if execution friction was applied. */
  executionQuality?: number;
  /** Whether execution was rejected. Present if execution friction was applied. */
  rejected?: boolean;
}

// ─────────────────────────────────────────────────────────────
// RISK & CORRELATION EVENTS
// ─────────────────────────────────────────────────────────────

/** A discrete risk event recorded during simulation. */
export interface RiskEvent {
  /** Pick that triggered the event. */
  pickId: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Type of risk enforcement triggered. */
  type: RiskEventType;
  /** Human-readable detail. */
  detail: string;
  /** Bankroll at the time of the event. */
  bankrollAtEvent: number;
}

/** A recorded correlation event (multiple picks on same sport/player/game). */
export interface CorrelationEvent {
  /** Picks involved. */
  pickIds: string[];
  /** ISO timestamp of the triggering pick. */
  timestamp: string;
  /** What was correlated. */
  correlationType: 'same_sport' | 'same_player' | 'same_game';
  /** The correlated label (e.g., 'NBA', 'LeBron James'). */
  correlationLabel: string;
  /** Total cumulative exposure on this correlation group. */
  totalExposure: number;
  /** Whether this event exceeded the configured limit. */
  limitExceeded: boolean;
  /** The configured limit that was compared against. */
  limit: number;
}

// ─────────────────────────────────────────────────────────────
// STRATEGY EVALUATION RESULT
// ─────────────────────────────────────────────────────────────

/** Complete result of a strategy evaluation run. */
export interface StrategyEvaluationResult {
  /** Strategy identifier. */
  strategyId: string;
  /** Full strategy configuration used. */
  strategyConfig: StrategyConfig;
  /** ISO timestamp when evaluation was run. */
  runAt: string;

  // ─── Pick counts ──────────────────────────────────────────
  /** Total picks from replay output that were considered (passed filters). */
  totalPicksConsidered: number;
  /** Picks where a bet was actually placed. */
  betsPlaced: number;
  /** Picks skipped due to risk limits / filters. */
  betsSkipped: number;
  /** Picks skipped due to execution rejection (requires friction). */
  betsRejected: number;

  // ─── Performance metrics ──────────────────────────────────
  /** Win rate: bets won / bets settled with result. */
  hitRate: number;
  /** Return on investment: totalPnl / totalStaked. */
  roi: number;
  /** Bankroll growth: (finalBankroll - initialBankroll) / initialBankroll. */
  bankrollGrowth: number;
  /** Final bankroll in dollars. */
  finalBankroll: number;
  /** Initial bankroll in dollars. */
  initialBankroll: number;
  /** Peak bankroll reached during simulation. */
  peakBankroll: number;
  /** Maximum drawdown from peak (fraction 0–1). */
  maxDrawdown: number;

  // ─── Execution metrics ────────────────────────────────────
  /** Average closing line value in basis points. */
  avgCLV: number;
  /** Average execution quality score 0–1. */
  avgExecutionQuality: number;

  // ─── Events ───────────────────────────────────────────────
  /** Risk events triggered during simulation. */
  riskEvents: RiskEvent[];
  /** Correlation events recorded during simulation. */
  correlationEvents: CorrelationEvent[];

  // ─── Full timeline ────────────────────────────────────────
  /** Full bankroll curve, one entry per pick considered. */
  bankrollCurve: BankrollStep[];

  // ─── Execution simulations ────────────────────────────────
  /**
   * Simulated executions for each pick.
   * Empty array if executionSimConfig was not provided.
   */
  simulatedExecutions: SimulatedExecution[];

  // ─── Halt state ───────────────────────────────────────────
  /** ISO timestamp when simulation was halted due to drawdown. Present if halted. */
  haltedAt?: string;
  /** Reason for halt. Present if halted. */
  haltReason?: string;
}

// ─────────────────────────────────────────────────────────────
// STRATEGY COMPARISON
// ─────────────────────────────────────────────────────────────

/** Delta metrics between two strategy evaluations. */
export interface StrategyDelta {
  /** ROI A - ROI B (positive = A better). */
  roi: number;
  /** Bankroll growth A - B. */
  bankrollGrowth: number;
  /** Max drawdown A - B (negative = A had less drawdown = better). */
  maxDrawdown: number;
  /** Hit rate A - B. */
  hitRate: number;
  /** Average CLV A - B. */
  avgCLV: number;
  /** Average execution quality A - B. */
  avgExecutionQuality: number;
  /** Bets placed A - B. */
  betsPlaced: number;
  /** Bets rejected A - B. */
  betsRejected: number;
  /** Final bankroll A - B. */
  finalBankroll: number;
}

/** Winner determination per metric. */
export interface StrategyWinner {
  roi: string;
  maxDrawdown: string;
  bankrollGrowth: string;
  hitRate: string;
}

/** Complete comparison report between two strategies. */
export interface StrategyComparisonReport {
  /** Unique comparison identifier. */
  comparisonId: string;
  /** ISO timestamp. */
  generatedAt: string;

  /** Strategy A evaluation. */
  strategyA: StrategyEvaluationResult;
  /** Strategy B evaluation. */
  strategyB: StrategyEvaluationResult;

  /** Numeric deltas (A minus B). */
  delta: StrategyDelta;
  /** Winner by metric ('A', 'B', or 'tie'). */
  winner: StrategyWinner;

  /** Human-readable summary of findings. */
  summary: string;
}
