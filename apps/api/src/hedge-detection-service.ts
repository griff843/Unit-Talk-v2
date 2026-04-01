import { createHash } from 'node:crypto';
import type {
  EventRepository,
  HedgeOpportunityRecord,
  ParticipantRepository,
  RepositoryBundle,
} from '@unit-talk/db';
import {
  detectHedgeOpportunities,
  HEDGE_DETECTION_THRESHOLDS,
  type HedgeOpportunity,
} from '@unit-talk/domain';

const IDENTITY_BUCKET_MS = 5 * 60 * 1000;
const DEFAULT_LOOKBACK_MINUTES = HEDGE_DETECTION_THRESHOLDS.lookbackMinutes;

export interface HedgeAgentConfig {
  enabled: boolean;
  lookbackMinutes: number;
  dryRun: boolean;
  now?: string;
}

export interface RunHedgeDetectionPassResult {
  evaluatedGroups: number;
  opportunities: number;
  persisted: number;
  duplicateOpportunities: number;
  unresolvedEvents: number;
  persistedOpportunities: HedgeOpportunityRecord[];
}

export function loadHedgeAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): HedgeAgentConfig {
  return {
    enabled: env.HEDGE_AGENT_ENABLED !== 'false',
    lookbackMinutes: normalizePositiveInteger(
      env.HEDGE_LOOKBACK_MINUTES,
      DEFAULT_LOOKBACK_MINUTES,
    ),
    dryRun: env.HEDGE_DRY_RUN !== 'false',
  };
}

export async function runHedgeDetectionPass(
  repositories: Pick<
    RepositoryBundle,
    'events' | 'participants' | 'providerOffers' | 'hedgeOpportunities'
  >,
  config: Partial<HedgeAgentConfig> = {},
): Promise<RunHedgeDetectionPassResult> {
  const resolved = {
    ...loadHedgeAgentConfig(),
    ...config,
  };

  if (!resolved.enabled) {
    return {
      evaluatedGroups: 0,
      opportunities: 0,
      persisted: 0,
      duplicateOpportunities: 0,
      unresolvedEvents: 0,
      persistedOpportunities: [],
    };
  }

  const now = resolved.now ?? new Date().toISOString();
  const cutoff = new Date(Date.parse(now) - resolved.lookbackMinutes * 60 * 1000);
  const sinceIso = cutoff.toISOString();
  const offers = await repositories.providerOffers.listRecentOffers(sinceIso);
  const filteredOffers = offers.filter((offer) => {
    const snapshot = Date.parse(offer.snapshot_at);
    return Number.isFinite(snapshot) && snapshot <= Date.parse(now);
  });

  const persistedOpportunities: HedgeOpportunityRecord[] = [];
  let opportunities = 0;
  let persisted = 0;
  let duplicateOpportunities = 0;
  let unresolvedEvents = 0;

  const detected = detectHedgeOpportunities(filteredOffers);
  opportunities = detected.length;

  for (const opportunity of detected) {
    const resolvedContext = await resolveOpportunityContext(repositories, opportunity);
    if (!resolvedContext.eventFound) {
      unresolvedEvents += 1;
    }

    const idempotencyKey = buildIdempotencyKey({
      eventId: resolvedContext.eventId,
      participantId: resolvedContext.participantId,
      marketKey: opportunity.marketKey,
      bookmakerA: opportunity.bookmakerA,
      bookmakerB: opportunity.bookmakerB,
      type: opportunity.type,
      detectedAt: now,
    });

    const created = await repositories.hedgeOpportunities.saveOpportunity({
      idempotencyKey,
      eventId: resolvedContext.eventId,
      participantId: resolvedContext.participantId,
      marketKey: opportunity.marketKey,
      type: opportunity.type,
      priority: opportunity.priority,
      bookmakerA: opportunity.bookmakerA,
      bookmakerB: opportunity.bookmakerB,
      lineA: opportunity.lineA,
      lineB: opportunity.lineB,
      overOddsA: opportunity.overOddsA,
      underOddsB: opportunity.underOddsB,
      lineDiscrepancy: opportunity.lineDiscrepancy,
      impliedProbA: opportunity.impliedProbA,
      impliedProbB: opportunity.impliedProbB,
      totalImpliedProb: opportunity.totalImpliedProb,
      arbitragePercentage: opportunity.arbitragePercentage,
      profitPotential: opportunity.profitPotential,
      guaranteedProfit: opportunity.guaranteedProfit,
      middleGap: opportunity.middleGap,
      winProbability: opportunity.winProbability,
      metadata: resolvedContext.metadata,
      detectedAt: now,
    });

    if (!created) {
      duplicateOpportunities += 1;
      continue;
    }

    persisted += 1;
    persistedOpportunities.push(created);
  }

  return {
    evaluatedGroups: countOpportunityGroups(filteredOffers),
    opportunities,
    persisted,
    duplicateOpportunities,
    unresolvedEvents,
    persistedOpportunities,
  };
}

export async function runHedgeDetectionPassForTests(
  repositories: Pick<
    RepositoryBundle,
    'events' | 'participants' | 'providerOffers' | 'hedgeOpportunities'
  >,
  config: Partial<HedgeAgentConfig> = {},
) {
  return runHedgeDetectionPass(repositories, {
    ...loadHedgeAgentConfig(),
    ...config,
  });
}

function buildIdempotencyKey(input: {
  eventId: string | null;
  participantId: string | null;
  marketKey: string;
  bookmakerA: string;
  bookmakerB: string;
  type: HedgeOpportunity['type'];
  detectedAt: string;
}) {
  const bucket = Math.floor(Date.parse(input.detectedAt) / IDENTITY_BUCKET_MS);
  const components = [
    input.eventId ?? 'null',
    input.participantId ?? 'null',
    input.marketKey,
    input.bookmakerA,
    input.bookmakerB,
    input.type,
    String(bucket),
  ];

  return createHash('sha256').update(components.join('|')).digest('hex').slice(0, 32);
}

async function resolveOpportunityContext(
  repositories: Pick<RepositoryBundle, 'events' | 'participants'>,
  opportunity: HedgeOpportunity,
) {
  const event = await repositories.events.findByExternalId(opportunity.providerEventId);
  const participant =
    opportunity.providerParticipantId === null
      ? null
      : await repositories.participants.findByExternalId(opportunity.providerParticipantId);

  return {
    eventFound: event !== null,
    eventId: event?.id ?? null,
    participantId: participant?.id ?? null,
    metadata: buildOpportunityMetadata(opportunity, event, participant),
  };
}

function buildOpportunityMetadata(
  opportunity: HedgeOpportunity,
  event: Awaited<ReturnType<EventRepository['findByExternalId']>>,
  participant: Awaited<ReturnType<ParticipantRepository['findByExternalId']>>,
) {
  return {
    sport: event?.sport_id ?? null,
    event_name: event?.event_name ?? opportunity.providerEventId,
    participant_name: participant?.display_name ?? opportunity.providerParticipantId,
    game_date: event?.event_date ?? null,
    provider_event_id: opportunity.providerEventId,
    provider_participant_id: opportunity.providerParticipantId,
  };
}

function countOpportunityGroups(offers: Array<{ provider_event_id: string; provider_market_key: string; provider_participant_id: string | null }>) {
  const groups = new Set(
    offers.map((offer) =>
      [offer.provider_event_id, offer.provider_market_key, offer.provider_participant_id ?? 'null'].join('|'),
    ),
  );

  return groups.size;
}

function normalizePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
