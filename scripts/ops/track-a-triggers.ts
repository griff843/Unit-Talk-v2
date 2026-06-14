/**
 * Track A monitor — pure trigger logic and snapshot types (UTV2-1276).
 *
 * No I/O. All Supabase / Linear access lives in `track-a-monitor.ts`; this file is
 * pure so it can be unit-tested without network or env. It encodes the report/trigger
 * conditions from `docs/06_status/proof/UTV2-1276/MONITOR_SPEC.md`.
 *
 * Read-only by construction: nothing here mutates state, certifies, or makes
 * CLV/ROI/edge claims — it only decides whether a snapshot is worth reporting.
 */

/** DEVELOPING evidence threshold for re-triggering the edge-certification evaluation. */
export const DEVELOPING_THRESHOLD = 50;

/** Hours of silence after which a heartbeat report is emitted. */
export const HEARTBEAT_HOURS = 24;

/**
 * One monitor reading. All fields are counts/statuses — never derived edge claims.
 *
 * Eligibility note: `wellFormedPending/SettledPlayerProps` count player-prop picks
 * that carry a `participant_id` (well-formed). Strict CLV-eligibility additionally
 * requires event-context resolution, which the orphan-generator investigation
 * (UTV2-1275) addresses; this monitor cannot yet measure that precisely, so these
 * fields are reported as leading indicators, not as CLV-eligible certifications.
 */
export interface TrackASnapshot {
  capturedAt: string;
  /** Threshold metric: settled+graded picks joined to a NATIVE (non-backfill) closing_for_clv snapshot. */
  settledClvPathNative: number;
  closingForClvTotal: number;
  closingForClvBackfilled: number;
  /** total - backfilled; genuine forward-flow capture rows. */
  closingForClvNative: number;
  wellFormedPendingPlayerProps: number;
  wellFormedSettledPlayerProps: number;
  clvComputed: number;
  clvMissingEventContext: number;
  clvMissingClosingLine: number;
  suppressPicks: number;
  /** Best-effort delivery-activity proxy; null when not queried. Never used to enable delivery. */
  publicDiscordRecentPosts: number | null;
  /** Non-empty when a read query failed — treated as a blocker. */
  errors: string[];
}

export interface TriggerInput {
  current: TrackASnapshot;
  /** Last reported snapshot (from the prior monitor comment), or null on first run. */
  previous: TrackASnapshot | null;
  /** Hours since the last reported comment, or null if never / unknown. */
  hoursSinceLastReport: number | null;
}

export interface TriggerResult {
  shouldReport: boolean;
  isHeartbeat: boolean;
  isBaseline: boolean;
  reasons: string[];
  recommendation: string;
}

/**
 * Decide whether the current snapshot warrants a report, and what to recommend.
 * Movement triggers fire only on INCREASE vs the last reported snapshot, so a
 * steady-state pipeline does not spam — the 24h heartbeat covers quiet periods.
 */
export function evaluateTriggers(input: TriggerInput): TriggerResult {
  const { current, previous, hoursSinceLastReport } = input;
  const reasons: string[] = [];

  // Blocker: any read error this run.
  if (current.errors.length > 0) {
    reasons.push(`blocker: ${current.errors.length} read error(s) — ${current.errors.join('; ')}`);
  }

  // First run: establish a baseline.
  if (previous === null) {
    return {
      shouldReport: true,
      isHeartbeat: false,
      isBaseline: true,
      reasons: ['baseline snapshot established', ...reasons],
      recommendation: recommend(current),
    };
  }

  // Threshold: settled CLV-path crosses the DEVELOPING bar.
  if (current.settledClvPathNative >= DEVELOPING_THRESHOLD) {
    reasons.push(
      `settled CLV-path ${current.settledClvPathNative} ≥ ${DEVELOPING_THRESHOLD} (DEVELOPING threshold met)`,
    );
  }

  // Movement: first/again forward-flow CLV evidence.
  if (current.settledClvPathNative > previous.settledClvPathNative) {
    reasons.push(
      `settled CLV-path increased ${previous.settledClvPathNative} → ${current.settledClvPathNative}`,
    );
  }

  // Movement: new native (non-backfill) closing_for_clv capture row(s).
  if (current.closingForClvNative > previous.closingForClvNative) {
    reasons.push(
      `new native closing_for_clv row(s): ${previous.closingForClvNative} → ${current.closingForClvNative}`,
    );
  }

  // Movement: new eligible player-prop settlement(s).
  if (current.wellFormedSettledPlayerProps > previous.wellFormedSettledPlayerProps) {
    reasons.push(
      `new well-formed player-prop settlement(s): ${previous.wellFormedSettledPlayerProps} → ${current.wellFormedSettledPlayerProps}`,
    );
  }

  // Heartbeat: nothing fired, but 24h of silence has elapsed.
  let isHeartbeat = false;
  if (
    reasons.length === 0 &&
    hoursSinceLastReport !== null &&
    hoursSinceLastReport >= HEARTBEAT_HOURS
  ) {
    isHeartbeat = true;
    reasons.push(`${HEARTBEAT_HOURS}h heartbeat — no eligible movement since last report`);
  }

  return {
    shouldReport: reasons.length > 0,
    isHeartbeat,
    isBaseline: false,
    reasons,
    recommendation: recommend(current),
  };
}

/** Exact next recommendation. Never certifies; only points at the next safe step. */
export function recommend(s: TrackASnapshot): string {
  if (s.errors.length > 0) return 'escalate blocker — monitor read failed, investigate before next cycle';
  if (s.settledClvPathNative >= DEVELOPING_THRESHOLD) {
    return 'recommend re-trigger of the edge-certification (UTV2-1042) evidence evaluation — PM authorizes the actual proof run';
  }
  return 'continue monitoring — settled CLV-path below DEVELOPING threshold';
}
