import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../../../packages/db/src/database.types.js';
import { getDataClient } from './client';
import { readAllQueryPages, readAuthoritativeCount, assertQuerySucceeded } from '../query-result';
import { summarizeProviderRequests, cycleLatency, type ProviderRunObservation } from '../provider-telemetry';

// The external provider adapters currently shipped by apps/ingestor.
const PROVIDERS = ['sgo', 'odds-api'] as const;
export async function getSystemProviderTelemetry() {
  const client = await getDataClient() as SupabaseClient<Database>;
  const observedAt = new Date().toISOString();
  const since = new Date(Date.parse(observedAt) - 86_400_000).toISOString();
  const configured = Number(process.env['UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES']);
  const staleMinutes = Number.isFinite(configured) && configured > 0 ? configured : 30;
  const signal = AbortSignal.timeout(8_000);
  const problems: string[] = [];
  const runRead = readAllQueryPages<ProviderRunObservation>('provider request observations', (from, to) => client.from('system_runs')
    .select('started_at,details', { count: 'exact' }).eq('run_type', 'ingestor.cycle').gte('started_at', since)
    .order('started_at', { ascending: false }).order('id', { ascending: false }).range(from, to).abortSignal(signal))
    .catch(() => { problems.push('Request and quota observations could not be verified.'); return null; });
  const providerRead = Promise.all(PROVIDERS.map(async (provider) => {
    const scope = `provider_key.eq.${provider},provider_key.like.${provider}:%`;
    const [total, recent, latest, cycles] = await Promise.all([
      client.from('provider_offer_current').select('id', { count: 'exact', head: true }).or(scope).abortSignal(signal),
      client.from('provider_offer_current').select('id', { count: 'exact', head: true }).or(scope).gte('created_at', since).abortSignal(signal),
      client.from('provider_offer_current').select('snapshot_at').or(scope).order('snapshot_at', { ascending: false }).limit(1).abortSignal(signal),
      client.from('provider_cycle_status').select('updated_at,metadata').or(scope).gte('updated_at', since)
        .order('updated_at', { ascending: false }).limit(12).abortSignal(signal),
    ]);
    const readCount = (result: typeof total, label: string) => { try { return readAuthoritativeCount(result, label); } catch { problems.push(`${provider}: ${label} unavailable.`); return null; } };
    const totalOffers = readCount(total, 'current offer count');
    const createdOffers24h = readCount(recent, 'offers created in 24h');
    let latestOfferAt: string | null = null;
    let samples: number[] = [];
    try { assertQuerySucceeded(latest, 'latest offer'); latestOfferAt = latest.data?.[0]?.snapshot_at ?? null; } catch { problems.push(`${provider}: latest offer timestamp unavailable.`); }
    try { assertQuerySucceeded(cycles, 'cycle samples'); samples = (cycles.data ?? []).map((row) => cycleLatency(row.metadata)).filter((value): value is number => value !== null).reverse(); } catch { problems.push(`${provider}: cycle durations unavailable.`); }
    const ageMinutes = latestOfferAt ? (Date.parse(observedAt) - Date.parse(latestOfferAt)) / 60_000 : null;
    const freshness = ageMinutes === null || !Number.isFinite(ageMinutes) || ageMinutes < 0 ? 'unknown' : ageMinutes <= staleMinutes ? 'fresh' : 'stale';
    return { provider, totalOffers, createdOffers24h, latestOfferAt, samples, freshness,
      meanCycleMs: samples.length ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length) : null };
  }));
  const [runs, providers] = await Promise.all([runRead, providerRead]);
  return { observedAt, since, staleMinutes, problems, providers: providers.map((provider) => ({ ...provider,
    quota: runs === null ? null : summarizeProviderRequests(runs, provider.provider),
  })) };
}
