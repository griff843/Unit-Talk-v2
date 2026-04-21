import { resolveOutcome, buildRecapEmbedData } from '@unit-talk/domain';
import type {
  EventRow,
  PickRecord,
  RepositoryBundle,
  SettlementRecord,
} from '@unit-talk/db';
import { atomicClaimForTransition } from '@unit-talk/db';
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
  logger?: Pick<Console, 'error' | 'warn'>;
  retryState?: GradingRetryState;
}

export type GradingRetryState = Map<
  string,
  {
    attempts: number;
    retryAfter: number;
  }
>;

const TRUSTED_GRADING_EVENT_PROVIDERS = new Set(['sgo']);
const MAX_EXPLICIT_EVENT_TIME_MISMATCH_MS = 36 * 60 * 60 * 1000;

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
    | 'outbox'
    | 'receipts'
    | 'runs'
  >,
  options: RunGradingPassOptions = {},
): Promise<GradingPassResult> {
  const picks = await repositories.picks.listByLifecycleState('posted');
  const details: GradingPickResult[] = [];
  const retryState = options.retryState;

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

      const gameLineMarket = isGameLineMarket(pick.market);
      const resolvedParticipantId = gameLineMarket
        ? null
        : await resolvePickParticipantId(pick, repositories);

      if (!gameLineMarket && !resolvedParticipantId) {
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

      const event = gameLineMarket
        ? await resolvePickEventByName(pick, repositories)
        : await resolvePickEvent(pick, resolvedParticipantId as string, repositories);

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

      const provenance = validateEventProvenanceForGrading(pick, event);
      if (!provenance.ok) {
        options.logger?.warn?.(
          `Skipping grading for pick ${pick.id}: ${provenance.reason}`,
        );
        details.push({
          pickId: pick.id,
          outcome: 'skipped',
          reason: provenance.reason,
        });
        continue;
      }

      // Normalize SGO raw provider key → canonical market_type_id if needed
      let marketKey = pick.market;
      const canonicalKey = await repositories.providerOffers.resolveCanonicalMarketKey(pick.market, 'sgo');
      if (canonicalKey) {
        marketKey = canonicalKey;
      }

      const gameResult = await repositories.gradeResults.findResult({
        eventId: event.id,
        participantId: resolvedParticipantId,
        marketKey,
      });

      if (!gameResult) {
        const now = Date.now();
        const retryEntry = retryState?.get(pick.id);
        if (retryEntry && now < retryEntry.retryAfter) {
          details.push({
            pickId: pick.id,
            outcome: 'skipped',
            reason: 'game_result_retry_pending',
          });
          continue;
        }

        const nextAttempts = (retryEntry?.attempts ?? 0) + 1;
        if (retryState && nextAttempts >= 3) {
          retryState.set(pick.id, {
            attempts: nextAttempts,
            retryAfter: now,
          });
          details.push({
            pickId: pick.id,
            outcome: 'skipped',
            reason: 'grade_skipped_final',
          });
          continue;
        }

        if (retryState) {
          retryState.set(pick.id, {
            attempts: nextAttempts,
            retryAfter: now + 15 * 60 * 1000,
          });
        }
        details.push({
          pickId: pick.id,
          outcome: 'skipped',
          reason: retryEntry ? 'game_result_retry_scheduled' : 'game_result_not_found',
        });
        continue;
      }

      retryState?.delete(pick.id);

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

      const claim = await atomicClaimForTransition(
        repositories.picks,
        pick.id,
        'posted',
        'settled',
      );
      if (!claim.claimed) {
        details.push({
          pickId: pick.id,
          outcome: 'skipped',
          reason: 'already_claimed_by_another_process',
        });
        continue;
      }

      const settlementResult = await recordGradedSettlement(
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

      await postSettlementRecapIfPossible(
        pick,
        settlementResult.settlementRecord,
        { outbox: repositories.outbox, receipts: repositories.receipts, runs: repositories.runs },
        options,
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

  const gradedCount = details.filter((detail) => detail.outcome === 'graded').length;
  const errorCount = details.filter((detail) => detail.outcome === 'error').length;

  const runRecord = await repositories.runs.startRun({
    runType: 'grading.run',
    actor: 'grading-service',
    details: { picksGraded: gradedCount, failed: errorCount },
  });
  await repositories.runs.completeRun({
    runId: runRecord.id,
    status: errorCount > 0 ? 'failed' : 'succeeded',
    details: { picksGraded: gradedCount, failed: errorCount },
  });

  return {
    attempted: picks.length,
    graded: gradedCount,
    skipped: details.filter((detail) => detail.outcome === 'skipped').length,
    errors: errorCount,
    details,
  };
}

function validateEventProvenanceForGrading(
  pick: PickRecord,
  event: EventRow,
): { ok: true } | { ok: false; reason: string } {
  if (!readNonEmptyString(event.external_id)) {
    return { ok: false, reason: 'event_provenance_missing_external_id' };
  }

  const metadata = asRecord(event.metadata);
  const provider = normalizeProviderKey(
    readNonEmptyString(metadata?.providerKey) ??
      readNonEmptyString(metadata?.provider_key) ??
      readNonEmptyString(metadata?.source),
  );
  if (!provider || !TRUSTED_GRADING_EVENT_PROVIDERS.has(provider)) {
    return { ok: false, reason: 'event_provenance_untrusted_provider' };
  }

  const ingestionCycleRunId =
    readNonEmptyString(metadata?.ingestionCycleRunId) ??
    readNonEmptyString(metadata?.ingestion_cycle_run_id) ??
    readNonEmptyString(metadata?.ingestionRunId) ??
    readNonEmptyString(metadata?.runId);
  if (!ingestionCycleRunId) {
    return { ok: false, reason: 'event_provenance_missing_ingestion_cycle' };
  }
  const ingestionSource = readNonEmptyString(metadata?.ingestionSource);
  if (ingestionSource !== 'ingestor.cycle') {
    return { ok: false, reason: 'event_provenance_invalid_ingestion_cycle' };
  }

  if (
    hasExplicitEventReferenceTime(pick) &&
    eventReferenceMismatchMs(pick, event) > MAX_EXPLICIT_EVENT_TIME_MISMATCH_MS
  ) {
    return { ok: false, reason: 'event_provenance_historical_mismatch' };
  }

  return { ok: true };
}

function normalizeProviderKey(value: string | null) {
  return value?.trim().toLowerCase() ?? null;
}

function readNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function hasExplicitEventReferenceTime(pick: PickRecord) {
  const metadata = asRecord(pick.metadata);
  return [metadata?.eventStartTime, metadata?.eventTime, metadata?.starts_at].some(
    (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
  );
}

function eventReferenceMismatchMs(pick: PickRecord, event: EventRow) {
  const referenceTime = readPickEventReferenceTime(pick);
  if (referenceTime === null) {
    return 0;
  }

  const eventTime = new Date(readEventStartTime(event)).getTime();
  return Number.isFinite(eventTime)
    ? Math.abs(eventTime - referenceTime)
    : Number.POSITIVE_INFINITY;
}

export async function postSettlementRecapIfPossible(
  pick: PickRecord,
  settlementRecord: SettlementRecord,
  repositories: Pick<RepositoryBundle, 'outbox' | 'receipts' | 'runs'>,
  options: RunGradingPassOptions,
) {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) {
    return;
  }

  const resolution = await resolveRecapChannel(pick.id, repositories);
  if (!resolution.ok) {
    options.logger?.warn?.(`Skipping recap for pick ${pick.id}: ${resolution.reason}`);
    return;
  }

  const response = await fetch(
    `https://discord.com/api/v10/channels/${resolution.channelId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [
          buildRecapEmbedData({
            market: pick.market,
            selection: pick.selection,
            result: normalizeSettlementResult(settlementRecord.result),
            stakeUnits: readStakeUnits(pick),
            profitLossUnits: computeProfitLossUnits(
              normalizeSettlementResult(settlementRecord.result),
              readStakeUnits(pick),
              pick.odds,
            ),
            clvPercent: readClvPercent(settlementRecord.payload),
            submittedBy: readSubmittedBy(pick),
          }),
        ],
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    options.logger?.warn?.(
      `Recap post failed for pick ${pick.id}: ${response.status} ${errorText}`,
    );
    return;
  }

  try {
    const runRecord = await repositories.runs.startRun({
      runType: 'recap.post',
      actor: 'grading-service',
      details: { channel: resolution.channelId, pickCount: 1 },
    });
    await repositories.runs.completeRun({
      runId: runRecord.id,
      status: 'succeeded',
      details: { channel: resolution.channelId, pickCount: 1 },
    });
  } catch {
    // recap.post observability is best-effort; don't fail the recap
  }
}

async function resolveRecapChannel(
  pickId: string,
  repositories: Pick<RepositoryBundle, 'outbox' | 'receipts'>,
): Promise<{ ok: true; channelId: string } | { ok: false; reason: string }> {
  const outboxRecord = await repositories.outbox.findLatestByPick(pickId, ['sent']);
  if (!outboxRecord) {
    return { ok: false, reason: 'no_sent_distribution_outbox' };
  }

  const receipt = await repositories.receipts.findLatestByOutboxId(
    outboxRecord.id,
    'discord.message',
  );
  if (receipt?.channel) {
    const receiptChannelId = normalizeDiscordChannelId(receipt.channel);
    if (receiptChannelId) {
      return { ok: true, channelId: receiptChannelId };
    }
  }

  const fallbackChannelId = normalizeDiscordChannelId(outboxRecord.target);
  if (fallbackChannelId) {
    return { ok: true, channelId: fallbackChannelId };
  }

  return { ok: false, reason: 'no_receipt_channel_or_resolvable_outbox_target' };
}

async function resolvePickEvent(
  pick: PickRecord,
  participantId: string,
  repositories: Pick<RepositoryBundle, 'events' | 'eventParticipants'>,
): Promise<EventRow | null> {
  const links = await repositories.eventParticipants.listByParticipant(participantId);
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

async function resolvePickParticipantId(
  pick: PickRecord,
  repositories: Pick<RepositoryBundle, 'participants'>,
): Promise<string | null> {
  if (pick.participant_id) {
    return pick.participant_id;
  }

  const metadata = asRecord(pick.metadata);
  const metadataParticipantId =
    typeof metadata?.participantId === 'string'
      ? metadata.participantId.trim()
      : typeof metadata?.playerId === 'string'
        ? metadata.playerId.trim()
        : '';
  if (metadataParticipantId) {
    const participant = await repositories.participants.findById(metadataParticipantId);
    if (participant) {
      return participant.id;
    }
  }

  const playerName = typeof metadata?.player === 'string' ? metadata.player.trim() : '';
  if (!playerName) {
    return null;
  }

  const sport = typeof metadata?.sport === 'string' ? metadata.sport.trim() : undefined;
  const candidates = await repositories.participants.listByType('player', sport);
  const matches = candidates.filter(
    (candidate) => normalizeName(candidate.display_name) === normalizeName(playerName),
  );

  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

function chooseEventForPick(pick: PickRecord, events: EventRow[]): EventRow | null {
  const metadata = asRecord(pick.metadata);
  const eventName = typeof metadata?.eventName === 'string' ? metadata.eventName.trim() : null;
  const namedCandidates = eventName
    ? events.filter((event) => event.event_name.trim().toLowerCase() === eventName.toLowerCase())
    : [];
  const eventCandidates = namedCandidates.length > 0 ? namedCandidates : events;

  if (eventCandidates.length === 0) {
    return null;
  }

  const referenceTime = readPickEventReferenceTime(pick) ?? new Date(pick.created_at).getTime();
  return (
    [...eventCandidates].sort((left, right) => {
      const leftDistance = Math.abs(new Date(readEventStartTime(left)).getTime() - referenceTime);
      const rightDistance = Math.abs(
        new Date(readEventStartTime(right)).getTime() - referenceTime,
      );
      return leftDistance - rightDistance;
    })[0] ?? null
  );
}

function readPickEventReferenceTime(pick: PickRecord): number | null {
  const metadata = asRecord(pick.metadata);
  const candidates = [metadata?.eventStartTime, metadata?.eventTime, metadata?.starts_at];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      continue;
    }
    const timestamp = new Date(candidate).getTime();
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  return null;
}

function readEventStartTime(event: EventRow) {
  const metadata = asRecord(event.metadata);
  const startsAt = metadata?.starts_at;
  return typeof startsAt === 'string' && startsAt.trim().length > 0
    ? startsAt
    : `${event.event_date}T23:59:59Z`;
}

/**
 * Game-line market keys (participant_id = null in game_results).
 * Score format for ML/spread is pending confirmation from SGO (see PROVIDER_KNOWLEDGE_BASE.md §4).
 * For now only game totals (O/U) are supported for grading; ML/spread are stored but not graded.
 */
const GAME_LINE_MARKET_KEYS = new Set(['game_total_ou']);

function isGameLineMarket(market: string): boolean {
  return GAME_LINE_MARKET_KEYS.has(market);
}

async function resolvePickEventByName(
  pick: PickRecord,
  repositories: Pick<RepositoryBundle, 'events'>,
): Promise<EventRow | null> {
  const metadata = asRecord(pick.metadata);
  const eventName = typeof metadata?.eventName === 'string' ? metadata.eventName.trim() : '';
  if (!eventName) {
    return null;
  }

  const candidates = await repositories.events.listByName(eventName);
  if (candidates.length === 0) {
    return null;
  }

  return chooseEventForPick(pick, candidates);
}

function inferSelectionSide(selection: string) {
  const normalized = selection.toLowerCase();
  if (/\bover\b/.test(normalized)) {
    return 'over' as const;
  }
  if (/\bunder\b/.test(normalized)) {
    return 'under' as const;
  }
  // Smart-form serializes picks as "Player Name O X.5" / "O X.5" with abbreviated O/U.
  // Match standalone O/U token followed by a digit (e.g. "Brunson O 28.5", "O 8").
  if (/\bO\s+\d/.test(selection) || /^O\s+\d/.test(selection)) {
    return 'over' as const;
  }
  if (/\bU\s+\d/.test(selection) || /^U\s+\d/.test(selection)) {
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

function normalizeSettlementResult(result: string | null) {
  if (result === 'win' || result === 'loss' || result === 'push') {
    return result;
  }

  throw new Error(`Unsupported settlement result for recap: ${String(result)}`);
}

function normalizeDiscordChannelId(value: string) {
  const direct = value.replace(/^discord:/, '').trim();
  if (/^\d+$/.test(direct)) {
    return direct;
  }

  const mapped = readDiscordTargetMap()[value];
  if (mapped && /^\d+$/.test(mapped)) {
    return mapped;
  }

  return null;
}

function readDiscordTargetMap() {
  const raw = process.env.UNIT_TALK_DISCORD_TARGET_MAP?.trim();
  if (!raw) {
    return {} as Record<string, string>;
  }

  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function readClvPercent(payload: unknown) {
  const record = asRecord(payload);
  const clvPercent = record?.['clvPercent'];
  return typeof clvPercent === 'number' && Number.isFinite(clvPercent) ? clvPercent : null;
}

function readSubmittedBy(pick: PickRecord) {
  const metadata = asRecord(pick.metadata);
  const capper =
    typeof metadata?.['capper'] === 'string'
      ? metadata['capper']
      : typeof metadata?.['submittedBy'] === 'string'
        ? metadata['submittedBy']
        : null;

  return capper?.trim() || 'Unit Talk';
}

function readStakeUnits(pick: PickRecord) {
  return typeof pick.stake_units === 'number' && Number.isFinite(pick.stake_units)
    ? pick.stake_units
    : null;
}

function computeProfitLossUnits(
  result: 'win' | 'loss' | 'push',
  stakeUnits: number | null,
  odds: number | null,
) {
  const stake = stakeUnits ?? 1;

  if (result === 'push') {
    return 0;
  }

  if (result === 'loss') {
    return -stake;
  }

  if (typeof odds !== 'number' || !Number.isFinite(odds) || odds === 0) {
    return stake;
  }

  return odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
