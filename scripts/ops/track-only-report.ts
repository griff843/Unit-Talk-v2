/**
 * Track Only observation report — the operator surface for the Smart Form →
 * result journey while SGO and member delivery stay disabled.
 *
 * It answers one question per pick: *given what is in the database right now,
 * what stops this pick from settling, and where did its result come from?*
 *
 * Deliberate non-goal: this does NOT re-implement the grading rules. In
 * particular it does not copy `classifyMarketFamilyForGrading` or
 * `TRUSTED_GRADING_EVENT_PROVIDERS` from `apps/api/src/grading-service.ts` —
 * neither is exported, and duplicating a rule so a report can agree with it is
 * exactly the class of defect this repository has already paid for twice
 * (UTV2-1688's regex, UTV2-1856's client guard). What it reports instead are
 * *observable database preconditions*: the event exists, it is completed, its
 * provenance fields are populated, a result row is keyed to it. Those are facts
 * about rows, not restatements of a rule, so they cannot silently disagree with
 * the grader.
 *
 * The follow-up that removes the remaining gap is recorded rather than assumed:
 * export the two predicates from `grading-service.ts` and import them here, once
 * that file is no longer held by an open lane.
 *
 * Read-only by construction: it uses `ReadOnlyPostgrestClient`, a GET-only
 * transport, and prints the measured method tally rather than asserting that it
 * wrote nothing.
 */
import { pathToFileURL } from 'node:url';

import {
  ReadOnlyPostgrestClient,
  canonicalMarketKey,
  type EventRow,
  type GameResultRow,
  type PickRow,
  type SettlementRow,
} from './pick-truth-audit.ts';

const DEFAULT_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';

/**
 * `EventRow` in pick-truth-audit carries only the columns that audit needs.
 * Grading additionally gates on `events.status === 'completed'`, so this report
 * has to read it. The column names are the live ones — `event_name`, not `name`;
 * `event_date`, not `start_time` — which is why they are spelled out here rather
 * than assumed from the grading code's own field names.
 */
export interface ObservedEventRow extends EventRow {
  status: string;
  sport_id: string | null;
}

const EVENT_SELECT =
  'id,event_name,event_date,status,external_id,metadata,sport_id';

/** `PickRow` omits the three attribution columns this report exists to show. */
export interface ObservedPickRow extends PickRow {
  capper_id: string | null;
  sport_id: string | null;
  stake_units: number | null;
}

const PICK_SELECT =
  'id,capper_id,sport_id,market,market_type_id,selection,line,odds,stake_units,status,created_at,participant_id,metadata';

/**
 * Tables that carry a `pick_id` and would evidence a member delivery. Enumerated
 * from `information_schema` rather than from the two anyone remembers — the
 * Milestone 1 verification found two this way that no document listed.
 */
const DELIVERY_BEARING_TABLES = [
  'distribution_outbox',
  'command_center_delivery_mappings',
  'execution_intents',
] as const;

export interface PreconditionCheck {
  id: string;
  state: 'pass' | 'fail';
  detail: string;
}

export interface TrackOnlyPickReport {
  pickId: string;
  capperId: string | null;
  sport: string | null;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  stakeUnits: number | null;
  status: string;
  createdAt: string;
  eventName: string | null;
  /** Ordered; the first `fail` is the blocker an operator should act on. */
  preconditions: PreconditionCheck[];
  firstBlocker: string | null;
  resultProvenance: {
    class: 'operator' | 'sgo' | 'other' | 'none';
    source: string | null;
    sourcedAt: string | null;
    /** Rows on the same (event, participant, market) key. >1 means a correction. */
    attestationDepth: number;
    supersededSources: string[];
  };
  settlement: {
    rows: number;
    result: string | null;
    settledAt: string | null;
  };
  delivery: Record<string, number>;
  deliveryClean: boolean;
}

export interface TrackOnlyReport {
  projectRef: string;
  generatedAt: string;
  cohortSize: number;
  picks: TrackOnlyPickReport[];
  transportEvidence: { methods: Record<string, number>; requests: number };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Honest classification of where a result came from. `operator` is a first-class
 * class alongside `sgo`, never a disguise for it: the two are distinguished by
 * the `source` the attestation actually wrote.
 */
export function classifyResultProvenance(
  source: string | null,
): 'operator' | 'sgo' | 'other' | 'none' {
  if (!source) return 'none';
  const normalized = source.trim().toLowerCase();
  if (normalized === 'operator' || normalized.startsWith('operator:')) {
    return 'operator';
  }
  if (normalized === 'sgo' || normalized.startsWith('sgo')) return 'sgo';
  return 'other';
}

export function buildPreconditions(input: {
  event: ObservedEventRow | null;
  results: GameResultRow[];
}): PreconditionCheck[] {
  const checks: PreconditionCheck[] = [];
  const { event, results } = input;

  if (!event) {
    checks.push({
      id: 'event_resolved',
      state: 'fail',
      detail: 'no events row matches this pick',
    });
    return checks;
  }
  checks.push({
    id: 'event_resolved',
    state: 'pass',
    detail: `event ${event.id}`,
  });

  checks.push(
    event.status === 'completed'
      ? { id: 'event_completed', state: 'pass', detail: 'status=completed' }
      : {
          id: 'event_completed',
          state: 'fail',
          detail: `status=${event.status}`,
        },
  );

  const metadata = asRecord(event.metadata);
  const provider =
    readString(metadata, 'providerKey') ??
    readString(metadata, 'provider_key') ??
    readString(metadata, 'source');
  const ingestionSource = readString(metadata, 'ingestionSource');
  const cycleRunId =
    readString(metadata, 'ingestionCycleRunId') ??
    readString(metadata, 'ingestion_cycle_run_id') ??
    readString(metadata, 'ingestionRunId') ??
    readString(metadata, 'runId');

  const missing: string[] = [];
  if (!event.external_id) missing.push('external_id');
  if (!provider) missing.push('metadata.providerKey');
  if (!ingestionSource) missing.push('metadata.ingestionSource');
  if (!cycleRunId) missing.push('metadata.ingestionCycleRunId');

  checks.push(
    missing.length === 0
      ? {
          id: 'event_provenance_populated',
          state: 'pass',
          detail: `providerKey=${provider} ingestionSource=${ingestionSource}`,
        }
      : {
          id: 'event_provenance_populated',
          state: 'fail',
          detail: `missing ${missing.join(', ')}`,
        },
  );

  checks.push(
    results.length > 0
      ? {
          id: 'result_present',
          state: 'pass',
          detail: `${results.length} game_results row(s)`,
        }
      : {
          id: 'result_present',
          state: 'fail',
          detail: 'no game_results row keyed to this event',
        },
  );

  return checks;
}

export function firstBlockerOf(checks: PreconditionCheck[]): string | null {
  return checks.find((check) => check.state === 'fail')?.id ?? null;
}

export interface LoadedPickContext {
  pick: ObservedPickRow;
  event: ObservedEventRow | null;
  results: GameResultRow[];
  settlements: SettlementRow[];
  delivery: Record<string, number>;
}

export function buildPickReport(
  context: LoadedPickContext,
): TrackOnlyPickReport {
  const { pick, event, results, settlements, delivery } = context;
  const metadata = asRecord(pick.metadata);
  const preconditions = buildPreconditions({ event, results });

  // findResult orders by sourced_at DESC and takes the first row, so the newest
  // attestation is the one grading will read. Everything behind it is history,
  // which is what makes a correction an append rather than an overwrite.
  const ordered = [...results].sort((a, b) =>
    String(b.sourced_at ?? '').localeCompare(String(a.sourced_at ?? '')),
  );
  const latest = ordered[0] ?? null;

  return {
    pickId: pick.id,
    capperId: pick.capper_id ?? null,
    sport: readString(metadata, 'sport') ?? pick.sport_id ?? null,
    market: canonicalMarketKey(pick),
    selection: pick.selection,
    line: pick.line ?? null,
    odds: pick.odds ?? null,
    stakeUnits: pick.stake_units ?? null,
    status: pick.status,
    createdAt: pick.created_at,
    eventName: readString(metadata, 'eventName'),
    preconditions,
    firstBlocker: firstBlockerOf(preconditions),
    resultProvenance: {
      class: classifyResultProvenance(latest?.source ?? null),
      source: latest?.source ?? null,
      sourcedAt: latest?.sourced_at ?? null,
      attestationDepth: ordered.length,
      supersededSources: ordered
        .slice(1)
        .map((row) => row.source)
        .filter((source): source is string => typeof source === 'string'),
    },
    settlement: {
      rows: settlements.length,
      result: settlements[0]?.result ?? null,
      settledAt: settlements[0]?.settled_at ?? null,
    },
    delivery,
    deliveryClean: Object.values(delivery).every((count) => count === 0),
  };
}

export { DELIVERY_BEARING_TABLES, DEFAULT_PROJECT_REF };

interface CliOptions {
  url: string;
  key: string;
  projectRef: string;
  pickId: string | null;
}

export function parseCli(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
): CliOptions {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for ${arg}`);
    }
    flags.set(arg.slice(2), value);
    index += 1;
  }

  const url =
    flags.get('url') ?? environment['TRACK_ONLY_REPORT_SUPABASE_URL'] ?? '';
  const key =
    flags.get('read-key') ?? environment['TRACK_ONLY_REPORT_READ_KEY'] ?? '';
  const projectRef = flags.get('project-ref') ?? DEFAULT_PROJECT_REF;
  if (!url || !key) {
    throw new Error(
      'TRACK_ONLY_REPORT_SUPABASE_URL and TRACK_ONLY_REPORT_READ_KEY (or --url/--read-key) are required',
    );
  }
  const parsed = new URL(url);
  if (parsed.hostname !== `${projectRef}.supabase.co`) {
    throw new Error(
      `refusing unexpected target ${parsed.hostname}; expected ${projectRef}.supabase.co`,
    );
  }
  return { url, key, projectRef, pickId: flags.get('pick') ?? null };
}

async function loadContexts(
  client: ReadOnlyPostgrestClient,
  pickId: string | null,
): Promise<LoadedPickContext[]> {
  const pickFilters: Record<string, string> = pickId
    ? { id: `eq.${pickId}` }
    : { 'metadata->>distributionMode': 'eq.track-only' };

  const picks = await client.read<ObservedPickRow>({
    table: 'picks',
    select: PICK_SELECT,
    filters: pickFilters,
    order: 'created_at.desc',
  });

  const contexts: LoadedPickContext[] = [];
  for (const pick of picks.rows) {
    const metadata = asRecord(pick.metadata);
    const eventName = readString(metadata, 'eventName');
    let event: ObservedEventRow | null = null;
    if (eventName) {
      const events = await client.read<ObservedEventRow>({
        table: 'events',
        select: EVENT_SELECT,
        filters: { event_name: `eq.${eventName}` },
        order: 'created_at.desc',
        limit: 1,
      });
      event = events.rows[0] ?? null;
    }

    const results = event
      ? (
          await client.read<GameResultRow>({
            table: 'game_results',
            select:
              'id,event_id,participant_id,market_key,actual_value,source,sourced_at',
            filters: { event_id: `eq.${event.id}` },
            order: 'sourced_at.desc',
          })
        ).rows
      : [];

    const settlements = await client.read<SettlementRow>({
      table: 'settlement_records',
      select: '*',
      filters: { pick_id: `eq.${pick.id}` },
      order: 'settled_at.desc',
    });

    const delivery: Record<string, number> = {};
    for (const table of DELIVERY_BEARING_TABLES) {
      const response = await client.read({
        table,
        select: 'pick_id',
        filters: { pick_id: `eq.${pick.id}` },
        exactCount: true,
        head: true,
      });
      delivery[table] = response.count ?? 0;
    }

    contexts.push({
      pick,
      event,
      results,
      settlements: settlements.rows,
      delivery,
    });
  }

  return contexts;
}

export async function runTrackOnlyReport(
  options: CliOptions,
): Promise<TrackOnlyReport> {
  const client = new ReadOnlyPostgrestClient(options.url, options.key);
  const contexts = await loadContexts(client, options.pickId);
  return {
    projectRef: options.projectRef,
    generatedAt: new Date().toISOString(),
    cohortSize: contexts.length,
    picks: contexts.map(buildPickReport),
    transportEvidence: client.transportEvidence(),
  };
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2), process.env);
  const report = await runTrackOnlyReport(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (entrypoint === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
