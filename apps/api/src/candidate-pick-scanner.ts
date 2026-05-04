/**
 * Candidate Pick Scanner — Phase 5 governed bridge
 *
 * Finds pick_candidates that are qualified, scored, and not yet linked to a pick.
 * For each: builds a SubmissionPayload from market_universe data, calls processSubmission,
 * applies the Phase 7A governance brake (→ awaiting_approval), then links pick_id.
 *
 * Gate: SYNDICATE_MACHINE_ENABLED=true (default: false)
 * Source: 'system-pick-scanner' — in GOVERNANCE_BRAKE_SOURCES, so all created picks
 * land in awaiting_approval and require operator approval before routing.
 *
 * UTV2-757
 */

import { applyDevig, americanToImplied, evaluateProviderDataFreshness } from '@unit-talk/domain';
import { transitionPickLifecycle } from '@unit-talk/db';
import type {
  AuditLogRepository,
  EventRepository,
  IMarketUniverseRepository,
  IPickCandidateRepository,
  ParticipantRepository,
  PickRepository,
  ProviderOfferRepository,
  SubmissionRepository,
} from '@unit-talk/db';
import { processSubmission } from './submission-service.js';

export interface CandidatePickScanResult {
  scanned: number;
  submitted: number;
  skipped: number;
  errors: number;
}

export async function runCandidatePickScan(
  repos: {
    pickCandidates: IPickCandidateRepository;
    marketUniverse: IMarketUniverseRepository;
    picks: PickRepository;
    submissions: SubmissionRepository;
    audit: AuditLogRepository;
    participants: ParticipantRepository;
    events: EventRepository;
    providerOffers: ProviderOfferRepository;
  },
  options: { maxPerRun?: number; logger?: Pick<Console, 'info' | 'warn' | 'error'> } = {},
): Promise<CandidatePickScanResult> {
  const maxPerRun = options.maxPerRun ?? 20;
  const logger = options.logger;

  const allQualified = await repos.pickCandidates.findByStatus('qualified');
  const candidates = allQualified
    .filter((c) => c.model_score !== null && c.pick_id === null)
    .slice(0, maxPerRun);

  if (candidates.length === 0) {
    return { scanned: 0, submitted: 0, skipped: 0, errors: 0 };
  }

  const universeIds = candidates.map((c) => c.universe_id);
  const universeRows = await repos.marketUniverse.findByIds(universeIds);
  const universeMap = new Map(universeRows.map((u) => [u.id, u]));

  let submitted = 0;
  let skipped = 0;
  let errors = 0;

  for (const candidate of candidates) {
    if (candidate.pick_id !== null) {
      skipped++;
      continue;
    }

    const universe = universeMap.get(candidate.universe_id);
    if (!universe) {
      skipped++;
      continue;
    }

    // UTV2-775: Re-read market_universe.is_stale at scan time before submitting.
    // A universe row can become stale between board-scan and candidate-scanner runs.
    // If stale at scan time: skip (do NOT submit), increment skipped, update provenance.
    const freshUniverseRows = await repos.marketUniverse.findByIds([universe.id]);
    const freshUniverse = freshUniverseRows[0];
    if (freshUniverse?.is_stale === true) {
      skipped++;
      const staleCheckedAt = new Date().toISOString();
      logger?.warn?.(
        JSON.stringify({
          service: 'candidate-pick-scanner',
          event: 'candidate_skipped',
          candidateId: candidate.id,
          universeId: universe.id,
          reason: 'stale_at_scan_time',
        }),
      );
      // Update candidate provenance with stale metadata (§9B of UTV2-775 contract)
      const existingProvenance = (candidate.provenance as Record<string, unknown> | null) ?? {};
      const defaultFilterDetails = {
        missing_canonical_identity: false,
        stale_price_data: false,
        unsupported_market_family: false,
        missing_participant_linkage: false,
        invalid_odds_structure: false,
        duplicate_suppressed: false,
        freshness_window_failed: false,
      };
      await repos.pickCandidates.upsertCandidates([{
        universe_id: universe.id,
        status: candidate.status ?? 'qualified',
        rejection_reason: candidate.rejection_reason ?? null,
        filter_details: candidate.filter_details ?? defaultFilterDetails,
        scan_run_id: candidate.scan_run_id ?? null,
        provenance: {
          ...existingProvenance,
          stale_at_scan_time: true,
          stale_reason: 'stale_at_scan_time',
          stale_checked_at: staleCheckedAt,
        },
        expires_at: candidate.expires_at ?? null,
        sport_key: candidate.sport_key ?? null,
      }]);
      continue;
    }

    const unsupportedReason = readUnsupportedGeneratedPickReason(universe);
    if (unsupportedReason) {
      skipped++;
      logger?.warn?.(
        JSON.stringify({
          service: 'candidate-pick-scanner',
          event: 'candidate_skipped',
          candidateId: candidate.id,
          universeId: universe.id,
          reason: unsupportedReason,
          marketKey: universe.canonical_market_key,
          marketTypeId: universe.market_type_id,
        }),
      );
      continue;
    }

    const overOdds = universe.current_over_odds;
    const underOdds = universe.current_under_odds;
    if (!Number.isFinite(overOdds) || !Number.isFinite(underOdds)) {
      skipped++;
      continue;
    }

    const devigged = applyDevig(
      americanToImplied(overOdds as number),
      americanToImplied(underOdds as number),
      'proportional',
    );
    if (!devigged) {
      skipped++;
      continue;
    }

    const side = devigged.overFair >= devigged.underFair ? 'over' : 'under';
    const odds = side === 'over' ? (overOdds as number) : (underOdds as number);
    const line = universe.current_line ?? null;

    // Resolve event starts_at from candidate provenance (set by board-scan) or skip lookup
    const candidateProvenance = (candidate.provenance as Record<string, unknown> | null) ?? {};
    const provenanceEventStartsAt = typeof candidateProvenance['event_starts_at'] === 'string'
      ? candidateProvenance['event_starts_at']
      : null;

    // Compute freshness metadata for picks.metadata (§9C of UTV2-775 contract)
    const freshnessInfo = evaluateProviderDataFreshness({
      snapshotAt: universe.last_offer_snapshot_at,
      eventStartsAt: provenanceEventStartsAt,
      sportKey: universe.sport_key,
      marketKey: universe.canonical_market_key,
    });

    const payload = {
      source: 'system-pick-scanner' as const,
      submittedBy: 'system:candidate-pick-scanner',
      market: universe.canonical_market_key,
      selection: side,
      ...(line !== null ? { line } : {}),
      odds,
      confidence: side === 'over' ? devigged.overFair : devigged.underFair,
      metadata: {
        candidateId: candidate.id,
        scoredCandidateId: candidate.id,
        universeId: universe.id,
        marketUniverseId: universe.id,
        modelScore: candidate.model_score,
        modelTier: candidate.model_tier,
        sportKey: universe.sport_key,
        leagueKey: universe.league_key,
        providerKey: universe.provider_key,
        providerEventId: universe.provider_event_id,
        providerMarketKey: universe.provider_market_key,
        ...(universe.event_id ? { eventId: universe.event_id } : {}),
        ...(universe.participant_id ? { participantId: universe.participant_id } : {}),
        ...(universe.market_type_id ? { marketTypeId: universe.market_type_id } : {}),
        ...(universe.provider_participant_id
          ? { providerParticipantId: universe.provider_participant_id }
          : {}),
        systemGenerated: true,
        // UTV2-775: staleness metadata recorded at submission time (§9C)
        snapshot_age_ms: freshnessInfo.snapshotAgeMs,
        snapshot_at: universe.last_offer_snapshot_at,
        proximity_tier: freshnessInfo.proximityTier,
        data_freshness: 'fresh' as const,
      },
    };

    let pickId: string;
    try {
      const result = await processSubmission(payload, {
        submissions: repos.submissions,
        picks: repos.picks,
        audit: repos.audit,
        providerOffers: repos.providerOffers,
        participants: repos.participants,
        events: repos.events,
      });
      pickId = result.pickRecord.id;
    } catch (err) {
      errors++;
      logger?.error?.(
        JSON.stringify({
          service: 'candidate-pick-scanner',
          event: 'pick_create_failed',
          candidateId: candidate.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      continue;
    }

    // Apply governance brake — system-pick-scanner is in GOVERNANCE_BRAKE_SOURCES,
    // so picks must land in awaiting_approval before any distribution is allowed.
    try {
      await transitionPickLifecycle(
        repos.picks,
        pickId,
        'awaiting_approval',
        `governance brake: non-human source system-pick-scanner`,
        'promoter',
      );
    } catch (brakeErr) {
      errors++;
      try {
        await transitionPickLifecycle(
          repos.picks,
          pickId,
          'voided',
          `governance-brake-failed: ${brakeErr instanceof Error ? brakeErr.message : String(brakeErr)}`,
          'operator_override',
        );
      } catch (voidErr) {
        logger?.error?.(
          JSON.stringify({
            service: 'candidate-pick-scanner',
            event: 'governance_brake_void_failed',
            pickId,
            candidateId: candidate.id,
            error: voidErr instanceof Error ? voidErr.message : String(voidErr),
          }),
        );
      }
      logger?.error?.(
        JSON.stringify({
          service: 'candidate-pick-scanner',
          event: 'governance_brake_failed',
          pickId,
          candidateId: candidate.id,
          error: brakeErr instanceof Error ? brakeErr.message : String(brakeErr),
        }),
      );
      continue;
    }

    // Link pick_id immediately — per-row, not deferred, to minimize idempotency window.
    try {
      await repos.pickCandidates.updatePickIdBatch([{ id: candidate.id, pick_id: pickId }]);
    } catch (linkErr) {
      errors++;
      logger?.error?.(
        JSON.stringify({
          service: 'candidate-pick-scanner',
          event: 'link_pick_id_failed',
          pickId,
          candidateId: candidate.id,
          error: linkErr instanceof Error ? linkErr.message : String(linkErr),
        }),
      );
      continue;
    }

    submitted++;
    logger?.info?.(
      JSON.stringify({
        service: 'candidate-pick-scanner',
        event: 'pick_submitted',
        pickId,
        candidateId: candidate.id,
        side,
        marketKey: universe.canonical_market_key,
      }),
    );
  }

  logger?.info?.(
    JSON.stringify({
      service: 'candidate-pick-scanner',
      event: 'scan.completed',
      scanned: candidates.length,
      submitted,
      skipped,
      errors,
    }),
  );

  return { scanned: candidates.length, submitted, skipped, errors };
}

function readUnsupportedGeneratedPickReason(universe: {
  canonical_market_key: string;
  market_type_id: string | null;
  participant_id: string | null;
  current_line: number | null;
}): string | null {
  const marketKey = universe.canonical_market_key;
  const marketTypeId = universe.market_type_id ?? '';
  const isOverUnderMarket =
    marketKey.endsWith('-all-game-ou') ||
    marketKey === 'game_total_ou' ||
    marketKey === 'team_total_ou' ||
    marketTypeId.endsWith('_ou') ||
    marketTypeId === 'game_total_ou' ||
    marketTypeId === 'team_total_ou';

  if (!isOverUnderMarket) {
    return 'unsupported_market_family';
  }

  if (!Number.isFinite(universe.current_line)) {
    return 'missing_line';
  }

  const participantRequired =
    marketKey !== 'game_total_ou' &&
    marketTypeId !== 'game_total_ou';
  if (participantRequired && !universe.participant_id) {
    return 'missing_participant_id';
  }

  return null;
}
