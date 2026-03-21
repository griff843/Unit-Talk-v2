/**
 * CLV Analyzer — Closing Line Value computation and breakdown
 *
 * Computes per-pick CLV (p_final - p_market_devig) and aggregates by market type.
 * CLV > 0 means we identified value relative to the closing market price.
 *
 * FAIL-CLOSED: Returns { ok: false, reason } when analysis cannot be performed.
 */

import type { ScoredOutcome } from '../outcomes/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CLVRecord {
  market_key: string;
  market_type_id: number;
  clv: number; // p_final - p_market_devig
  p_final: number;
  p_market_devig: number;
  outcome: 'WIN' | 'LOSS' | 'PUSH';
}

export interface CLVSliceSummary {
  n: number;
  meanCLV: number;
  stdDev: number;
  positiveCLVPct: number;
}

export interface CLVSummary {
  n: number;
  meanCLV: number;
  stdDev: number;
  positiveCLVPct: number;
  byMarketType: Record<string, CLVSliceSummary>;
}

export type CLVAnalysisResult =
  | { ok: true; summary: CLVSummary; records: CLVRecord[] }
  | { ok: false; reason: string; n: number };

// ── Constants ───────────────────────────────────────────────────────────────

export const MIN_CLV_SAMPLE = 10;

// ── Core Function ───────────────────────────────────────────────────────────

/**
 * Compute CLV for each scored outcome and aggregate into a summary.
 *
 * CLV = p_final - p_market_devig
 *   Positive: model identified value vs closing market
 *   Negative: model was behind the market
 *   Zero: model matched the market
 */
export function analyzeCLV(records: ScoredOutcome[]): CLVAnalysisResult {
  if (records.length === 0) {
    return { ok: false, reason: 'EMPTY_INPUT', n: 0 };
  }

  const valid = records.filter(
    (r) =>
      Number.isFinite(r.p_final) &&
      Number.isFinite(r.p_market_devig) &&
      r.p_final > 0 &&
      r.p_final < 1 &&
      r.p_market_devig > 0 &&
      r.p_market_devig < 1,
  );

  if (valid.length < MIN_CLV_SAMPLE) {
    return {
      ok: false,
      reason: `INSUFFICIENT_VALID_RECORDS: ${valid.length} valid (need >=${MIN_CLV_SAMPLE})`,
      n: valid.length,
    };
  }

  const clvRecords: CLVRecord[] = valid.map((r) => ({
    market_key: r.market_key,
    market_type_id: r.market_type_id,
    clv: r.p_final - r.p_market_devig,
    p_final: r.p_final,
    p_market_devig: r.p_market_devig,
    outcome: r.outcome,
  }));

  const clvValues = clvRecords.map((r) => r.clv);

  return {
    ok: true,
    summary: {
      n: clvRecords.length,
      meanCLV: mean(clvValues),
      stdDev: stdDev(clvValues),
      positiveCLVPct: positivePct(clvValues),
      byMarketType: buildMarketTypeBreakdown(clvRecords),
    },
    records: clvRecords,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((a, b) => a + b, 0) / values.length, 6);
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return round(Math.sqrt(variance), 6);
}

function positivePct(values: number[]): number {
  if (values.length === 0) return 0;
  return round((values.filter((v) => v > 0).length / values.length) * 100, 2);
}

function buildMarketTypeBreakdown(records: CLVRecord[]): Record<string, CLVSliceSummary> {
  const byType = new Map<string, number[]>();

  for (const r of records) {
    const key = `mt_${r.market_type_id}`;
    const existing = byType.get(key) ?? [];
    existing.push(r.clv);
    byType.set(key, existing);
  }

  const result: Record<string, CLVSliceSummary> = {};
  for (const [key, values] of byType.entries()) {
    result[key] = {
      n: values.length,
      meanCLV: mean(values),
      stdDev: stdDev(values),
      positiveCLVPct: positivePct(values),
    };
  }
  return result;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
