/**
 * Governed operator event seeding — UTV2-1930.
 *
 * ## Why this exists
 *
 * Smart Form's read side is complete and deployed. `GET /api/reference-data/events`
 * and `/matchups` both work. The write side has exactly one producer:
 * `apps/ingestor/src/entity-resolver.ts`, and the ingestor is parked under
 * containment (`SYNDICATE_MACHINE_MODE=parked`). So while containment holds there is
 * no governed way to make a *current* game selectable, and the one event that exists
 * for the Human Capper canary was hand-seeded by raw SQL.
 *
 * Raw SQL is not a routine operating path, and it left two measurable defects behind.
 * Measured in production on 2026-09-18, event `16924899-2a8c-4f90-9c0c-1f45e3230d79`
 * ("Lions @ Bills", 2026-09-17):
 *
 *   1. `external_id` is NULL, so the row has no stable identity. Every one of the 19
 *      provider-ingested events in the same window carries one, and re-running the
 *      seed could only ever have produced a second row beside it.
 *   2. It has zero `event_participants` rows, where every provider event has exactly
 *      two. `/api/reference-data/matchups` therefore returns it with `"teams": []`
 *      and a capper cannot pick a side from it.
 *
 * Both are the same failure: writing an event, its identity and its participants is
 * several statements, and a human doing it by hand can do one and forget the rest.
 * This tool cannot. It derives a deterministic `external_id` and resolves both
 * participants *before* it writes anything, then writes the event and both
 * participant rows together.
 *
 * ## What it deliberately does NOT do
 *
 * It does not make an operator-seeded event gradeable. `TRUSTED_GRADING_EVENT_PROVIDERS`
 * in `apps/api/src/grading-service.ts` is `new Set(['sgo'])`, and an event whose
 * provenance is `operator-manual-entry` fails closed there with
 * `event_provenance_untrusted_provider`. That is correct and is not a gap to route
 * around: seeding an event identity so a pick can be *submitted* is a different claim
 * from asserting a *result*, and results still come from a trusted provider or from
 * the attested operator settlement path. A tool that quietly made manual entry
 * gradeable would turn "I typed this in" into "the game finished this way".
 *
 * It mints no participants. Every participant must already exist in the canonical
 * catalog; an unknown one is refused by name rather than created, because a catalog
 * this tool is allowed to extend is a catalog that stops meaning anything.
 *
 * It activates nothing: no provider, no ingestion, no containment flag, no delivery.
 */
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import type {
  EventRow,
  EventStatus,
  ParticipantRow,
  RepositoryBundle,
} from '@unit-talk/db';
import { pathToFileURL } from 'node:url';

/** The one provenance value this tool writes, and the only one it will overwrite. */
export const OPERATOR_EVENT_SOURCE = 'operator-manual-entry';

/**
 * The `external_id` namespace for an operator-seeded event.
 *
 * Load-bearing: it is what makes a collision with a provider row impossible rather
 * than merely unlikely. Every provider external id is the provider's own key; nothing
 * upstream emits this prefix, so `upsertByExternalId` can never silently adopt a
 * provider's event, and `assertNotProviderOwned` below refuses even if one somehow did.
 */
export const OPERATOR_EVENT_EXTERNAL_ID_PREFIX = 'operator-manual';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SeedOperatorEventOptions {
  sport: string;
  /** Calendar date of the event, `YYYY-MM-DD`, as `events.event_date` stores it. */
  date: string;
  /** Absolute kickoff instant, ISO-8601 with an explicit offset. */
  startsAt: string;
  /** Canonical external id or exact display name of the home participant. */
  home: string;
  /** Canonical external id or exact display name of the away participant. */
  away: string;
  /** Who is seeding. Recorded verbatim; never defaulted. */
  operator: string;
  status: EventStatus;
  /** Without this the tool resolves, reports, and writes nothing. */
  apply: boolean;
}

export interface SeedOperatorEventPlan {
  externalId: string;
  eventName: string;
  sport: string;
  eventDate: string;
  status: EventStatus;
  home: { participantId: string; externalId: string; displayName: string };
  away: { participantId: string; externalId: string; displayName: string };
  metadata: Record<string, unknown>;
}

export class OperatorEventSeedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OperatorEventSeedError';
    this.code = code;
  }
}

/**
 * Deterministic, so re-running the same seed updates the same row instead of
 * accumulating near-duplicates that a capper would then have to choose between.
 */
export function buildOperatorEventExternalId(input: {
  sport: string;
  date: string;
  homeExternalId: string;
  awayExternalId: string;
}): string {
  return [
    OPERATOR_EVENT_EXTERNAL_ID_PREFIX,
    input.sport.toUpperCase(),
    input.date,
    `${input.awayExternalId}@${input.homeExternalId}`,
  ].join(':');
}

export function buildOperatorEventMetadata(input: {
  operator: string;
  startsAt: string;
  homeExternalId: string;
  awayExternalId: string;
  homeDisplayName: string;
  awayDisplayName: string;
  seededAt: string;
}): Record<string, unknown> {
  return {
    // Read by grading-service.ts, which has no entry for it and therefore refuses.
    source: OPERATOR_EVENT_SOURCE,
    providerIngested: false,
    seededBy: `operator:${input.operator}`,
    seededAt: input.seededAt,
    seedTool: 'scripts/ops/seed-operator-event.ts',
    // Same key names the ingestor writes, so existing readers work unchanged. The
    // provenance fields above are what distinguish this row from a provider row --
    // never the shape.
    starts_at: input.startsAt,
    home_team_external_id: input.homeExternalId,
    away_team_external_id: input.awayExternalId,
    home_team: input.homeDisplayName,
    away_team: input.awayDisplayName,
  };
}

/**
 * Refuses to overwrite a row this tool did not create.
 *
 * `upsertByExternalId` would otherwise replace a provider-ingested event's metadata
 * with manual provenance and report success -- turning observed data into asserted
 * data with no record that it happened.
 */
export function assertNotProviderOwned(existing: EventRow | null): void {
  if (!existing) return;
  const metadata = (existing.metadata ?? {}) as Record<string, unknown>;
  const source = typeof metadata['source'] === 'string' ? metadata['source'] : null;
  if (source !== OPERATOR_EVENT_SOURCE) {
    throw new OperatorEventSeedError(
      'event_not_operator_owned',
      `event ${existing.id} already exists with source ${JSON.stringify(source)}; this tool only updates rows whose source is "${OPERATOR_EVENT_SOURCE}"`,
    );
  }
}

/**
 * Exact canonical `external_id` first, then an exact case-insensitive display name.
 *
 * Both halves refuse rather than guess. No prefix matching, no fuzzy scoring: the
 * failure mode of a near match here is a pick attributed to the wrong team, which is
 * worse than an operator having to type the canonical id.
 */
export function resolveParticipant(catalog: readonly ParticipantRow[], token: string): ParticipantRow {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new OperatorEventSeedError('participant_token_empty', 'participant token is empty');
  }

  const byExternalId = catalog.filter((row) => row.external_id === trimmed);
  if (byExternalId.length === 1) return byExternalId[0]!;

  const lowered = trimmed.toLowerCase();
  const byName = catalog.filter((row) => row.display_name.toLowerCase() === lowered);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new OperatorEventSeedError(
      'participant_ambiguous',
      `${JSON.stringify(trimmed)} matches ${byName.length} participants (${byName.map((r) => r.external_id).join(', ')}); use the canonical external id`,
    );
  }

  throw new OperatorEventSeedError(
    'participant_not_found',
    `${JSON.stringify(trimmed)} is not in the canonical participant catalog; participants are never minted by this tool`,
  );
}

/**
 * `participants.external_id` is nullable, and the deterministic event id is built from
 * it. A participant without one cannot produce a stable event identity, so it is
 * refused here rather than silently producing `...:null@null` -- an id that would
 * collide with every other such pair.
 */
export function requireParticipantExternalId(row: ParticipantRow): string {
  const externalId = row.external_id?.trim();
  if (!externalId) {
    throw new OperatorEventSeedError(
      'participant_missing_external_id',
      `participant ${row.id} (${row.display_name}) has no canonical external_id; it cannot anchor an event identity`,
    );
  }
  return externalId;
}

export function parseCli(argv: readonly string[]): SeedOperatorEventOptions {
  const flags = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith('--')) continue;
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new OperatorEventSeedError('missing_flag_value', `missing value for ${arg}`);
    }
    flags.set(arg.slice(2), value);
    index += 1;
  }

  // Reported together. A tool that names one missing flag per run costs an operator
  // one round trip per flag; this repository has already paid for that lesson.
  const required = ['sport', 'date', 'starts-at', 'home', 'away', 'operator'] as const;
  const missing = required.filter((name) => !flags.get(name));
  if (missing.length > 0) {
    throw new OperatorEventSeedError(
      'missing_required_flags',
      `missing required flag(s): ${missing.map((name) => `--${name}`).join(' ')}`,
    );
  }

  const date = flags.get('date')!;
  if (!ISO_DATE_RE.test(date)) {
    throw new OperatorEventSeedError('invalid_date', `--date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
  }

  const startsAt = flags.get('starts-at')!;
  const parsedStartsAt = new Date(startsAt);
  if (Number.isNaN(parsedStartsAt.getTime())) {
    throw new OperatorEventSeedError('invalid_starts_at', `--starts-at is not a valid instant: ${JSON.stringify(startsAt)}`);
  }

  const status = (flags.get('status') ?? 'scheduled') as EventStatus;
  const allowedStatuses: readonly EventStatus[] = ['scheduled', 'in_progress', 'completed', 'postponed', 'cancelled'];
  if (!allowedStatuses.includes(status)) {
    throw new OperatorEventSeedError('invalid_status', `--status must be one of ${allowedStatuses.join(', ')}`);
  }

  const home = flags.get('home')!;
  const away = flags.get('away')!;
  if (home.trim().toLowerCase() === away.trim().toLowerCase()) {
    throw new OperatorEventSeedError('home_equals_away', 'home and away resolve to the same token');
  }

  return {
    sport: flags.get('sport')!.toUpperCase(),
    date,
    startsAt: parsedStartsAt.toISOString(),
    home,
    away,
    operator: flags.get('operator')!,
    status,
    apply,
  };
}

/**
 * Resolves everything, then writes. The ordering is the whole point: a refusal must
 * happen before any row exists, so a half-seeded event is not reachable.
 */
export async function seedOperatorEvent(
  repositories: Pick<RepositoryBundle, 'participants' | 'events' | 'eventParticipants'>,
  options: SeedOperatorEventOptions,
  now: () => Date = () => new Date(),
): Promise<{ plan: SeedOperatorEventPlan; applied: boolean; eventId: string | null }> {
  const catalog = await repositories.participants.listByType('team', options.sport);
  if (catalog.length === 0) {
    throw new OperatorEventSeedError(
      'catalog_empty',
      `no team participants exist for sport ${options.sport}; seed the canonical catalog before seeding events`,
    );
  }

  const home = resolveParticipant(catalog, options.home);
  const away = resolveParticipant(catalog, options.away);
  if (home.id === away.id) {
    throw new OperatorEventSeedError('home_equals_away', `home and away both resolve to participant ${home.id} (${home.display_name})`);
  }

  const homeExternalId = requireParticipantExternalId(home);
  const awayExternalId = requireParticipantExternalId(away);

  const externalId = buildOperatorEventExternalId({
    sport: options.sport,
    date: options.date,
    homeExternalId,
    awayExternalId,
  });

  const existing = await repositories.events.findByExternalId(externalId);
  assertNotProviderOwned(existing);

  const metadata = buildOperatorEventMetadata({
    operator: options.operator,
    startsAt: options.startsAt,
    homeExternalId,
    awayExternalId,
    homeDisplayName: home.display_name,
    awayDisplayName: away.display_name,
    seededAt: now().toISOString(),
  });

  const plan: SeedOperatorEventPlan = {
    externalId,
    eventName: `${away.display_name} @ ${home.display_name}`,
    sport: options.sport,
    eventDate: options.date,
    status: options.status,
    home: { participantId: home.id, externalId: homeExternalId, displayName: home.display_name },
    away: { participantId: away.id, externalId: awayExternalId, displayName: away.display_name },
    metadata,
  };

  if (!options.apply) {
    return { plan, applied: false, eventId: existing?.id ?? null };
  }

  const event = await repositories.events.upsertByExternalId({
    externalId,
    sportId: options.sport,
    eventName: plan.eventName,
    eventDate: options.date,
    status: options.status,
    metadata,
  });

  // Both, always. The hand-seeded canary is the counterexample: an event with no
  // participants is invisible to the matchup surface the Smart Form actually reads.
  await repositories.eventParticipants.upsert({ eventId: event.id, participantId: home.id, role: 'home' });
  await repositories.eventParticipants.upsert({ eventId: event.id, participantId: away.id, role: 'away' });

  return { plan, applied: true, eventId: event.id };
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const env = loadEnvironment();
  const repositories = createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(env));
  const result = await seedOperatorEvent(repositories, options);
  console.log(JSON.stringify(result, null, 2));
  if (!result.applied) {
    console.log('\nDry run: nothing was written. Re-run with --apply to seed.');
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    const code = error instanceof OperatorEventSeedError ? error.code : 'unexpected_error';
    console.error(JSON.stringify({ ok: false, code, message: String(error instanceof Error ? error.message : error) }, null, 2));
    process.exit(1);
  });
}
