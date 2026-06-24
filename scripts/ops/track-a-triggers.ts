/**
 * Track A monitor — pure trigger logic and snapshot types (UTV2-1276, UTV2-1278).
 *
 * No I/O. All Supabase / Linear access lives in `track-a-monitor.ts`; this file is
 * pure so it can be unit-tested without network or env. It encodes the report/trigger
 * conditions from `docs/06_status/proof/UTV2-1276/MONITOR_SPEC.md`.
 *
 * Read-only by construction: nothing here mutates state, certifies, or makes
 * CLV/ROI/edge claims — it only decides whether a snapshot is worth reporting.
 *
 * UTV2-1278 additions: front-of-funnel ingestion signals — stale price rejection share,
 * provider offer freshness, and player-prop coverage per upcoming event.
 */

/** DEVELOPING evidence threshold for re-triggering the edge-certification evaluation. */
export const DEVELOPING_THRESHOLD = 50;

/** Hours of silence after which a heartbeat report is emitted. */
export const HEARTBEAT_HOURS = 24;

/**
 * Provider offer freshness threshold in minutes. Offers older than this are considered stale.
 * This mirrors the freshness gate in the candidate-pick-scanner.
 */
export const PROVIDER_FRESHNESS_THRESHOLD_MINUTES = 30;

/**
 * Fraction of candidates rejected due to stale prices above which the
 * FRONT_OF_FUNNEL_BLOCKER trigger fires (0.5 = 50%).
 */
export const STALE_PRICE_SHARE_THRESHOLD = 0.5;

/**
 * One monitor reading. All fields are counts/statuses — never derived edge claims.
 *
 * Eligibility note: `wellFormedPending/SettledPlayerProps` count player-prop picks
 * that carry a `participant_id` (well-formed). Strict CLV-eligibility additionally
 * requires event-context resolution, which the orphan-generator investigation
 * (UTV2-1275) addresses; this monitor cannot yet measure that precisely, so these
 * fields are reported as leading indicators, not as CLV-eligible certifications.
 *
 * UTV2-1278 additions (front-of-funnel signals):
 *   - stalePriceRejections / candidatesScanned: stale-price rejection rate from candidate scanner
 *   - providerOfferMaxAgeMinutes / providerOfferMedianAgeMinutes: freshness of provider_offer_history
 *   - upcomingEventsWithPropCoverage / upcomingEventsTotal: per-event prop coverage
 *   - ingestorPropsFetched: SGO player props ingested per ingestor_cycles telemetry (null if unavailable)
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

  // --- Front-of-funnel signals (UTV2-1278) ---

  /**
   * Number of candidates rejected due to stale prices in the last scanner cycle.
   * Sourced from candidate_pick_scanner rejection telemetry (stale_price_data).
   */
  stalePriceRejections: number;

  /**
   * Total candidates scanned in the last cycle (denominator for stalePriceRejections).
   * Zero means no cycle telemetry found.
   */
  candidatesScanned: number;

  /**
   * Maximum age in minutes of provider_offer_history rows for upcoming events.
   * null when no upcoming events exist or the query failed.
   */
  providerOfferMaxAgeMinutes: number | null;

  /**
   * Median age in minutes of provider_offer_history rows for upcoming events.
   * null when no upcoming events exist or the query failed.
   */
  providerOfferMedianAgeMinutes: number | null;

  /**
   * Count of upcoming events that have at least one fresh player-prop offer
   * (age <= PROVIDER_FRESHNESS_THRESHOLD_MINUTES).
   */
  upcomingEventsWithPropCoverage: number;

  /**
   * Total upcoming events in the schedule window (denominator for prop coverage).
   * Zero means no schedule data found.
   */
  upcomingEventsTotal: number;

  /**
   * SGO player props ingested in the most recent ingestor_cycles record.
   * null when the ingestor_cycles table is unavailable or has no recent row.
   */
  ingestorPropsFetched: number | null;
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

  // Front-of-funnel trigger: stale price rejection share > 50% of candidates scanned.
  if (current.candidatesScanned > 0) {
    const staleShare = current.stalePriceRejections / current.candidatesScanned;
    if (staleShare > STALE_PRICE_SHARE_THRESHOLD) {
      const pct = (staleShare * 100).toFixed(1);
      reasons.push(
        `FRONT_OF_FUNNEL_BLOCKER: stale_price_data rejections ${current.stalePriceRejections}/${current.candidatesScanned} (${pct}%) exceeds ${STALE_PRICE_SHARE_THRESHOLD * 100}% threshold — provider offers are not fresh enough to generate candidates`,
      );
    }
  }

  // Front-of-funnel trigger: provider offer freshness exceeds threshold.
  if (
    current.providerOfferMaxAgeMinutes !== null &&
    current.providerOfferMaxAgeMinutes > PROVIDER_FRESHNESS_THRESHOLD_MINUTES
  ) {
    reasons.push(
      `PROVIDER_FRESHNESS_STALE: max provider_offer_history age ${current.providerOfferMaxAgeMinutes}min exceeds ${PROVIDER_FRESHNESS_THRESHOLD_MINUTES}min threshold (median: ${current.providerOfferMedianAgeMinutes ?? 'n/a'}min) — ingestor may be stalled`,
    );
  }

  // Front-of-funnel trigger: zero prop coverage when upcoming events exist (game day).
  if (current.upcomingEventsTotal > 0 && current.upcomingEventsWithPropCoverage === 0) {
    reasons.push(
      `NO_PROP_COVERAGE: ${current.upcomingEventsTotal} upcoming event(s) found but zero have fresh player-prop offers — SGO player prop ingestion may be failing`,
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

  // Front-of-funnel blockers take priority — forward flow cannot succeed without ingestion.
  if (s.upcomingEventsTotal > 0 && s.upcomingEventsWithPropCoverage === 0) {
    return 'investigate SGO player prop ingestion — zero prop coverage on game day blocks forward-flow CLV; check ingestor logs on Hetzner';
  }
  if (
    s.providerOfferMaxAgeMinutes !== null &&
    s.providerOfferMaxAgeMinutes > PROVIDER_FRESHNESS_THRESHOLD_MINUTES
  ) {
    return 'investigate provider offer freshness — stale offers block candidate generation; check ingestor cycle health';
  }
  if (s.candidatesScanned > 0 && s.stalePriceRejections / s.candidatesScanned > STALE_PRICE_SHARE_THRESHOLD) {
    return 'investigate stale price rejections — majority of candidates are being rejected due to stale price data; provider offer freshness must recover before CLV flow resumes';
  }

  if (s.settledClvPathNative >= DEVELOPING_THRESHOLD) {
    return 'recommend re-trigger of the edge-certification (UTV2-1042) evidence evaluation — PM authorizes the actual proof run';
  }
  return 'continue monitoring — settled CLV-path below DEVELOPING threshold';
}
