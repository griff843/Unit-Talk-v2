export interface ProviderRunObservation { started_at: string; details: unknown }
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export function summarizeProviderRequests(runs: ProviderRunObservation[], provider: string) {
  const observations = runs.map((run) => ({ run, quota: record(record(run.details)['quota']) }))
    .filter(({ quota }) => quota['provider'] === provider)
    .sort((a, b) => b.run.started_at.localeCompare(a.run.started_at));
  const counted = observations.filter(({ quota }) => nonNegative(quota['requestCount']) !== null);
  const latest = observations[0];
  const limit = nonNegative(latest?.quota['limit']);
  const remaining = nonNegative(latest?.quota['remaining']);
  return {
    requests: counted.length ? counted.reduce((sum, item) => sum + nonNegative(item.quota['requestCount'])!, 0) : null,
    recordedRuns: counted.length,
    uncountedRuns: observations.length - counted.length,
    quotaPct: limit !== null && limit > 0 && remaining !== null && remaining <= limit ? Math.round(100 * (limit - remaining) / limit) : null,
    remaining, limit, quotaObservedAt: latest?.run.started_at ?? null,
  };
}
export function cycleLatency(metadata: unknown): number | null {
  return nonNegative(record(record(metadata)['latencyMs'])['total']);
}
