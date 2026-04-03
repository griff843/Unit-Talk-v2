import type { SubmissionPayload } from '@unit-talk/contracts';
import type {
  AlertDetectionRecord,
  EventRepository,
  EventRow,
  ParticipantRepository,
  ParticipantRow,
} from '@unit-talk/db';

export interface AlertSubmissionPublisherOptions {
  enabled: boolean;
  apiUrl?: string | undefined;
  apiKey?: string | undefined;
  events: Pick<EventRepository, 'findById'>;
  participants: Pick<ParticipantRepository, 'findById'>;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'error' | 'info'>;
  submittedKeys?: Set<string>;
}

export function buildAlertAgentSubmissionPayload(
  detection: AlertDetectionRecord,
  event: EventRow,
  participant: ParticipantRow | null,
): SubmissionPayload {
  return {
    source: 'alert-agent',
    submittedBy: 'system:alert-agent',
    market: buildAlertMarketString(detection.market_type, event.sport_id),
    selection: buildAlertSelection(detection, participant),
    line: detection.new_line,
    confidence: 0.65,
    eventName: event.event_name,
    metadata: {
      alertSignalIdempotencyKey: detection.idempotency_key,
      alertTier: detection.tier,
      lineChange: detection.line_change,
      bookmakerKey: detection.bookmaker_key,
      marketKey: detection.market_key,
      sport: event.sport_id,
      participantId: detection.participant_id,
    },
  };
}

export function createAlertSubmissionPublisher(options: AlertSubmissionPublisherOptions) {
  const submittedKeys = options.submittedKeys ?? new Set<string>();
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger ?? console;
  const apiUrl = normalizeApiUrl(options.apiUrl);
  const apiKey = options.apiKey?.trim();

  return async (detection: AlertDetectionRecord) => {
    if (!options.enabled || detection.tier !== 'alert-worthy' || !apiUrl) {
      return;
    }

    const idempotencyKey = detection.idempotency_key;
    if (submittedKeys.has(idempotencyKey)) {
      return;
    }
    submittedKeys.add(idempotencyKey);

    try {
      const event = await options.events.findById(detection.event_id);
      if (!event) {
        logger.error(
          JSON.stringify({
            service: 'alert-agent',
            event: 'system_pick_submission.skipped',
            reason: 'event-not-found',
            detectionId: detection.id,
            eventId: detection.event_id,
          }),
        );
        return;
      }

      const participant = detection.participant_id
        ? await options.participants.findById(detection.participant_id)
        : null;
      const payload = buildAlertAgentSubmissionPayload(detection, event, participant);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetchImpl(`${apiUrl}/api/submissions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.error(
          JSON.stringify({
            service: 'alert-agent',
            event: 'system_pick_submission.failed',
            detectionId: detection.id,
            status: response.status,
          }),
        );
        return;
      }

      logger.info(
        JSON.stringify({
          service: 'alert-agent',
          event: 'system_pick_submission.succeeded',
          detectionId: detection.id,
          idempotencyKey,
        }),
      );
    } catch (error) {
      logger.error(
        JSON.stringify({
          service: 'alert-agent',
          event: 'system_pick_submission.failed',
          detectionId: detection.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };
}

function buildAlertMarketString(
  marketType: AlertDetectionRecord['market_type'],
  sport: string,
) {
  switch (marketType) {
    case 'spread':
      return `${sport} Spread`;
    case 'total':
      return `${sport} Total`;
    case 'moneyline':
      return `${sport} Moneyline`;
    default:
      return `${sport} Player Prop`;
  }
}

function buildAlertSelection(
  detection: AlertDetectionRecord,
  participant: ParticipantRow | null,
) {
  if (detection.market_type === 'moneyline') {
    return participant?.display_name?.trim() || (detection.direction === 'up' ? 'favorite' : 'underdog');
  }

  return detection.direction === 'up' ? 'over' : 'under';
}

function normalizeApiUrl(apiUrl?: string) {
  const trimmed = apiUrl?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, '');
}
