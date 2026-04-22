import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnvironment, type AppEnv } from '@unit-talk/config';
import type { OperatorQuotaProviderSummary, OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

export function resolveProviderOfferFreshnessThresholdMinutes(
  environment: Pick<AppEnv, 'UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES'> = loadEnvironment(),
) {
  const parsed = Number.parseInt(environment.UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function createEmptyProviderHealth(snapshot: Awaited<ReturnType<OperatorRouteDependencies['provider']['getSnapshot']>>) {
  return {
    providers: [] as Array<{
      providerKey: string;
      totalRows: number;
      last24hRows: number;
      latestSnapshotAt: string | null;
      minutesSinceLastSnapshot: number | null;
      status: 'active' | 'stale' | 'absent';
    }>,
    ingestorHealth: {
      status: snapshot.ingestorHealth.status,
      lastRunAt: snapshot.ingestorHealth.lastRunAt,
    },
    staleThresholdMinutes: resolveProviderOfferFreshnessThresholdMinutes(),
    quotaSummary: {
      sgo: null as { creditsUsed: number; creditsRemaining: number | null } | null,
      oddsApi: null as { creditsUsed: number; creditsRemaining: number | null } | null,
    },
    distinctEventsLast24h: 0,
  };
}

function toQuotaSummary(provider: OperatorQuotaProviderSummary | null) {
  if (!provider) {
    return null;
  }
  return {
    creditsUsed: provider.creditsUsed,
    creditsRemaining: provider.remaining,
  };
}

/**
 * GET /api/operator/provider-health
 *
 * Burn-in provider truth surface for offer coverage and freshness.
 */
export async function handleProviderHealthRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const snapshot = await deps.provider.getSnapshot();
  const provider = deps.provider as unknown as { _supabaseClient?: unknown };
  const sgoQuota = snapshot.quotaSummary.providers.find((item) => item.provider.toLowerCase() === 'sgo') ?? null;
  const oddsQuota = snapshot.quotaSummary.providers.find((item) => item.provider.toLowerCase().startsWith('odds-api')) ?? null;
  const staleThresholdMinutes = resolveProviderOfferFreshnessThresholdMinutes();

  if (!provider._supabaseClient) {
    const empty = createEmptyProviderHealth(snapshot);
    empty.quotaSummary = {
      sgo: toQuotaSummary(sgoQuota),
      oddsApi: toQuotaSummary(oddsQuota),
    };
    writeJson(response, 200, { ok: true, data: empty });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;
  const { data, error } = await client
    .from('provider_offers')
    .select('provider_key, created_at, snapshot_at, provider_event_id');

  if (error) {
    writeJson(response, 500, {
      ok: false,
      error: { code: 'DB_ERROR', message: String(error) },
    });
    return;
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const last24hCutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const providerKeys = new Set<string>(snapshot.quotaSummary.providers.map((item) => item.provider));
  const aggregates = new Map<string, {
    totalRows: number;
    last24hRows: number;
    latestSnapshotMs: number | null;
  }>();
  const distinctEvents = new Set<string>();

  for (const row of rows) {
    const providerKey = asString(row['provider_key']) ?? 'unknown';
    providerKeys.add(providerKey);

    const createdAtMs = Date.parse(asString(row['created_at']) ?? '');
    const snapshotAtRaw = asString(row['snapshot_at']);
    const snapshotAtMs = snapshotAtRaw ? Date.parse(snapshotAtRaw) : Number.NaN;
    const providerEventId = asString(row['provider_event_id']);

    const existing = aggregates.get(providerKey) ?? {
      totalRows: 0,
      last24hRows: 0,
      latestSnapshotMs: null,
    };
    existing.totalRows += 1;
    if (Number.isFinite(createdAtMs) && createdAtMs >= last24hCutoffMs) {
      existing.last24hRows += 1;
      if (providerEventId) {
        distinctEvents.add(providerEventId);
      }
    }
    if (Number.isFinite(snapshotAtMs)) {
      existing.latestSnapshotMs = existing.latestSnapshotMs == null
        ? snapshotAtMs
        : Math.max(existing.latestSnapshotMs, snapshotAtMs);
    }
    aggregates.set(providerKey, existing);
  }

  const providers = Array.from(providerKeys)
    .sort((left, right) => left.localeCompare(right))
    .map((providerKey) => {
      const aggregate = aggregates.get(providerKey) ?? {
        totalRows: 0,
        last24hRows: 0,
        latestSnapshotMs: null,
      };
      const minutesSinceLastSnapshot = aggregate.latestSnapshotMs == null
        ? null
        : Math.max(0, Math.floor((Date.now() - aggregate.latestSnapshotMs) / 60000));
      const status: 'active' | 'stale' | 'absent' =
        aggregate.latestSnapshotMs == null || aggregate.totalRows === 0
          ? 'absent'
          : minutesSinceLastSnapshot != null && minutesSinceLastSnapshot <= staleThresholdMinutes
            ? 'active'
            : minutesSinceLastSnapshot != null && minutesSinceLastSnapshot <= staleThresholdMinutes * 12
              ? 'stale'
              : 'absent';

      return {
        providerKey,
        totalRows: aggregate.totalRows,
        last24hRows: aggregate.last24hRows,
        latestSnapshotAt: aggregate.latestSnapshotMs == null
          ? null
          : new Date(aggregate.latestSnapshotMs).toISOString(),
        minutesSinceLastSnapshot,
        status,
      };
    });

  writeJson(response, 200, {
    ok: true,
    data: {
      providers,
      ingestorHealth: {
        status: snapshot.ingestorHealth.status,
        lastRunAt: snapshot.ingestorHealth.lastRunAt,
      },
      staleThresholdMinutes,
      quotaSummary: {
        sgo: toQuotaSummary(sgoQuota),
        oddsApi: toQuotaSummary(oddsQuota),
      },
      distinctEventsLast24h: distinctEvents.size,
    },
  });
}
