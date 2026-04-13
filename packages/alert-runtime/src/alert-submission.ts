/**
 * Alert Submission — Governed Upstream Path (Phase 7B)
 *
 * Prior to UTV2-496/512, alert detections were POSTed directly to
 * /api/submissions to create picks with source='alert-agent'. That
 * direct-submission path is retired.
 *
 * The adapter now materializes alert-worthy detections into market_universe
 * rows, making them visible to the governed downstream pipeline (board scan →
 * candidates → scoring → selection → construction → pick writer).
 *
 * The natural key uses provider_key='alert-agent' to distinguish
 * alert-derived rows from SGO-derived materializer rows.
 */

import type {
  AlertDetectionRecord,
  EventRepository,
  EventRow,
  IMarketUniverseRepository,
  MarketUniverseUpsertInput,
  ParticipantRepository,
} from '@unit-talk/db';
import { isAlertSportActive } from './alert-agent-service.js';

export interface AlertUpstreamAdapterOptions {
  enabled: boolean;
  events: Pick<EventRepository, 'findById'>;
  participants: Pick<ParticipantRepository, 'findById'>;
  marketUniverse: IMarketUniverseRepository;
  logger?: Pick<Console, 'error' | 'info'>;
  materializedKeys?: Set<string>;
}

export function createAlertUpstreamAdapter(options: AlertUpstreamAdapterOptions) {
  const materializedKeys = options.materializedKeys ?? new Set<string>();
  const logger = options.logger ?? console;

  return async (detection: AlertDetectionRecord) => {
    if (!options.enabled || detection.tier !== 'alert-worthy') {
      return;
    }

    const idempotencyKey = detection.idempotency_key;
    if (materializedKeys.has(idempotencyKey)) {
      return;
    }
    materializedKeys.add(idempotencyKey);

    try {
      const event = await options.events.findById(detection.event_id);
      if (!event) {
        logger.error(
          JSON.stringify({
            service: 'alert-agent',
            event: 'upstream_adapter.skipped',
            reason: 'event-not-found',
            detectionId: detection.id,
            eventId: detection.event_id,
          }),
        );
        return;
      }

      if (!isSystemPickEligible(detection, event)) {
        logger.info(
          JSON.stringify({
            service: 'alert-agent',
            event: 'upstream_adapter.skipped',
            reason: 'ineligible-alert-signal',
            detectionId: detection.id,
            sport: event.sport_id,
            marketType: detection.market_type,
          }),
        );
        return;
      }

      const canonicalMarketKey = buildCanonicalMarketKey(detection.market_type, event.sport_id);

      const row: MarketUniverseUpsertInput = {
        provider_key: 'alert-agent',
        provider_event_id: detection.event_id,
        provider_participant_id: detection.participant_id,
        provider_market_key: detection.market_key,
        sport_key: event.sport_id,
        league_key: event.sport_id,
        event_id: detection.event_id,
        participant_id: detection.participant_id,
        market_type_id: null,
        canonical_market_key: canonicalMarketKey,
        current_line: detection.new_line,
        current_over_odds: null,
        current_under_odds: null,
        opening_line: null,
        opening_over_odds: null,
        opening_under_odds: null,
        closing_line: null,
        closing_over_odds: null,
        closing_under_odds: null,
        fair_over_prob: null,
        fair_under_prob: null,
        is_stale: false,
        last_offer_snapshot_at: detection.current_snapshot_at,
      };

      await options.marketUniverse.upsertMarketUniverse([row]);

      logger.info(
        JSON.stringify({
          service: 'alert-agent',
          event: 'upstream_adapter.materialized',
          detectionId: detection.id,
          idempotencyKey,
          canonicalMarketKey,
          sport: event.sport_id,
        }),
      );
    } catch (error) {
      logger.error(
        JSON.stringify({
          service: 'alert-agent',
          event: 'upstream_adapter.failed',
          detectionId: detection.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };
}

export function isSystemPickEligible(
  detection: Pick<AlertDetectionRecord, 'tier' | 'market_type'>,
  event: Pick<EventRow, 'sport_id'>,
) {
  return (
    detection.tier === 'alert-worthy' &&
    isAlertSportActive(event.sport_id) &&
    detection.market_type !== 'player_prop'
  );
}

function buildCanonicalMarketKey(
  marketType: AlertDetectionRecord['market_type'],
  sport: string,
) {
  switch (marketType) {
    case 'spread':
      return `${sport.toLowerCase()}_spread`;
    case 'total':
      return `${sport.toLowerCase()}_total`;
    case 'moneyline':
      return `${sport.toLowerCase()}_moneyline`;
    default:
      return `${sport.toLowerCase()}_${marketType}`;
  }
}
