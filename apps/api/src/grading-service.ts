import { resolveOutcome } from '@unit-talk/domain';
import type { EventRow, PickRecord, RepositoryBundle } from '@unit-talk/db';
import { recordGradedSettlement } from './settlement-service.js';

export interface GradingPickResult {
  pickId: string;
  outcome: 'graded' | 'skipped' | 'error';
  result?: 'win' | 'loss' | 'push';
  reason?: string;
}

export interface GradingPassResult {
  attempted: number;
  graded: number;
  skipped: number;
  errors: number;
  details: GradingPickResult[];
}

export interface RunGradingPassOptions {
  logger?: Pick<Console, 'error'>;
}

export async function runGradingPass(
  repositories: Pick<
    RepositoryBundle,
    | 'picks'
    | 'settlements'
    | 'audit'
    | 'gradeResults'
    | 'providerOffers'
    | 'participants'
    | 'events'
    | 'eventParticipants'
  >,
  options: RunGradingPassOptions = {},
): Promise<GradingPassResult> {
  const picks = await repositories.picks.listByLifecycleState('posted');
  const details: GradingPickResult[] = [];

  for (const pick of picks) {
    try {
      const existingSettlement = await repositories.settlements.findLatestForPick(pick.id);
      if (existingSettlement) {
        details.push({
          pickId: pick.id,
          outcome: 'skipped',
          reason: 'settlement_already_exists',
        });
        continue;
      }

      if (!pick.participant_id) {
        details.push({
          pickId: pick.id,
          outcome: 'skipped',
          reason: 'missing_participant_id',
        });
        continue;
      }

      if (!Number.isFinite(pick.line ?? null)) {
        details.push({
          pickId: pick.id,
          outcome: 'skipped',
          reason: 'missing_line',
        });
        continue;
      }

      const event = await resolvePickEvent(pick, repositories);
      if (!event) {
        details.push({
          pickId: pick.id,
          outcome: 'skipped',
          reason: 'event_link_not_found',
        });
        continue;
      }

      if (event.status !== 'completed') {
        details.push({
          pickId: pick.id,
          outcome: 'skipped',
          reason: 'event_not_completed',
        });
        continue;
      }

      const gameResult = await repositories.gradeResults.findResult({
        eventId: event.id,
        participantId: pick.participant_id,
        marketKey: pick.market,
      });

      if (!gameResult) {
        details.push({
          pickId: pick.id,
          outcome: 'skipped',
          reason: 'game_result_not_found',
        });
        continue;
      }

      const selectionSide = inferSelectionSide(pick.selection);
      if (!selectionSide) {
        details.push({
          pickId: pick.id,
          outcome: 'skipped',
          reason: 'selection_side_not_supported',
        });
        continue;
      }

      const gradedResult = mapOutcomeToSettlementResult(
        selectionSide === 'over'
          ? resolveOutcome(gameResult.actual_value, pick.line as number)
          : invertOutcome(resolveOutcome(gameResult.actual_value, pick.line as number)),
      );

      await recordGradedSettlement(
        pick.id,
        gradedResult,
        {
          actualValue: gameResult.actual_value,
          marketKey: gameResult.market_key,
          eventId: gameResult.event_id,
          gameResultId: gameResult.id,
        },
        repositories,
      );

      details.push({
        pickId: pick.id,
        outcome: 'graded',
        result: gradedResult,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      options.logger?.error?.(`Grading failed for pick ${pick.id}: ${message}`);
      details.push({
        pickId: pick.id,
        outcome: 'error',
        reason: message,
      });
    }
  }

  return {
    attempted: picks.length,
    graded: details.filter((detail) => detail.outcome === 'graded').length,
    skipped: details.filter((detail) => detail.outcome === 'skipped').length,
    errors: details.filter((detail) => detail.outcome === 'error').length,
    details,
  };
}

async function resolvePickEvent(
  pick: PickRecord,
  repositories: Pick<RepositoryBundle, 'events' | 'eventParticipants'>,
): Promise<EventRow | null> {
  if (!pick.participant_id) {
    return null;
  }

  const links = await repositories.eventParticipants.listByParticipant(pick.participant_id);
  if (links.length === 0) {
    return null;
  }

  const candidateEvents = (
    await Promise.all(links.map((link) => repositories.events.findById(link.event_id)))
  ).filter((event): event is EventRow => event !== null);

  if (candidateEvents.length === 0) {
    return null;
  }

  return chooseEventForPick(pick, candidateEvents);
}

function chooseEventForPick(pick: PickRecord, events: EventRow[]): EventRow | null {
  const metadata = asRecord(pick.metadata);
  const eventName = typeof metadata?.eventName === 'string' ? metadata.eventName.trim() : null;

  if (eventName) {
    const namedMatch = events.find(
      (event) => event.event_name.trim().toLowerCase() === eventName.toLowerCase(),
    );
    if (namedMatch) {
      return namedMatch;
    }
  }

  const pickCreatedAt = new Date(pick.created_at).getTime();
  return (
    [...events].sort((left, right) => {
      const leftDistance = Math.abs(new Date(readEventStartTime(left)).getTime() - pickCreatedAt);
      const rightDistance = Math.abs(
        new Date(readEventStartTime(right)).getTime() - pickCreatedAt,
      );
      return leftDistance - rightDistance;
    })[0] ?? null
  );
}

function readEventStartTime(event: EventRow) {
  const metadata = asRecord(event.metadata);
  const startsAt = metadata?.starts_at;
  return typeof startsAt === 'string' && startsAt.trim().length > 0
    ? startsAt
    : `${event.event_date}T23:59:59Z`;
}

function inferSelectionSide(selection: string) {
  const normalized = selection.toLowerCase();
  if (/\bover\b/.test(normalized)) {
    return 'over' as const;
  }
  if (/\bunder\b/.test(normalized)) {
    return 'under' as const;
  }
  return null;
}

function invertOutcome(outcome: 'WIN' | 'LOSS' | 'PUSH') {
  if (outcome === 'WIN') {
    return 'LOSS' as const;
  }
  if (outcome === 'LOSS') {
    return 'WIN' as const;
  }
  return 'PUSH' as const;
}

function mapOutcomeToSettlementResult(outcome: 'WIN' | 'LOSS' | 'PUSH') {
  if (outcome === 'WIN') {
    return 'win' as const;
  }
  if (outcome === 'LOSS') {
    return 'loss' as const;
  }
  return 'push' as const;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
