type JsonObject = Record<string, unknown>;

interface SubmissionRow {
  id: string;
  submitted_by: string | null;
  payload: JsonObject | null;
}

interface ParticipantRow {
  id: string;
  display_name: string | null;
  participant_type: string | null;
}

interface EventRow {
  id: string;
  event_name: string | null;
  event_date: string | null;
}

interface SupabaseLikeClient {
  from: (table: string) => {
    select: (columns: string) => {
      in: (column: string, values: string[]) => Promise<{ data: unknown[]; error?: unknown }>;
    };
  };
}

const ENRICHMENT_BATCH_SIZE = 100;

function readJsonObject(value: unknown): JsonObject | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return null;
}

function readTrimmedString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function collectUniqueStringValues(rows: Array<Record<string, unknown>>, key: string) {
  return [...new Set(
    rows
      .map((row) => row[key])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
  )];
}

function readSubmissionPayload(value: unknown) {
  return readJsonObject(value);
}

function readEventId(metadata: JsonObject | null, submissionPayload: JsonObject | null) {
  const submissionMetadata = readJsonObject(submissionPayload?.['metadata']);
  return readTrimmedString(
    metadata?.['eventId'],
    submissionPayload?.['eventId'],
    submissionMetadata?.['eventId'],
  );
}

function mergeMetadata(
  metadata: JsonObject | null,
  patch: Record<string, string | null>,
): JsonObject {
  const next: JsonObject = { ...(metadata ?? {}) };

  for (const [key, value] of Object.entries(patch)) {
    if (value !== null) {
      next[key] = value;
    }
  }

  return next;
}

function chunkValues(values: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function enrichPickRowsWithIdentity(
  client: SupabaseLikeClient,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  if (rows.length === 0) {
    return rows;
  }

  const submissionIds = collectUniqueStringValues(rows, 'submission_id');
  const participantIds = collectUniqueStringValues(rows, 'participant_id');

  const submissionMap = new Map<string, SubmissionRow>();
  if (submissionIds.length > 0) {
    for (const batch of chunkValues(submissionIds, ENRICHMENT_BATCH_SIZE)) {
      const submissionResult = await client.from('submissions').select('id, submitted_by, payload').in('id', batch);
      for (const row of (submissionResult.data ?? []) as Array<Record<string, unknown>>) {
        const id = readTrimmedString(row['id']);
        if (!id) {
          continue;
        }
        submissionMap.set(id, {
          id,
          submitted_by: readTrimmedString(row['submitted_by']),
          payload: readJsonObject(row['payload']),
        });
      }
    }
  }

  const participantMap = new Map<string, ParticipantRow>();
  if (participantIds.length > 0) {
    for (const batch of chunkValues(participantIds, ENRICHMENT_BATCH_SIZE)) {
      const participantResult = await client.from('participants').select('id, display_name, participant_type').in('id', batch);
      for (const row of (participantResult.data ?? []) as Array<Record<string, unknown>>) {
        const id = readTrimmedString(row['id']);
        if (!id) {
          continue;
        }
        participantMap.set(id, {
          id,
          display_name: readTrimmedString(row['display_name']),
          participant_type: readTrimmedString(row['participant_type']),
        });
      }
    }
  }

  const eventIds = [...new Set(rows
    .map((row) => {
      const metadata = readJsonObject(row['metadata']);
      const submissionId = readTrimmedString(row['submission_id']);
      const submissionPayload = submissionId ? submissionMap.get(submissionId)?.payload ?? null : null;
      return readEventId(metadata, submissionPayload);
    })
    .filter((value): value is string => value !== null))];

  const eventMap = new Map<string, EventRow>();
  if (eventIds.length > 0) {
    for (const batch of chunkValues(eventIds, ENRICHMENT_BATCH_SIZE)) {
      const eventResult = await client.from('events').select('id, event_name, event_date').in('id', batch);
      for (const row of (eventResult.data ?? []) as Array<Record<string, unknown>>) {
        const id = readTrimmedString(row['id']);
        if (!id) {
          continue;
        }
        eventMap.set(id, {
          id,
          event_name: readTrimmedString(row['event_name']),
          event_date: readTrimmedString(row['event_date']),
        });
      }
    }
  }

  return rows.map((row) => {
    const metadata = readJsonObject(row['metadata']);
    const submissionId = readTrimmedString(row['submission_id']);
    const participantId = readTrimmedString(row['participant_id']);
    const submission = submissionId ? submissionMap.get(submissionId) ?? null : null;
    const submissionPayload = readSubmissionPayload(submission?.payload);
    const submissionMetadata = readJsonObject(submissionPayload?.['metadata']);
    const participant = participantId ? participantMap.get(participantId) ?? null : null;
    const eventId = readEventId(metadata, submissionPayload);
    const event = eventId ? eventMap.get(eventId) ?? null : null;

    const eventName = readTrimmedString(
      metadata?.['eventName'],
      submissionPayload?.['eventName'],
      submissionMetadata?.['eventName'],
      event?.event_name,
    );
    const eventStartTime = readTrimmedString(
      metadata?.['eventTime'],
      metadata?.['eventStartTime'],
      submissionPayload?.['eventTime'],
      submissionPayload?.['eventStartTime'],
      submissionMetadata?.['eventTime'],
      submissionMetadata?.['eventStartTime'],
      event?.event_date,
    );
    const submittedBy = readTrimmedString(
      row['submitted_by'],
      submission?.submitted_by,
      metadata?.['capper'],
      metadata?.['submittedBy'],
      submissionPayload?.['submittedBy'],
      submissionMetadata?.['submittedBy'],
    );
    const sport = readTrimmedString(
      row['sport_display_name'],
      row['sport_id'],
      metadata?.['sport'],
      submissionPayload?.['sport'],
      submissionMetadata?.['sport'],
      submissionMetadata?.['league'],
    );
    const existingPlayer = readTrimmedString(
      metadata?.['player'],
      submissionPayload?.['player'],
      submissionMetadata?.['player'],
    );
    const existingTeam = readTrimmedString(
      metadata?.['team'],
      submissionPayload?.['team'],
      submissionMetadata?.['team'],
    );

    const player =
      participant?.participant_type === 'player'
        ? readTrimmedString(existingPlayer, participant.display_name)
        : existingPlayer;
    const team =
      participant?.participant_type === 'team'
        ? readTrimmedString(existingTeam, participant.display_name)
        : existingTeam;

    const enrichedMetadata = mergeMetadata(metadata, {
      eventName,
      eventTime: eventStartTime,
      eventStartTime,
      submittedBy,
      sport,
      player,
      team,
    });

    return {
      ...row,
      metadata: enrichedMetadata,
      eventName,
      eventStartTime,
      matchup: eventName,
      submittedBy,
      submitter: readTrimmedString((row as Record<string, unknown>)['submitter'], submittedBy),
      capper_display_name: readTrimmedString(row['capper_display_name'], submittedBy),
      sport_display_name: readTrimmedString(row['sport_display_name'], sport),
      participant_display_name: participant?.display_name ?? null,
      participant_type: participant?.participant_type ?? null,
    };
  });
}

export function isFixtureLikePick(row: Record<string, unknown>) {
  const metadata = readJsonObject(row['metadata']);
  return Boolean(
    typeof metadata?.['proof_fixture_id'] === 'string' ||
    typeof metadata?.['proof_script'] === 'string' ||
    typeof metadata?.['test_key'] === 'string',
  );
}
