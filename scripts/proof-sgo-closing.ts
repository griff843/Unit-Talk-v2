import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';

type ClosingRow = {
  id: string;
  provider_event_id: string;
  snapshot_at: string;
};

type EventRow = {
  external_id: string | null;
  event_name: string;
  event_date: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

type EligibleStartedEvent = {
  externalId: string;
  eventName: string;
  startsAt: string;
  pregameSnapshotCount: number;
  closingRowCount: number;
};

const PAGE_SIZE = 1000;
const STARTED_EVENT_LOOKBACK_DAYS = 7;
const SAMPLE_LIMIT = 5;

async function main() {
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const db = createDatabaseClientFromConnection(connection);

  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const today = nowIso.slice(0, 10);
    const lookbackStart = new Date(
      now.getTime() - STARTED_EVENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);

    const totalClosing = await exactCount(
      db
        .from('provider_offers')
        .select('id', { count: 'exact', head: true })
        .eq('provider_key', 'sgo')
        .eq('is_closing', true),
      'total SGO closing rows',
    );

    const closingRows = totalClosing > 0 ? await listAllClosingRows(db) : [];
    const crossCheck = await evaluateCrossCheck(db, closingRows);
    const eligibleStartedEvents = await findEligibleStartedEvents(
      db,
      lookbackStart,
      today,
      nowIso,
    );
    const closingProofExists = totalClosing > 0;
    const crossCheckPasses = closingProofExists && crossCheck.badRowCount === 0;
    const verdict = closingProofExists && crossCheckPasses ? 'PASS' : 'FAIL';

    const lines = [
      `UTV2-402 SGO closing proof — ${nowIso}`,
      `- total_sgo_closing_rows: ${totalClosing}`,
      `- closing_proof_exists: ${closingProofExists ? 'yes' : 'no'}`,
      `- cross_check_snapshot_before_start: ${formatCrossCheckStatus(closingProofExists, crossCheck.badRowCount)}`,
      `- cross_check_bad_rows: ${crossCheck.badRowCount}`,
      `- eligible_started_events_with_pregame_snapshots: ${eligibleStartedEvents.length > 0 ? 'yes' : 'no'} (count=${eligibleStartedEvents.length})`,
      ...formatEligibleSamples(eligibleStartedEvents),
      `- verdict: ${verdict}`,
    ];

    console.log(lines.join('\n'));
    return verdict === 'PASS' ? 0 : 1;
  } finally {
    await shutdownClient(db);
  }
}

async function listAllClosingRows(db: UnitTalkSupabaseClient) {
  const rows: ClosingRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await db
      .from('provider_offers')
      .select('id, provider_event_id, snapshot_at')
      .eq('provider_key', 'sgo')
      .eq('is_closing', true)
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load SGO closing rows: ${error.message}`);
    }

    const page = (data ?? []) as ClosingRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      break;
    }
  }
  return rows;
}

async function evaluateCrossCheck(db: UnitTalkSupabaseClient, closingRows: ClosingRow[]) {
  if (closingRows.length === 0) {
    return { badRowCount: 0 };
  }

  const eventMap = await loadEventsByExternalId(
    db,
    unique(closingRows.map((row) => row.provider_event_id)),
  );

  let badRowCount = 0;
  for (const row of closingRows) {
    const event = eventMap.get(row.provider_event_id);
    const startsAt = getStartsAt(event);
    if (!startsAt || row.snapshot_at >= startsAt) {
      badRowCount += 1;
    }
  }

  return { badRowCount };
}

async function findEligibleStartedEvents(
  db: UnitTalkSupabaseClient,
  lookbackStart: string,
  today: string,
  nowIso: string,
) {
  const { data, error } = await db
    .from('events')
    .select('external_id, event_name, event_date, status, metadata')
    .gte('event_date', lookbackStart)
    .lte('event_date', today)
    .order('event_date', { ascending: false });

  if (error) {
    throw new Error(`Failed to load recent events: ${error.message}`);
  }

  const eligible: EligibleStartedEvent[] = [];
  for (const event of (data ?? []) as EventRow[]) {
    const externalId = event.external_id;
    const startsAt = getStartsAt(event);
    if (!externalId || !startsAt || startsAt > nowIso) {
      continue;
    }

    const pregameSnapshotCount = await exactCount(
      db
        .from('provider_offers')
        .select('id', { count: 'exact', head: true })
        .eq('provider_key', 'sgo')
        .eq('provider_event_id', externalId)
        .lt('snapshot_at', startsAt),
      `pregame snapshots for ${externalId}`,
    );

    if (pregameSnapshotCount === 0) {
      continue;
    }

    const closingRowCount = await exactCount(
      db
        .from('provider_offers')
        .select('id', { count: 'exact', head: true })
        .eq('provider_key', 'sgo')
        .eq('provider_event_id', externalId)
        .eq('is_closing', true),
      `closing rows for ${externalId}`,
    );

    eligible.push({
      externalId,
      eventName: event.event_name,
      startsAt,
      pregameSnapshotCount,
      closingRowCount,
    });
  }

  eligible.sort((left, right) => right.startsAt.localeCompare(left.startsAt));
  return eligible;
}

async function loadEventsByExternalId(db: UnitTalkSupabaseClient, externalIds: string[]) {
  const map = new Map<string, EventRow>();
  for (let index = 0; index < externalIds.length; index += PAGE_SIZE) {
    const chunk = externalIds.slice(index, index + PAGE_SIZE);
    const { data, error } = await db
      .from('events')
      .select('external_id, event_name, event_date, status, metadata')
      .in('external_id', chunk);

    if (error) {
      throw new Error(`Failed to load events for cross-check: ${error.message}`);
    }

    for (const row of (data ?? []) as EventRow[]) {
      if (row.external_id) {
        map.set(row.external_id, row);
      }
    }
  }
  return map;
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

function getStartsAt(event: EventRow | undefined) {
  const raw = event?.metadata?.starts_at;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function formatCrossCheckStatus(closingProofExists: boolean, badRowCount: number) {
  if (!closingProofExists) {
    return 'N/A';
  }
  return badRowCount === 0 ? 'PASS' : 'FAIL';
}

function formatEligibleSamples(events: EligibleStartedEvent[]) {
  if (events.length === 0) {
    return ['- eligible_started_event_samples: none'];
  }

  return [
    '- eligible_started_event_samples:',
    ...events.slice(0, SAMPLE_LIMIT).map(
      (event) =>
        `  - ${event.externalId} | starts_at=${event.startsAt} | pregame_snapshots=${event.pregameSnapshotCount} | closing_rows=${event.closingRowCount} | ${event.eventName}`,
    ),
  ];
}

async function shutdownClient(db: UnitTalkSupabaseClient) {
  await db.removeAllChannels();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
