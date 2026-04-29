import type {
  IngestorRepositoryBundle,
  ProviderCycleFreshnessStatus,
  ProviderCycleProofStatus,
  ProviderCycleStageStatus,
  ProviderOfferUpsertInput,
} from '@unit-talk/db';

export type ProviderOfferStagingMode =
  | 'off'
  | 'stage_only'
  | 'stage_and_merge_verified';

export const PROVISIONAL_PROVIDER_OFFER_IDENTITY_STRATEGY =
  'provider_event_market_participant_book' as const;

export interface ProviderOfferFreshnessGateInput {
  snapshotAt: string;
  now?: string;
  maxAgeMs: number;
}

export interface ProviderOfferFreshnessGateResult {
  status: ProviderCycleFreshnessStatus;
  ageMs: number | null;
}

export interface StageProviderOfferCycleOptions {
  repositories: Pick<IngestorRepositoryBundle, 'providerOffers'>;
  runId: string;
  providerKey: string;
  league: string;
  snapshotAt: string;
  now?: string;
  offers: ProviderOfferUpsertInput[];
  mode: ProviderOfferStagingMode;
  freshnessMaxAgeMs: number;
  proofStatus?: ProviderCycleProofStatus;
}

export interface StageProviderOfferCycleResult {
  mode: ProviderOfferStagingMode;
  stageStatus: ProviderCycleStageStatus;
  freshnessStatus: ProviderCycleFreshnessStatus;
  proofStatus: ProviderCycleProofStatus;
  stagedCount: number;
  mergedCount: number;
  duplicateCount: number;
}

export function parseProviderOfferStagingMode(
  value: string | undefined,
): ProviderOfferStagingMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'stage_only') return 'stage_only';
  if (normalized === 'stage_and_merge_verified') {
    return 'stage_and_merge_verified';
  }
  return 'off';
}

export function evaluateProviderOfferFreshnessGate(
  input: ProviderOfferFreshnessGateInput,
): ProviderOfferFreshnessGateResult {
  const snapshotMs = Date.parse(input.snapshotAt);
  if (!Number.isFinite(snapshotMs)) {
    return {
      status: 'invalid_snapshot',
      ageMs: null,
    };
  }

  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const ageMs = nowMs - snapshotMs;
  if (!Number.isFinite(nowMs) || ageMs < 0) {
    return {
      status: 'invalid_snapshot',
      ageMs: null,
    };
  }

  return {
    status: ageMs > input.maxAgeMs ? 'stale' : 'fresh',
    ageMs,
  };
}

export function buildProviderOfferIdentityKey(
  offer: Pick<
    ProviderOfferUpsertInput,
    | 'providerKey'
    | 'providerEventId'
    | 'providerMarketKey'
    | 'providerParticipantId'
    | 'bookmakerKey'
  >,
  strategy = PROVISIONAL_PROVIDER_OFFER_IDENTITY_STRATEGY,
) {
  if (strategy !== PROVISIONAL_PROVIDER_OFFER_IDENTITY_STRATEGY) {
    throw new Error(`Unsupported provider offer identity strategy: ${strategy}`);
  }

  // UTV2-771 provisional approval currently scopes identity to provider/event/
  // market/participant/book only. Sport, line, and taxonomy normalization remain
  // explicit follow-up decisions and must not be silently inferred here.
  return [
    offer.providerKey,
    offer.providerEventId,
    offer.providerMarketKey,
    offer.providerParticipantId ?? '',
    offer.bookmakerKey ?? '',
  ].join(':');
}

export async function stageProviderOfferCycle(
  options: StageProviderOfferCycleOptions,
): Promise<StageProviderOfferCycleResult> {
  const proofStatus = options.proofStatus ?? 'required';

  if (options.mode === 'off') {
    return {
      mode: 'off',
      stageStatus: 'pending',
      freshnessStatus: 'unknown',
      proofStatus,
      stagedCount: 0,
      mergedCount: 0,
      duplicateCount: 0,
    };
  }

  const stageResult = await options.repositories.providerOffers.stageBatch(
    options.offers.map((offer) => ({
      ...offer,
      runId: options.runId,
      league: options.league,
      identityKey: buildProviderOfferIdentityKey(offer),
    })),
  );

  const freshness = evaluateProviderOfferFreshnessGate({
    snapshotAt: options.snapshotAt,
    ...(options.now ? { now: options.now } : {}),
    maxAgeMs: options.freshnessMaxAgeMs,
  });

  if (options.mode === 'stage_only') {
    await options.repositories.providerOffers.upsertCycleStatus({
      runId: options.runId,
      providerKey: options.providerKey,
      league: options.league,
      cycleSnapshotAt: options.snapshotAt,
      stageStatus: 'staged',
      freshnessStatus: freshness.status,
      proofStatus,
      stagedCount: stageResult.stagedCount,
      duplicateCount: stageResult.duplicateCount,
      metadata: {
        mode: options.mode,
      },
    });

    return {
      mode: options.mode,
      stageStatus: 'staged',
      freshnessStatus: freshness.status,
      proofStatus,
      stagedCount: stageResult.stagedCount,
      mergedCount: 0,
      duplicateCount: stageResult.duplicateCount,
    };
  }

  if (freshness.status !== 'fresh') {
    await options.repositories.providerOffers.upsertCycleStatus({
      runId: options.runId,
      providerKey: options.providerKey,
      league: options.league,
      cycleSnapshotAt: options.snapshotAt,
      stageStatus: 'merge_blocked',
      freshnessStatus: freshness.status,
      proofStatus,
      stagedCount: stageResult.stagedCount,
      duplicateCount: stageResult.duplicateCount,
      lastError: `Freshness gate blocked merge with status=${freshness.status}`,
      metadata: {
        mode: options.mode,
        gate: 'freshness',
      },
    });

    return {
      mode: options.mode,
      stageStatus: 'merge_blocked',
      freshnessStatus: freshness.status,
      proofStatus,
      stagedCount: stageResult.stagedCount,
      mergedCount: 0,
      duplicateCount: stageResult.duplicateCount,
    };
  }

  if (proofStatus !== 'verified' && proofStatus !== 'waived') {
    await options.repositories.providerOffers.upsertCycleStatus({
      runId: options.runId,
      providerKey: options.providerKey,
      league: options.league,
      cycleSnapshotAt: options.snapshotAt,
      stageStatus: 'merge_blocked',
      freshnessStatus: freshness.status,
      proofStatus,
      stagedCount: stageResult.stagedCount,
      duplicateCount: stageResult.duplicateCount,
      lastError: `Replay proof blocked merge with proof_status=${proofStatus}`,
      metadata: {
        mode: options.mode,
        gate: 'replay_proof',
      },
    });

    return {
      mode: options.mode,
      stageStatus: 'merge_blocked',
      freshnessStatus: freshness.status,
      proofStatus,
      stagedCount: stageResult.stagedCount,
      mergedCount: 0,
      duplicateCount: stageResult.duplicateCount,
    };
  }

  const mergeResult = await options.repositories.providerOffers.mergeStagedCycle({
    runId: options.runId,
    maxRows: stageResult.totalProcessed,
    identityStrategy: PROVISIONAL_PROVIDER_OFFER_IDENTITY_STRATEGY,
  });

  await options.repositories.providerOffers.upsertCycleStatus({
    runId: options.runId,
    providerKey: options.providerKey,
    league: options.league,
    cycleSnapshotAt: options.snapshotAt,
    stageStatus: 'merged',
    freshnessStatus: freshness.status,
    proofStatus,
    stagedCount: stageResult.stagedCount,
    mergedCount: mergeResult.mergedCount,
    duplicateCount: mergeResult.duplicateCount + stageResult.duplicateCount,
    metadata: {
      mode: options.mode,
    },
  });

  return {
    mode: options.mode,
    stageStatus: 'merged',
    freshnessStatus: freshness.status,
    proofStatus,
    stagedCount: stageResult.stagedCount,
    mergedCount: mergeResult.mergedCount,
    duplicateCount: mergeResult.duplicateCount + stageResult.duplicateCount,
  };
}
