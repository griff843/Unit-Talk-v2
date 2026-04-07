import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';
import { fetchAndPairSGOProps } from '../apps/ingestor/src/sgo-fetcher.js';

type EventRow = {
  id: string;
  external_id: string | null;
  event_name: string;
  event_date: string;
  status: string;
  sport_id: string | null;
  metadata: Record<string, unknown> | null;
};

type ProviderOfferRow = {
  id: string;
  provider_key: string;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  bookmaker_key: string | null;
  snapshot_at: string;
  is_closing: boolean;
};

type SystemRunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  details: Record<string, unknown> | null;
};

type CandidateSummary = {
  provider_market_key: string;
  provider_participant_id: string | null;
  bookmaker_key: string | null;
  candidate_row_id: string;
  candidate_snapshot_at: string;
  candidate_is_closing: boolean;
  closing_row_exists_for_group: boolean;
  would_update: boolean;
};

type EventDebugSummary = {
  provider_event_id: string;
  starts_at: string;
  pregame_snapshot_count: number;
  fetched_events: {
    current_cycle: 'present' | 'absent' | 'unknown';
    last_cycle: 'present' | 'absent' | 'unknown';
  };
  closing_rows: {
    exists: boolean;
    count: number;
  };
  would_update_any_row: boolean;
  break_point:
    | 'closing_rows_already_exist'
    | 'eligible_and_markable_now'
    | 'eligible_but_no_markable_candidates';
  latest_pregame_candidates: CandidateSummary[];
};

const DEFAULT_SAMPLE_LIMIT = 10;
const PAGE_SIZE = 1000;
const STARTED_EVENT_LOOKBACK_DAYS = 7;

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.exitCode = 1;
});

async function main() {
  const sampleLimit = parseSampleLimit(process.argv.slice(2));
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const db = createDatabaseClientFromConnection(connection);

  try {
    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);
    const lookbackStart = new Date(
      Date.now() - STARTED_EVENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);

    const eligibleEvents = await findEligibleStartedEvents(db, lookbackStart, today, nowIso);
    const sampledEvents = eligibleEvents.slice(0, sampleLimit);
    const currentCycle = await fetchCurrentCyclePresence(env.SGO_API_KEY, sampledEvents, nowIso);
    const lastCycle = await loadLastCycleState(db);

    const eventSummaries: EventDebugSummary[] = [];
    for (const event of sampledEvents) {
      const candidates = await loadLatestPregameCandidates(db, event.external_id, event.startsAt);
      const closingRowCount = await countClosingRows(db, event.external_id);
      const wouldUpdateAnyRow = candidates.some((candidate) => candidate.would_update);
      const breakPoint =
        closingRowCount > 0
          ? 'closing_rows_already_exist'
          : wouldUpdateAnyRow
            ? 'eligible_and_markable_now'
            : 'eligible_but_no_markable_candidates';

      eventSummaries.push({
        provider_event_id: event.external_id,
        starts_at: event.startsAt,
        pregame_snapshot_count: event.pregameSnapshotCount,
        fetched_events: {
          current_cycle: currentCycle.presenceByEventId.get(event.external_id) ?? 'unknown',
          last_cycle: 'unknown',
        },
        closing_rows: {
          exists: closingRowCount > 0,
          count: closingRowCount,
        },
        would_update_any_row: wouldUpdateAnyRow,
        break_point: breakPoint,
        latest_pregame_candidates: candidates,
      });
    }

    const summary = {
      eligible_started_events: eligibleEvents.length,
      sampled_events: eventSummaries.length,
      sampled_events_with_closing_rows: eventSummaries.filter((event) => event.closing_rows.exists)
        .length,
      sampled_events_without_closing_rows: eventSummaries.filter(
        (event) => !event.closing_rows.exists,
      ).length,
      sampled_events_that_would_update_now: eventSummaries.filter(
        (event) => event.would_update_any_row,
      ).length,
    };

    const output = {
      generated_at: nowIso,
      provider: 'sgo',
      sample_limit: sampleLimit,
      current_cycle: currentCycle.summary,
      last_cycle: lastCycle,
      summary,
      events: eventSummaries,
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await shutdownClient(db);
  }
}

async function findEligibleStartedEvents(
  db: UnitTalkSupabaseClient,
  lookbackStart: string,
  today: string,
  nowIso: string,
) {
  const { data, error } = await db
    .from('events')
    .select('id, external_id, event_name, event_date, status, sport_id, metadata')
    .gte('event_date', lookbackStart)
    .lte('event_date', today)
    .order('event_date', { ascending: false });

  if (error) {
    throw new Error(`Failed to load recent events: ${error.message}`);
  }

  const eligible: Array<{
    id: string;
    external_id: string;
    eventName: string;
    sportId: string | null;
    startsAt: string;
    pregameSnapshotCount: number;
  }> = [];

  for (const event of (data ?? []) as EventRow[]) {
    if (!event.external_id) {
      continue;
    }

    const startsAt = getStartsAt(event);
    if (!startsAt || startsAt > nowIso) {
      continue;
    }

    const pregameSnapshotCount = await exactCount(
      db
        .from('provider_offers')
        .select('id', { count: 'exact', head: true })
        .eq('provider_key', 'sgo')
        .eq('provider_event_id', event.external_id)
        .lt('snapshot_at', startsAt),
      `pregame snapshots for ${event.external_id}`,
    );

    if (pregameSnapshotCount === 0) {
      continue;
    }

    eligible.push({
      id: event.id,
      external_id: event.external_id,
      eventName: event.event_name,
      sportId: event.sport_id,
      startsAt,
      pregameSnapshotCount,
    });
  }

  eligible.sort((left, right) => right.startsAt.localeCompare(left.startsAt));
  return eligible;
}

async function loadLatestPregameCandidates(
  db: UnitTalkSupabaseClient,
  providerEventId: string,
  startsAt: string,
) {
  const rows = await listPregameOffers(db, providerEventId, startsAt);
  if (rows.length === 0) {
    return [];
  }

  const latestByGroup = new Map<string, ProviderOfferRow>();
  const closingByGroup = new Set<string>();

  for (const row of rows) {
    const groupKey = buildGroupKey(row);
    if (row.is_closing) {
      closingByGroup.add(groupKey);
    }
    const existing = latestByGroup.get(groupKey);
    if (!existing || row.snapshot_at > existing.snapshot_at) {
      latestByGroup.set(groupKey, row);
    }
  }

  return Array.from(latestByGroup.values())
    .sort(compareOfferRows)
    .map<CandidateSummary>((row) => {
      const groupKey = buildGroupKey(row);
      const closingRowExistsForGroup = closingByGroup.has(groupKey);
      const wouldUpdate = !row.is_closing;

      return {
        provider_market_key: row.provider_market_key,
        provider_participant_id: row.provider_participant_id,
        bookmaker_key: row.bookmaker_key,
        candidate_row_id: row.id,
        candidate_snapshot_at: row.snapshot_at,
        candidate_is_closing: row.is_closing,
        closing_row_exists_for_group: closingRowExistsForGroup,
        would_update: wouldUpdate,
      };
    });
}

async function listPregameOffers(
  db: UnitTalkSupabaseClient,
  providerEventId: string,
  startsAt: string,
) {
  const rows: ProviderOfferRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await db
      .from('provider_offers')
      .select(
        'id, provider_key, provider_event_id, provider_market_key, provider_participant_id, bookmaker_key, snapshot_at, is_closing',
      )
      .eq('provider_key', 'sgo')
      .eq('provider_event_id', providerEventId)
      .lt('snapshot_at', startsAt)
      .order('snapshot_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load pregame offers for ${providerEventId}: ${error.message}`);
    }

    const page = (data ?? []) as ProviderOfferRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      break;
    }
  }
  return rows;
}

async function countClosingRows(db: UnitTalkSupabaseClient, providerEventId: string) {
  return exactCount(
    db
      .from('provider_offers')
      .select('id', { count: 'exact', head: true })
      .eq('provider_key', 'sgo')
      .eq('provider_event_id', providerEventId)
      .eq('is_closing', true),
    `closing rows for ${providerEventId}`,
  );
}

async function fetchCurrentCyclePresence(
  apiKey: string | undefined,
  events: Array<{ external_id: string; sportId: string | null }>,
  nowIso: string,
) {
  if (!apiKey) {
    return {
      summary: {
        available: false,
        reason: 'SGO_API_KEY missing',
      },
      presenceByEventId: new Map<string, 'present' | 'absent' | 'unknown'>(),
    };
  }

  const leagues = unique(
    events
      .map((event) => normalizeLeagueKey(event.sportId))
      .filter((league): league is string => league !== null),
  );

  if (leagues.length === 0) {
    return {
      summary: {
        available: false,
        reason: 'No sample events had an SGO league key',
      },
      presenceByEventId: new Map<string, 'present' | 'absent' | 'unknown'>(),
    };
  }

  try {
    const seenEventIds = new Set<string>();
    for (const league of leagues) {
      const fetched = await fetchAndPairSGOProps({
        apiKey,
        league,
        snapshotAt: nowIso,
      });
      for (const event of fetched.events) {
        seenEventIds.add(event.providerEventId);
      }
    }

    const presenceByEventId = new Map<string, 'present' | 'absent' | 'unknown'>();
    for (const event of events) {
      presenceByEventId.set(
        event.external_id,
        seenEventIds.has(event.external_id) ? 'present' : 'absent',
      );
    }

    return {
      summary: {
        available: true,
        snapshot_at: nowIso,
        events_count: seenEventIds.size,
      },
      presenceByEventId,
    };
  } catch (error) {
    return {
      summary: {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
      },
      presenceByEventId: new Map<string, 'present' | 'absent' | 'unknown'>(),
    };
  }
}

async function loadLastCycleState(db: UnitTalkSupabaseClient) {
  const { data, error } = await db
    .from('system_runs')
    .select('id, started_at, finished_at, status, details')
    .eq('run_type', 'ingestor.cycle')
    .order('started_at', { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(`Failed to load recent system runs: ${error.message}`);
  }

  const sgoRun = ((data ?? []) as SystemRunRow[]).find((run) => {
    const provider = run.details?.provider;
    return typeof provider === 'string' && provider === 'sgo';
  });

  if (!sgoRun) {
    return {
      available: false,
      reason: 'No recent ingestor.cycle run with provider=sgo found',
    };
  }

  return {
    available: false,
    run_id: sgoRun.id,
    started_at: sgoRun.started_at,
    finished_at: sgoRun.finished_at,
    status: sgoRun.status,
    reason: 'system_runs.details does not persist fetched.events provider_event_ids',
  };
}

async function exactCount(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  label: string,
) {
  const result = await query;
  if (result.error) {
    throw new Error(`Failed to load ${label}: ${result.error.message}`);
  }
  return result.count ?? 0;
}

function getStartsAt(event: EventRow) {
  const raw = event.metadata?.starts_at;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function buildGroupKey(row: Pick<
  ProviderOfferRow,
  'provider_key' | 'provider_market_key' | 'provider_participant_id' | 'bookmaker_key'
>) {
  return [
    row.provider_key,
    row.provider_market_key,
    row.provider_participant_id ?? '',
    row.bookmaker_key ?? '',
  ].join(':');
}

function compareOfferRows(left: ProviderOfferRow, right: ProviderOfferRow) {
  return (
    left.provider_market_key.localeCompare(right.provider_market_key) ||
    (left.provider_participant_id ?? '').localeCompare(right.provider_participant_id ?? '') ||
    (left.bookmaker_key ?? '').localeCompare(right.bookmaker_key ?? '')
  );
}

function normalizeLeagueKey(value: string | null) {
  return typeof value === 'string' && value.length > 0 ? value.toUpperCase() : null;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function parseSampleLimit(args: string[]) {
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  if (!limitArg) {
    return DEFAULT_SAMPLE_LIMIT;
  }

  const raw = limitArg.slice('--limit='.length);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit value: ${raw}`);
  }
  return parsed;
}

async function shutdownClient(db: UnitTalkSupabaseClient) {
  await db.removeAllChannels();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
