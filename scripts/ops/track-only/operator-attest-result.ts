/**
 * Operator-attested result writer — the honest alternative to a provider feed
 * while SGO stays parked.
 *
 * It records a game result that a human operator read off a scoreboard and is
 * willing to be named for, under a provenance class (`operator`) that is a peer
 * of `sgo` rather than a disguise for it. Nothing written here ever claims to
 * be provider data: the event's `providerKey` is `operator`, its
 * `ingestionSource` is `operator.attestation`, and every `game_results` row
 * carries `source: 'operator:<attestedBy>'`.
 *
 * Authenticated attribution is a `system_runs` row, opened first, whose id is
 * written into the event's `ingestionCycleRunId`. So an event's provenance
 * points at the run that created it, the run names the attesting operator, and
 * neither can be produced without the other.
 *
 * Corrections need no DDL and no code. `game_results` is unique on
 * (event_id, participant_id, market_key, source) and
 * `DatabaseGradeResultRepository.findResult` orders `sourced_at` descending and
 * takes one row, so a correction is an *append* under a distinct source
 * (`operator:<who>:correction-<n>`). The original row survives as history and
 * `ops:track-only-report` lists it under `supersededSources`.
 *
 * Safety posture: dry run by default. `--apply` is required to write anything,
 * and the target host must match the declared project ref. Running `--apply`
 * against production is an operator action, not an agent one — see
 * `docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md`.
 */
import { pathToFileURL } from 'node:url';

const DEFAULT_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';

/**
 * The dedicated result market key for a moneyline. It is deliberately NOT
 * `points-all-game-ml`: production holds 280 rows under that key carrying a
 * *score* with `participant_id = NULL`, and a score read as a win flag would
 * settle a pick wrongly and silently. A distinct key makes the value's meaning
 * unambiguous and leaves every pre-existing row uninterpretable by the
 * moneyline settlement path.
 */
export const MONEYLINE_RESULT_MARKET_KEY = 'game_moneyline_win';

export const OPERATOR_PROVIDER_KEY = 'operator';
export const OPERATOR_INGESTION_SOURCE = 'operator.attestation';
export const OPERATOR_RUN_TYPE = 'operator.result_attestation';

export type Role = 'home' | 'away';

export interface AttestedSide {
  participantId: string;
  role: Role;
  /** 1 = won, 0 = lost, 0.5 = push. Any other value is refused. */
  outcome: number;
}

export interface AttestationInput {
  sport: string;
  /** ISO date (YYYY-MM-DD) of the event, used in the external id and row. */
  eventDate: string;
  eventName: string;
  attestedBy: string;
  /** Where the operator read the score. Free text, recorded verbatim. */
  evidence: string;
  sides: AttestedSide[];
  /** Present only when this attestation corrects an earlier one. */
  correctionOf?: string | null;
}

const LEGAL_OUTCOMES = new Set([0, 0.5, 1]);

export function slugifyEventName(eventName: string): string {
  const slug = eventName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('eventName produces an empty slug');
  return slug;
}

/**
 * `operator:<sport>:<date>:<slug>` — stable, so re-attesting the same event
 * upserts rather than creating a second event, and prefixed so an operator row
 * can never collide with a provider `external_id`.
 */
export function buildExternalId(input: {
  sport: string;
  eventDate: string;
  eventName: string;
}): string {
  return `operator:${input.sport}:${input.eventDate}:${slugifyEventName(input.eventName)}`;
}

export function validateAttestation(input: AttestationInput): void {
  if (!input.sport) throw new Error('sport is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) {
    throw new Error(`eventDate must be YYYY-MM-DD, got ${input.eventDate}`);
  }
  if (!input.eventName) throw new Error('eventName is required');
  if (!input.attestedBy) throw new Error('attestedBy is required');
  if (!input.evidence) {
    throw new Error(
      'evidence is required — an attestation with no stated source is not an attestation',
    );
  }
  if (input.sides.length !== 2) {
    throw new Error(`expected exactly 2 sides, got ${input.sides.length}`);
  }
  const roles = new Set(input.sides.map((side) => side.role));
  if (!roles.has('home') || !roles.has('away')) {
    throw new Error('sides must be exactly one home and one away');
  }
  const participantIds = new Set(input.sides.map((s) => s.participantId));
  if (participantIds.size !== 2) {
    throw new Error('the two sides must be distinct participants');
  }
  for (const side of input.sides) {
    if (!LEGAL_OUTCOMES.has(side.outcome)) {
      throw new Error(
        `outcome must be 1, 0 or 0.5; got ${side.outcome} for ${side.participantId}`,
      );
    }
  }
  const total = input.sides.reduce((sum, side) => sum + side.outcome, 0);
  if (total !== 1) {
    throw new Error(
      `the two outcomes must sum to 1 (one winner, or two pushes); got ${total}`,
    );
  }
}

/**
 * The `source` value carries the attesting identity and, for a correction, its
 * generation. It is part of the unique key, which is what makes a correction an
 * append rather than an overwrite.
 */
export function buildResultSource(input: {
  attestedBy: string;
  correctionOf?: string | null;
  correctionIndex?: number;
}): string {
  const base = `operator:${input.attestedBy}`;
  if (!input.correctionOf) return base;
  const index = input.correctionIndex ?? 1;
  return `${base}:correction-${index}`;
}

export interface PlannedWrite {
  table: string;
  verb: 'insert' | 'upsert';
  row: Record<string, unknown>;
  onConflict?: string;
}

/**
 * Builds every row the attestation implies, in dependency order, without
 * touching the network. The dry run prints exactly this, so what an operator
 * reviews is the same structure `--apply` sends.
 */
export function planAttestation(
  input: AttestationInput,
  context: { runId: string; eventId: string; attestedAt: string },
): PlannedWrite[] {
  validateAttestation(input);
  const externalId = buildExternalId(input);
  const source = buildResultSource(input);

  const writes: PlannedWrite[] = [
    {
      table: 'events',
      verb: 'upsert',
      onConflict: 'external_id',
      row: {
        id: context.eventId,
        external_id: externalId,
        event_name: input.eventName,
        event_date: input.eventDate,
        sport_id: input.sport,
        status: 'completed',
        metadata: {
          providerKey: OPERATOR_PROVIDER_KEY,
          ingestionSource: OPERATOR_INGESTION_SOURCE,
          ingestionCycleRunId: context.runId,
          attestedBy: input.attestedBy,
          attestedAt: context.attestedAt,
          evidence: input.evidence,
        },
      },
    },
  ];

  for (const side of input.sides) {
    writes.push({
      table: 'event_participants',
      verb: 'upsert',
      onConflict: 'event_id,participant_id',
      row: {
        event_id: context.eventId,
        participant_id: side.participantId,
        role: side.role,
      },
    });
  }

  for (const side of input.sides) {
    writes.push({
      table: 'game_results',
      verb: 'insert',
      row: {
        event_id: context.eventId,
        participant_id: side.participantId,
        market_key: MONEYLINE_RESULT_MARKET_KEY,
        actual_value: side.outcome,
        source,
        sourced_at: context.attestedAt,
      },
    });
  }

  return writes;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface CliOptions {
  url: string;
  key: string;
  projectRef: string;
  apply: boolean;
  input: AttestationInput;
}

export function parseCli(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
): CliOptions {
  const flags = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (!arg?.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for ${arg}`);
    }
    flags.set(arg.slice(2), value);
    index += 1;
  }

  const url =
    flags.get('url') ?? environment['OPERATOR_ATTEST_SUPABASE_URL'] ?? '';
  const key =
    flags.get('write-key') ?? environment['OPERATOR_ATTEST_WRITE_KEY'] ?? '';
  const projectRef = flags.get('project-ref') ?? DEFAULT_PROJECT_REF;
  if (!url || !key) {
    throw new Error(
      'OPERATOR_ATTEST_SUPABASE_URL and OPERATOR_ATTEST_WRITE_KEY (or --url/--write-key) are required',
    );
  }
  const parsed = new URL(url);
  if (parsed.hostname !== `${projectRef}.supabase.co`) {
    throw new Error(
      `refusing unexpected target ${parsed.hostname}; expected ${projectRef}.supabase.co`,
    );
  }

  const sides: AttestedSide[] = [];
  for (const role of ['home', 'away'] as const) {
    const participantId = flags.get(`${role}-participant`);
    const outcomeRaw = flags.get(`${role}-outcome`);
    if (!participantId || outcomeRaw === undefined) {
      throw new Error(
        `--${role}-participant and --${role}-outcome are both required`,
      );
    }
    sides.push({ participantId, role, outcome: Number(outcomeRaw) });
  }

  const input: AttestationInput = {
    sport: flags.get('sport') ?? '',
    eventDate: flags.get('event-date') ?? '',
    eventName: flags.get('event-name') ?? '',
    attestedBy: flags.get('attested-by') ?? '',
    evidence: flags.get('evidence') ?? '',
    sides,
    correctionOf: flags.get('correction-of') ?? null,
  };
  validateAttestation(input);

  return { url, key, projectRef, apply, input };
}

async function postgrest(
  options: CliOptions,
  write: PlannedWrite,
): Promise<void> {
  const headers: Record<string, string> = {
    apikey: options.key,
    Authorization: `Bearer ${options.key}`,
    'Content-Type': 'application/json',
    Prefer:
      write.verb === 'upsert'
        ? 'resolution=merge-duplicates,return=minimal'
        : 'return=minimal',
  };
  const query = write.onConflict
    ? `?on_conflict=${encodeURIComponent(write.onConflict)}`
    : '';
  const response = await fetch(
    `${options.url}/rest/v1/${write.table}${query}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify([write.row]),
    },
  );
  if (!response.ok) {
    throw new Error(
      `${write.table} write failed: ${response.status} ${await response.text()}`,
    );
  }
}

export async function runAttestation(options: CliOptions): Promise<{
  applied: boolean;
  runId: string;
  eventId: string;
  externalId: string;
  writes: PlannedWrite[];
}> {
  const attestedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const externalId = buildExternalId(options.input);

  const runRow: PlannedWrite = {
    table: 'system_runs',
    verb: 'insert',
    row: {
      id: runId,
      run_type: OPERATOR_RUN_TYPE,
      status: 'succeeded',
      actor: options.input.attestedBy,
      started_at: attestedAt,
      finished_at: attestedAt,
      details: {
        attestedBy: options.input.attestedBy,
        attestedAt,
        evidence: options.input.evidence,
        eventName: options.input.eventName,
        externalId,
        correctionOf: options.input.correctionOf ?? null,
        sides: options.input.sides,
      },
    },
  };

  const writes = [
    runRow,
    ...planAttestation(options.input, { runId, eventId, attestedAt }),
  ];

  if (!options.apply) {
    return { applied: false, runId, eventId, externalId, writes };
  }

  // Order matters: the run must exist before the event that cites it, and the
  // event before the participant links and results that reference it.
  for (const write of writes) {
    await postgrest(options, write);
  }

  return { applied: true, runId, eventId, externalId, writes };
}

/**
 * The operator procedure, kept next to the code that implements it. An earlier
 * plan put this in `docs/05_operations/OPERATOR_ATTESTATION_RUNBOOK.md`; that
 * path is inside another active lane's scope, and a runbook that drifts from
 * its script is worse than a `--help` that cannot.
 */
export const USAGE = `ops:operator-attest-result -- record a result a human read off a scoreboard.

Required flags (every one of them; the CLI refuses rather than defaulting):
  --sport               e.g. MLB
  --event-date          YYYY-MM-DD
  --event-name          e.g. "Dodgers @ Brewers"
  --home-participant    participants.id (a UUID, not a team name)
  --away-participant    participants.id
  --home-outcome        0, 0.5 or 1
  --away-outcome        0, 0.5 or 1   (the pair must sum to 1)
  --attested-by         the operator being named for this, e.g. griff843
  --evidence            where the score was read, e.g. a URL or "MLB Gameday"

Optional:
  --correction-of       the source being corrected; makes this an APPEND under a
                        distinct source. The original row survives as history.
  --project-ref         default ${DEFAULT_PROJECT_REF}
  --url --write-key     else OPERATOR_ATTEST_SUPABASE_URL / OPERATOR_ATTEST_WRITE_KEY
  --apply               perform the writes. WITHOUT IT NOTHING IS WRITTEN.

Dry run first -- it is the default and it writes nothing:
  pnpm exec tsx scripts/ops/track-only/operator-attest-result.ts \\
    --sport MLB --event-date 2026-09-09 --event-name "Dodgers @ Brewers" \\
    --home-participant <brewers-uuid> --home-outcome 0 \\
    --away-participant <dodgers-uuid> --away-outcome 1 \\
    --attested-by griff843 --evidence "MLB Gameday"

Then the same command with --apply. Running --apply against production is an
OPERATOR action, not an agent one -- docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md.

The target host must match --project-ref or the run is refused. Read the result
back with ops:track-only-report, which shows the settlement, its provenance
class, and any supersededSources.
`;

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(USAGE);
    return;
  }
  const options = parseCli(process.argv.slice(2), process.env);
  const result = await runAttestation(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.applied) {
    process.stdout.write(
      'DRY RUN — nothing was written. Re-run with --apply to perform these writes.\n',
    );
  }
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
