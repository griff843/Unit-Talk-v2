/**
 * Market Reaction Intelligence
 *
 * Measures how betting markets move relative to model predictions.
 * Captures closing line value (CLV), reaction alignment, and movement strength.
 */

// ── Output Contract ──────────────────────────────────────────────────────────

export interface MarketReactionOutput {
  player_id: string;
  stat_type: string;

  /** Line at market open */
  open_line: number;
  /** Line at market close */
  close_line: number;
  /** Model's projected stat value */
  model_projection: number;

  /** sign(model_projection - open_line): +1 over, -1 under, 0 neutral */
  model_direction: -1 | 0 | 1;
  /** sign(close_line - open_line): +1 moved up, -1 moved down, 0 unchanged */
  market_direction: -1 | 0 | 1;

  /** True when market moved in the same direction the model predicted */
  reaction_alignment: boolean;

  /** close_line - bet_line (positive = favorable CLV) */
  clv_value: number;
  /** clv_value / bet_line (percentage) */
  clv_percent: number;

  /** abs(close_line - open_line) — magnitude of market movement */
  reaction_strength: number;
}

export type MarketReactionResult =
  | { ok: true; data: MarketReactionOutput }
  | { ok: false; reason: string };

// ── Input ────────────────────────────────────────────────────────────────────

export interface MarketReactionInput {
  player_id: string;
  stat_type: string;
  open_line: number;
  close_line: number;
  model_projection: number;
  /** Line at which the bet was placed (defaults to open_line) */
  bet_line?: number;
}

// ── Core Computation ─────────────────────────────────────────────────────────

export function computeMarketReaction(input: MarketReactionInput): MarketReactionResult {
  const { player_id, stat_type, open_line, close_line, model_projection } = input;
  const betLine = input.bet_line ?? open_line;

  if (open_line < 0) {
    return { ok: false, reason: `Invalid open_line: ${open_line} (must be >= 0)` };
  }
  if (close_line < 0) {
    return { ok: false, reason: `Invalid close_line: ${close_line} (must be >= 0)` };
  }
  if (model_projection <= 0) {
    return { ok: false, reason: `Invalid model_projection: ${model_projection} (must be > 0)` };
  }
  if (betLine < 0) {
    return { ok: false, reason: `Invalid bet_line: ${betLine} (must be >= 0)` };
  }
  if (betLine === 0) {
    return { ok: false, reason: 'bet_line must be > 0 for CLV calculation' };
  }

  const modelDirection = sign(model_projection - open_line);
  const marketDirection = sign(close_line - open_line);

  // Alignment: both agree on direction, or market didn't move
  const reactionAlignment =
    modelDirection !== 0 && marketDirection !== 0 && modelDirection === marketDirection;

  const clvValue = round4(close_line - betLine);
  const clvPercent = round4(clvValue / betLine);

  const reactionStrength = round4(Math.abs(close_line - open_line));

  return {
    ok: true,
    data: {
      player_id,
      stat_type,
      open_line,
      close_line,
      model_projection: round4(model_projection),
      model_direction: modelDirection,
      market_direction: marketDirection,
      reaction_alignment: reactionAlignment,
      clv_value: clvValue,
      clv_percent: clvPercent,
      reaction_strength: reactionStrength,
    },
  };
}

// ── Batch Summary ────────────────────────────────────────────────────────────

export interface MarketReactionSummary {
  total: number;
  aligned_count: number;
  alignment_rate: number;
  avg_clv_value: number;
  avg_clv_percent: number;
  avg_reaction_strength: number;
  positive_clv_count: number;
  negative_clv_count: number;
}

export function summarizeMarketReactions(reactions: MarketReactionOutput[]): MarketReactionSummary {
  if (reactions.length === 0) {
    return {
      total: 0,
      aligned_count: 0,
      alignment_rate: 0,
      avg_clv_value: 0,
      avg_clv_percent: 0,
      avg_reaction_strength: 0,
      positive_clv_count: 0,
      negative_clv_count: 0,
    };
  }

  const n = reactions.length;
  const alignedCount = reactions.filter((r) => r.reaction_alignment).length;
  const avgClv = reactions.reduce((s, r) => s + r.clv_value, 0) / n;
  const avgClvPct = reactions.reduce((s, r) => s + r.clv_percent, 0) / n;
  const avgStrength = reactions.reduce((s, r) => s + r.reaction_strength, 0) / n;
  const posClv = reactions.filter((r) => r.clv_value > 0).length;
  const negClv = reactions.filter((r) => r.clv_value < 0).length;

  return {
    total: n,
    aligned_count: alignedCount,
    alignment_rate: round4(alignedCount / n),
    avg_clv_value: round4(avgClv),
    avg_clv_percent: round4(avgClvPct),
    avg_reaction_strength: round4(avgStrength),
    positive_clv_count: posClv,
    negative_clv_count: negClv,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sign(n: number): -1 | 0 | 1 {
  if (n > 0.001) return 1;
  if (n < -0.001) return -1;
  return 0;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
