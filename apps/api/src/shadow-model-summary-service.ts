import type { PickRecord, PickRepository, SettlementRecord, SettlementRepository } from '@unit-talk/db';

export interface ShadowModelSummary {
  modelName: string;
  sport: string | null;
  totalPredictions: number;
  settledPredictions: number;
  pendingPredictions: number;
  wins: number;
  losses: number;
  pushes: number;
  avgConfidence: number | null;
  lastPredictionAt: string | null;
  lastSettledAt: string | null;
}

export interface ShadowModelSummaryResponse {
  summaries: ShadowModelSummary[];
  count: number;
}

export async function getShadowModelSummaries(
  repositories: {
    picks: PickRepository;
    settlements: SettlementRepository;
  },
  limit = 200,
): Promise<ShadowModelSummaryResponse> {
  const picks = await repositories.picks.listBySource('model-driven', limit);
  const shadowPicks = picks.filter(isRoutingShadowPick);

  const grouped = new Map<string, ShadowModelAccumulator>();
  for (const pick of shadowPicks) {
    const metadata = asRecord(pick.metadata);
    const modelName = readModelName(metadata);
    const sport = readSport(metadata);
    const key = `${modelName}::${sport ?? ''}`;
    const current = grouped.get(key) ?? createAccumulator(modelName, sport);
    grouped.set(key, current);

    current.totalPredictions += 1;
    current.lastPredictionAt = maxIso(current.lastPredictionAt, pick.created_at);
    if (typeof pick.confidence === 'number') {
      current.confidenceTotal += pick.confidence;
      current.confidenceCount += 1;
    }

    const settlement = await resolveLatestSettlement(repositories.settlements, pick.id);
    if (!settlement || settlement.status !== 'settled') {
      current.pendingPredictions += 1;
      continue;
    }

    current.settledPredictions += 1;
    current.lastSettledAt = maxIso(current.lastSettledAt, settlement.settled_at);
    if (settlement.result === 'win') {
      current.wins += 1;
    } else if (settlement.result === 'loss') {
      current.losses += 1;
    } else if (settlement.result === 'push') {
      current.pushes += 1;
    }
  }

  const summaries = Array.from(grouped.values())
    .map((summary) => ({
      modelName: summary.modelName,
      sport: summary.sport,
      totalPredictions: summary.totalPredictions,
      settledPredictions: summary.settledPredictions,
      pendingPredictions: summary.pendingPredictions,
      wins: summary.wins,
      losses: summary.losses,
      pushes: summary.pushes,
      avgConfidence:
        summary.confidenceCount > 0
          ? Number((summary.confidenceTotal / summary.confidenceCount).toFixed(4))
          : null,
      lastPredictionAt: summary.lastPredictionAt,
      lastSettledAt: summary.lastSettledAt,
    }))
    .sort(
      (left, right) =>
        (right.lastPredictionAt ?? '').localeCompare(left.lastPredictionAt ?? '') ||
        left.modelName.localeCompare(right.modelName) ||
        (left.sport ?? '').localeCompare(right.sport ?? ''),
    );

  return {
    summaries,
    count: summaries.length,
  };
}

type ShadowModelAccumulator = {
  modelName: string;
  sport: string | null;
  totalPredictions: number;
  settledPredictions: number;
  pendingPredictions: number;
  wins: number;
  losses: number;
  pushes: number;
  confidenceTotal: number;
  confidenceCount: number;
  lastPredictionAt: string | null;
  lastSettledAt: string | null;
};

function createAccumulator(modelName: string, sport: string | null): ShadowModelAccumulator {
  return {
    modelName,
    sport,
    totalPredictions: 0,
    settledPredictions: 0,
    pendingPredictions: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    confidenceTotal: 0,
    confidenceCount: 0,
    lastPredictionAt: null,
    lastSettledAt: null,
  };
}

function isRoutingShadowPick(pick: PickRecord) {
  const metadata = asRecord(pick.metadata);
  const shadowMode = asRecord(metadata?.shadowMode);
  return shadowMode?.enabled === true && shadowMode?.subsystem === 'routing';
}

function readModelName(metadata: Record<string, unknown> | null) {
  if (!metadata) {
    return 'unknown-model';
  }

  const direct = metadata.modelName;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  const model = asRecord(metadata.model);
  const nestedName = model?.name;
  if (typeof nestedName === 'string' && nestedName.trim()) {
    return nestedName.trim();
  }

  return 'unknown-model';
}

function readSport(metadata: Record<string, unknown> | null) {
  const sport = metadata?.sport;
  return typeof sport === 'string' && sport.trim() ? sport.trim() : null;
}

async function resolveLatestSettlement(
  repository: SettlementRepository,
  pickId: string,
): Promise<SettlementRecord | null> {
  const settlements = await repository.listByPick(pickId);
  return settlements[0] ?? null;
}

function maxIso(current: string | null, candidate: string) {
  if (!current) {
    return candidate;
  }
  return candidate > current ? candidate : current;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
