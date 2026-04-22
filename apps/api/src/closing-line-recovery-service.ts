/**
 * Closing-Line Recovery Service
 *
 * UTV2-576 — Runs independently from the ingestor to mark is_closing=true on
 * pre-commence provider_offers rows for events that have started.
 *
 * Why this exists: the ingestor marks closing lines as part of each ingest cycle.
 * If the ingestor lags or is temporarily down, events can start without their
 * pre-commence snapshots being marked. This service provides a secondary catch-up
 * path that the API server runs on its own 5-minute cadence.
 */

import type { EventRepository, ProviderOfferRepository } from '@unit-talk/db';

export interface ClosingLineRecoveryResult {
  eventsChecked: number;
  eventsEligible: number;
  rowsMarked: number;
  durationMs: number;
}

export interface ClosingLineRecoveryOptions {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export async function runClosingLineRecovery(
  deps: {
    events: EventRepository;
    providerOffers: ProviderOfferRepository;
  },
  options: ClosingLineRecoveryOptions = {},
): Promise<ClosingLineRecoveryResult> {
  const startMs = Date.now();
  const now = new Date().toISOString();
  const logger = options.logger;

  let startedEvents: Awaited<ReturnType<typeof deps.events.listStartedBySnapshot>>;
  try {
    startedEvents = await deps.events.listStartedBySnapshot(now);
  } catch (err) {
    logger?.error?.(
      JSON.stringify({
        service: 'closing-line-recovery',
        event: 'list_started_events_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { eventsChecked: 0, eventsEligible: 0, rowsMarked: 0, durationMs: Date.now() - startMs };
  }

  const closingCandidates: Array<{ providerEventId: string; commenceTime: string }> = [];
  for (const event of startedEvents) {
    if (!event.external_id) continue;
    const meta = event.metadata as Record<string, unknown> | null;
    const startsAt = meta && typeof meta['starts_at'] === 'string' ? meta['starts_at'] : null;
    if (!startsAt) continue;
    // Only process events that have actually started (commenceTime <= now)
    if (startsAt > now) continue;
    closingCandidates.push({ providerEventId: event.external_id, commenceTime: startsAt });
  }

  if (closingCandidates.length === 0) {
    logger?.info?.(
      JSON.stringify({
        service: 'closing-line-recovery',
        event: 'run.completed',
        eventsChecked: startedEvents.length,
        eventsEligible: 0,
        rowsMarked: 0,
        durationMs: Date.now() - startMs,
      }),
    );
    return {
      eventsChecked: startedEvents.length,
      eventsEligible: 0,
      rowsMarked: 0,
      durationMs: Date.now() - startMs,
    };
  }

  let rowsMarked = 0;
  try {
    rowsMarked = await deps.providerOffers.markClosingLines(closingCandidates, now, {
      includeBookmakerKey: true,
    });
  } catch (err) {
    logger?.error?.(
      JSON.stringify({
        service: 'closing-line-recovery',
        event: 'mark_closing_lines_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      eventsChecked: startedEvents.length,
      eventsEligible: closingCandidates.length,
      rowsMarked: 0,
      durationMs: Date.now() - startMs,
    };
  }

  const durationMs = Date.now() - startMs;
  logger?.info?.(
    JSON.stringify({
      service: 'closing-line-recovery',
      event: 'run.completed',
      eventsChecked: startedEvents.length,
      eventsEligible: closingCandidates.length,
      rowsMarked,
      durationMs,
    }),
  );

  return {
    eventsChecked: startedEvents.length,
    eventsEligible: closingCandidates.length,
    rowsMarked,
    durationMs,
  };
}
