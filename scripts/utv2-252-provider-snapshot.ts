import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

type ProviderOfferRow = {
  provider_key: string | null;
  created_at: string | null;
  snapshot_at: string | null;
  provider_event_id: string | null;
};

type SystemRunRow = {
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  details: Record<string, unknown> | null;
};

type ProviderSummary = {
  providerKey: string;
  totalRows: number;
  latestCreatedAt: string | null;
  latestSnapshotAt: string | null;
  distinctEvents: number;
};

const PREFIX = '[UTV2-252]';
const SNAPSHOT_DATE = '2026-04-01';
const POST_FIX_CONTINUITY_WINDOW_HOURS = 6;
const ACTIVE_GAP_MINUTES = 30;

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const now = new Date();
  const preFixStart = new Date(`${SNAPSHOT_DATE}T00:00:00.000Z`);
  const preFixEnd = new Date(`${SNAPSHOT_DATE}T23:59:59.999Z`);
  const postFix24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const continuityWindowStart = new Date(now.getTime() - POST_FIX_CONTINUITY_WINDOW_HOURS * 60 * 60 * 1000);

  const [providerOffersResult, providerRunsResult] = await Promise.all([
    db
      .from('provider_offers')
      .select('provider_key, created_at, snapshot_at, provider_event_id')
      .gte('created_at', preFixStart.toISOString())
      .order('created_at', { ascending: true }),
    db
      .from('system_runs')
      .select('status, started_at, finished_at, details')
      .eq('run_type', 'ingestor.cycle')
      .gte('started_at', preFixStart.toISOString())
      .order('started_at', { ascending: true }),
  ]);

  if (providerOffersResult.error) {
    throw new Error(`Failed reading provider_offers: ${providerOffersResult.error.message}`);
  }
  if (providerRunsResult.error) {
    throw new Error(`Failed reading system_runs: ${providerRunsResult.error.message}`);
  }

  const providerOffers = (providerOffersResult.data ?? []) as ProviderOfferRow[];
  const providerRuns = (providerRunsResult.data ?? []) as SystemRunRow[];

  const preFixRows = providerOffers.filter((row) => isWithin(row.created_at, preFixStart, preFixEnd));
  const postFixRows24h = providerOffers.filter((row) => isAfter(row.created_at, postFix24hStart));
  const continuityRows = providerOffers.filter(
    (row) =>
      isAfter(row.created_at, continuityWindowStart) &&
      typeof row.provider_key === 'string' &&
      row.provider_key.startsWith('odds-api'),
  );

  const preFixSummary = summarizeProviders(preFixRows);
  const postFixSummary = summarizeProviders(postFixRows24h);
  const oddsApiContinuity = summarizeOddsApiContinuity(continuityRows, now);
  const postFixStatus = summarizePostFixStatus(postFixSummary, providerRuns, now);

  const preFixVisibleProviders = preFixSummary.map((row) => row.providerKey);
  const postFixVisibleProviders = postFixSummary.map((row) => row.providerKey);
  const staleConclusionSuperseded =
    postFixVisibleProviders.some((providerKey) => providerKey.startsWith('odds-api')) &&
    postFixVisibleProviders.length > 1;

  console.log(`${PREFIX} snapshot_date=${SNAPSHOT_DATE}`);
  console.log(`${PREFIX} generated_at=${now.toISOString()}`);
  console.log(`${PREFIX} pre_fix_visible_providers=${preFixVisibleProviders.join(',') || 'none'}`);
  console.log(`${PREFIX} post_fix_visible_providers=${postFixVisibleProviders.join(',') || 'none'}`);
  console.log(`${PREFIX} stale_single_provider_conclusion_superseded=${staleConclusionSuperseded ? 'yes' : 'no'}`);
  console.log('');

  printProviderSection('pre_fix_provider_state', preFixSummary);
  printProviderSection('post_fix_provider_state_last_24h', postFixSummary);

  console.log(`${PREFIX} post_fix_status latest_odds_api_run_at=${postFixStatus.latestOddsApiRunAt ?? 'none'}`);
  console.log(`${PREFIX} post_fix_status latest_odds_api_run_status=${postFixStatus.latestOddsApiRunStatus ?? 'none'}`);
  console.log(`${PREFIX} post_fix_status latest_sgo_run_at=${postFixStatus.latestSgoRunAt ?? 'none'}`);
  console.log(`${PREFIX} post_fix_status latest_sgo_run_status=${postFixStatus.latestSgoRunStatus ?? 'none'}`);
  console.log('');

  console.log(`${PREFIX} odds_api_continuity window_hours=${POST_FIX_CONTINUITY_WINDOW_HOURS}`);
  console.log(`${PREFIX} odds_api_continuity unique_snapshots=${oddsApiContinuity.uniqueSnapshotCount}`);
  console.log(`${PREFIX} odds_api_continuity latest_snapshot_at=${oddsApiContinuity.latestSnapshotAt ?? 'none'}`);
  console.log(`${PREFIX} odds_api_continuity max_gap_minutes=${oddsApiContinuity.maxGapMinutes ?? 'none'}`);
  console.log(`${PREFIX} odds_api_continuity verdict=${oddsApiContinuity.verdict}`);
  console.log(`${PREFIX} odds_api_continuity reason=${oddsApiContinuity.reason}`);
}

function summarizeProviders(rows: ProviderOfferRow[]): ProviderSummary[] {
  const byProvider = new Map<string, ProviderSummary>();
  const eventSets = new Map<string, Set<string>>();

  for (const row of rows) {
    const providerKey = row.provider_key ?? 'unknown';
    const summary = byProvider.get(providerKey) ?? {
      providerKey,
      totalRows: 0,
      latestCreatedAt: null,
      latestSnapshotAt: null,
      distinctEvents: 0,
    };
    summary.totalRows += 1;

    if (row.created_at && (!summary.latestCreatedAt || row.created_at > summary.latestCreatedAt)) {
      summary.latestCreatedAt = row.created_at;
    }
    if (row.snapshot_at && (!summary.latestSnapshotAt || row.snapshot_at > summary.latestSnapshotAt)) {
      summary.latestSnapshotAt = row.snapshot_at;
    }

    let eventSet = eventSets.get(providerKey);
    if (!eventSet) {
      eventSet = new Set<string>();
      eventSets.set(providerKey, eventSet);
    }
    if (row.provider_event_id) {
      eventSet.add(row.provider_event_id);
      summary.distinctEvents = eventSet.size;
    }

    byProvider.set(providerKey, summary);
  }

  return Array.from(byProvider.values()).sort((left, right) => left.providerKey.localeCompare(right.providerKey));
}

function summarizeOddsApiContinuity(rows: ProviderOfferRow[], now: Date) {
  const snapshots = Array.from(
    new Set(
      rows
        .map((row) => row.snapshot_at)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));

  if (snapshots.length === 0) {
    return {
      uniqueSnapshotCount: 0,
      latestSnapshotAt: null,
      maxGapMinutes: null as number | null,
      verdict: 'NOT_PROVEN',
      reason: 'No Odds API snapshot rows were visible in the continuity window.',
    };
  }

  let maxGapMinutes = 0;
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = Date.parse(snapshots[index - 1]!);
    const current = Date.parse(snapshots[index]!);
    if (Number.isFinite(previous) && Number.isFinite(current)) {
      maxGapMinutes = Math.max(maxGapMinutes, Math.round((current - previous) / 60000));
    }
  }

  const latestSnapshotAt = snapshots[snapshots.length - 1] ?? null;
  const latestSnapshotAgeMinutes =
    latestSnapshotAt == null ? Number.POSITIVE_INFINITY : Math.round((now.getTime() - Date.parse(latestSnapshotAt)) / 60000);
  const continuous = maxGapMinutes <= ACTIVE_GAP_MINUTES && latestSnapshotAgeMinutes <= ACTIVE_GAP_MINUTES;

  return {
    uniqueSnapshotCount: snapshots.length,
    latestSnapshotAt,
    maxGapMinutes,
    verdict: continuous ? 'PROVEN_CONTINUOUS' : 'NOT_PROVEN',
    reason: continuous
      ? `Observed Odds API snapshots stayed within ${ACTIVE_GAP_MINUTES} minutes of each other and the latest snapshot is fresh.`
      : `Observed a gap over ${ACTIVE_GAP_MINUTES} minutes or the latest snapshot is stale (${latestSnapshotAgeMinutes} minutes old).`,
  };
}

function summarizePostFixStatus(rows: ProviderSummary[], runs: SystemRunRow[], now: Date) {
  const latestOddsApiRun = findLatestProviderRun(runs, 'odds-api');
  const latestSgoRun = findLatestProviderRun(runs, 'sgo');
  const activeProviders = rows.filter((row) => minutesSince(row.latestSnapshotAt, now) != null && minutesSince(row.latestSnapshotAt, now)! <= ACTIVE_GAP_MINUTES);

  return {
    activeProviderCount: activeProviders.length,
    latestOddsApiRunAt: latestOddsApiRun?.started_at ?? null,
    latestOddsApiRunStatus: latestOddsApiRun?.status ?? null,
    latestSgoRunAt: latestSgoRun?.started_at ?? null,
    latestSgoRunStatus: latestSgoRun?.status ?? null,
  };
}

function findLatestProviderRun(runs: SystemRunRow[], providerName: string) {
  const filtered = runs.filter((run) => {
    const details = run.details;
    return details != null && typeof details['provider'] === 'string' && details['provider'] === providerName;
  });

  return filtered[filtered.length - 1] ?? null;
}

function printProviderSection(label: string, rows: ProviderSummary[]) {
  console.log(`${PREFIX} ${label} provider_count=${rows.length}`);
  if (rows.length === 0) {
    console.log(`${PREFIX} ${label} none`);
    console.log('');
    return;
  }

  for (const row of rows) {
    console.log(
      `${PREFIX} ${label} provider=${row.providerKey} total_rows=${row.totalRows} distinct_events=${row.distinctEvents} latest_created_at=${row.latestCreatedAt ?? 'none'} latest_snapshot_at=${row.latestSnapshotAt ?? 'none'}`,
    );
  }
  console.log('');
}

function isWithin(value: string | null, start: Date, end: Date) {
  if (!value) {
    return false;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
}

function isAfter(value: string | null, threshold: Date) {
  if (!value) {
    return false;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) && time >= threshold.getTime();
}

function minutesSince(value: string | null, now: Date) {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return null;
  }

  return Math.max(0, Math.round((now.getTime() - time) / 60000));
}
