import { createHash } from 'node:crypto';

import type {
  EventRow,
  EventUpsertInput,
  IngestorRepositoryBundle,
  ParticipantRow,
  ParticipantUpsertInput,
} from '@unit-talk/db';

import { INGESTOR_WRITE_SURFACE } from './write-surface.js';

/** One write a dry run recorded instead of performing. */
export interface DryRunWrite {
  readonly repository: string;
  readonly method: string;
  /** The physical table, taken from INGESTOR_WRITE_SURFACE rather than named here. */
  readonly table: string;
  /** A short, non-secret identity for the row -- an external id where one exists. */
  readonly subject: string | null;
}

export interface DryRunReport {
  readonly writes: readonly DryRunWrite[];
  /** Write count per physical table, most-written first. */
  readonly byTable: ReadonlyArray<{ table: string; count: number }>;
  /** External ids of events the run would have created rather than matched. */
  readonly newEventExternalIds: readonly string[];
  /** External ids of participants the run would have created rather than matched. */
  readonly newParticipantExternalIds: readonly string[];
}

export interface DryRunBundle {
  readonly repositories: IngestorRepositoryBundle;
  report(): DryRunReport;
}

/**
 * Wraps an ingestor repository bundle so a run performs **no writes at all** while
 * still producing an accurate account of what it would have written.
 *
 * UTV2-1866. An operator-run results backfill is a production write, and asking for one
 * without being able to say what it touches is not a request anybody should approve.
 * This is the "show me first" half: `pnpm backfill:sgo-history --results-only --dry-run`
 * reports the blast radius of the exact window it was given.
 *
 * Reads pass through to the real bundle and are then overlaid with the writes this run
 * has already simulated. The overlay is what makes the report trustworthy: results
 * resolution upserts an event and then inserts results against the id that upsert
 * returned. Without the overlay a would-be-created event would be invisible to the
 * following `findByExternalId`, and every result under it would be counted
 * `skippedEventNotFound` -- an undercount that reads as a *smaller* blast radius than
 * the real run would have, which is the one direction a safety tool must never err in.
 *
 * Simulated rows carry a deterministic `dry-run:` id derived from the external id, so a
 * report is reproducible and a simulated id can never be mistaken for a real one.
 */
export function createDryRunIngestorRepositoryBundle(
  real: IngestorRepositoryBundle,
): DryRunBundle {
  const writes: DryRunWrite[] = [];
  const eventOverlay = new Map<string, EventRow>();
  const participantOverlay = new Map<string, ParticipantRow>();
  const newEventExternalIds = new Set<string>();
  const newParticipantExternalIds = new Set<string>();

  const record = (
    repository: string,
    method: string,
    subject: string | null,
  ): void => {
    const key = `${repository}.${method}`;
    const table = INGESTOR_WRITE_SURFACE[key];
    if (table === undefined) {
      // Fail closed. An unclassified write means write-surface.ts is stale, and a dry
      // run that silently dropped it would under-report exactly what it exists to
      // report. Refusing is the only safe direction.
      throw new Error(
        `dry run refused: ${key} is not classified in INGESTOR_WRITE_SURFACE`,
      );
    }
    writes.push({ repository, method, table, subject });
  };

  const syntheticId = (kind: string, seed: string): string =>
    `dry-run:${kind}:${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;

  const now = new Date(0).toISOString();

  /**
   * A stand-in for a generated table row the caller never reads.
   *
   * Several repository writes return the persisted row, and a few of those rows are
   * generated types with columns this simulation has no value for. Where the ingestor
   * ignores the return value, synthesising the whole row would be inventing data; where
   * it does read it -- `events`, `participants`, `system_runs.id` -- the fields it reads
   * are populated for real above rather than routed through here.
   */
  const simulatedRow = <T>(fields: unknown): T => fields as T;

  const events: IngestorRepositoryBundle['events'] = {
    async upsertByExternalId(input: EventUpsertInput): Promise<EventRow> {
      record('events', 'upsertByExternalId', input.externalId);
      const existing =
        eventOverlay.get(input.externalId) ??
        (await real.events.findByExternalId(input.externalId));
      if (existing === null || existing === undefined) {
        newEventExternalIds.add(input.externalId);
      }
      const row: EventRow = {
        id: existing?.id ?? syntheticId('event', input.externalId),
        sport_id: input.sportId,
        event_name: input.eventName,
        event_date: input.eventDate,
        status: input.status,
        external_id: input.externalId,
        metadata: input.metadata ?? {},
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      eventOverlay.set(input.externalId, row);
      return row;
    },
    async findById(eventId) {
      for (const row of eventOverlay.values()) {
        if (row.id === eventId) return row;
      }
      return real.events.findById(eventId);
    },
    async findByExternalId(externalId) {
      return (
        eventOverlay.get(externalId) ??
        (await real.events.findByExternalId(externalId))
      );
    },
    listUpcoming: (sportId, windowDays) =>
      real.events.listUpcoming(sportId, windowDays),
    listByName: (eventName) => real.events.listByName(eventName),
    listStartedBySnapshot: (snapshotAt) =>
      real.events.listStartedBySnapshot(snapshotAt),
  };

  const participants: IngestorRepositoryBundle['participants'] = {
    async upsertByExternalId(
      input: ParticipantUpsertInput,
    ): Promise<ParticipantRow> {
      record('participants', 'upsertByExternalId', input.externalId);
      const existing =
        participantOverlay.get(input.externalId) ??
        (await real.participants.findByExternalId(input.externalId));
      if (existing === null || existing === undefined) {
        newParticipantExternalIds.add(input.externalId);
      }
      // `participants` is a generated table row with columns this simulation has no
      // value for. Spreading the matched row keeps a real one intact; the synthetic
      // branch fills only what resolution reads and is never persisted.
      const row = {
        ...(existing ?? {}),
        id: existing?.id ?? syntheticId('participant', input.externalId),
        external_id: input.externalId,
        display_name: input.displayName,
        participant_type: input.participantType,
        sport: input.sport,
        league: input.league ?? null,
        metadata: (input.metadata ?? {}) as ParticipantRow['metadata'],
      } as ParticipantRow;
      participantOverlay.set(input.externalId, row);
      return row;
    },
    async findById(participantId) {
      for (const row of participantOverlay.values()) {
        if (row.id === participantId) return row;
      }
      return real.participants.findById(participantId);
    },
    async findByExternalId(externalId) {
      return (
        participantOverlay.get(externalId) ??
        (await real.participants.findByExternalId(externalId))
      );
    },
    async listByType(participantType, sport) {
      const persisted = await real.participants.listByType(participantType, sport);
      const simulated = [...participantOverlay.values()].filter(
        (row) =>
          row.participant_type === participantType &&
          (sport === undefined || row.sport === sport) &&
          !persisted.some((existing) => existing.id === row.id),
      );
      return [...persisted, ...simulated];
    },
    async updateMetadata(participantId, metadata) {
      record('participants', 'updateMetadata', participantId);
      let existing: ParticipantRow | null = null;
      for (const row of participantOverlay.values()) {
        if (row.id === participantId) existing = row;
      }
      existing ??= await real.participants.findById(participantId);
      if (!existing) {
        throw new Error(`dry run: participant ${participantId} does not exist`);
      }
      const row: ParticipantRow = {
        ...existing,
        metadata: metadata as ParticipantRow['metadata'],
      };
      if (row.external_id !== null) {
        participantOverlay.set(row.external_id, row);
      }
      return row;
    },
  };

  const eventParticipants: IngestorRepositoryBundle['eventParticipants'] = {
    async upsert(input) {
      record(
        'eventParticipants',
        'upsert',
        `${input.eventId}:${input.participantId}`,
      );
      return {
        id: syntheticId('event_participant', `${input.eventId}:${input.participantId}`),
        event_id: input.eventId,
        participant_id: input.participantId,
        role: input.role,
        created_at: now,
      };
    },
    listByEvent: (eventId) => real.eventParticipants.listByEvent(eventId),
    listByParticipant: (participantId) =>
      real.eventParticipants.listByParticipant(participantId),
  };

  const gradeResults: IngestorRepositoryBundle['gradeResults'] = {
    async insert(input) {
      record('gradeResults', 'insert', `${input.eventId}:${input.marketKey}`);
      return {
        id: syntheticId('game_result', `${input.eventId}:${input.marketKey}`),
        event_id: input.eventId,
        market_key: input.marketKey,
        participant_id: input.participantId ?? null,
        actual_value: input.actualValue,
        source: input.source,
        sourced_at: input.sourcedAt ?? now,
        created_at: now,
      };
    },
    findResult: (...args) => real.gradeResults.findResult(...args),
    listByEvent: (eventId) => real.gradeResults.listByEvent(eventId),
  };

  const rawPayloads: IngestorRepositoryBundle['rawPayloads'] = {
    async insert(input) {
      record('rawPayloads', 'insert', `${input.providerKey}:${input.kind}`);
      return simulatedRow(
        { id: syntheticId('raw_payload', `${input.providerKey}:${input.kind}`) },
      );
    },
  };

  const runs: IngestorRepositoryBundle['runs'] = {
    async startRun(input) {
      record('runs', 'startRun', input.runType);
      return simulatedRow({
        id: syntheticId('run', `${input.runType}:${writes.length}`),
      });
    },
    async completeRun(input) {
      record('runs', 'completeRun', input.runId);
      return simulatedRow({ id: input.runId });
    },
    listByType: (runType, limit) => real.runs.listByType(runType, limit),
    async reapStaleRuns(...args) {
      record('runs', 'reapStaleRuns', null);
      void args;
      return simulatedRow([]);
    },
  };

  const oddsSnapshots: IngestorRepositoryBundle['oddsSnapshots'] = {
    async insert(input) {
      record('oddsSnapshots', 'insert', `${input.providerKey}:${input.league}`);
      return simulatedRow(
        { id: syntheticId('odds_snapshot', `${input.providerKey}:${input.league}`) },
      );
    },
    findLatestByProviderLeague: (...args) =>
      real.oddsSnapshots.findLatestByProviderLeague(...args),
    queryAtTimestamp: (...args) => real.oddsSnapshots.queryAtTimestamp(...args),
  };

  // `providerOffers` has 22 methods and a results-only run reaches none of its writes.
  // Wrapping it by hand would be 22 forwarders that drift the moment the interface
  // changes; the proxy forwards every read untouched and intercepts exactly the methods
  // INGESTOR_WRITE_SURFACE classifies as writes, so a newly added write is intercepted
  // without an edit here.
  const providerOffers = new Proxy(real.providerOffers, {
    get(target, property, receiver) {
      const key = `providerOffers.${String(property)}`;
      if (!(key in INGESTOR_WRITE_SURFACE)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return (...args: unknown[]) => {
        record('providerOffers', String(property), null);
        void args;
        return Promise.resolve(undefined);
      };
    },
  });

  return {
    repositories: {
      providerOffers,
      runs,
      events,
      eventParticipants,
      participants,
      gradeResults,
      rawPayloads,
      oddsSnapshots,
    },
    report(): DryRunReport {
      const counts = new Map<string, number>();
      for (const write of writes) {
        counts.set(write.table, (counts.get(write.table) ?? 0) + 1);
      }
      return {
        writes: [...writes],
        byTable: [...counts.entries()]
          .map(([table, count]) => ({ table, count }))
          .sort((a, b) => b.count - a.count || a.table.localeCompare(b.table)),
        newEventExternalIds: [...newEventExternalIds],
        newParticipantExternalIds: [...newParticipantExternalIds],
      };
    },
  };
}
