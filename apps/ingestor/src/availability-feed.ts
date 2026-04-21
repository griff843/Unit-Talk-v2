import type { IngestorRepositoryBundle, ParticipantRow } from '@unit-talk/db';

type AvailabilityStatus =
  | 'confirmed'
  | 'probable'
  | 'questionable'
  | 'doubtful'
  | 'out'
  | 'unknown';

const AVAILABILITY_STATUSES = new Set([
  'confirmed',
  'probable',
  'questionable',
  'doubtful',
  'out',
  'unknown',
] satisfies AvailabilityStatus[]);

export interface AvailabilityFeedRecord {
  source: string;
  participantId?: string | null;
  providerParticipantId?: string | null;
  status: string;
  injuryNote?: string | null;
  lastUpdatedAt: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface AvailabilityFeedResult {
  processed: number;
  updated: number;
  skipped: number;
  missingParticipant: number;
  invalidStatus: number;
}

export async function applyAvailabilityFeedRecords(
  repositories: Pick<IngestorRepositoryBundle, 'participants' | 'runs'>,
  records: AvailabilityFeedRecord[],
): Promise<AvailabilityFeedResult> {
  const result: AvailabilityFeedResult = {
    processed: records.length,
    updated: 0,
    skipped: 0,
    missingParticipant: 0,
    invalidStatus: 0,
  };

  const run = await repositories.runs.startRun({
    runType: 'availability.feed',
    actor: 'ingestor',
    details: {
      records: records.length,
      sources: [...new Set(records.map((record) => record.source))],
    },
  });

  try {
    for (const record of records) {
      const status = normalizeAvailabilityStatus(record.status);
      if (!status) {
        result.invalidStatus += 1;
        result.skipped += 1;
        continue;
      }

      const participant = await resolveParticipant(repositories.participants, record);
      if (!participant) {
        result.missingParticipant += 1;
        result.skipped += 1;
        continue;
      }

      await repositories.participants.updateMetadata(participant.id, {
        availability: {
          source: record.source,
          status,
          injuryNote: cleanString(record.injuryNote),
          lastUpdatedAt: record.lastUpdatedAt,
          providerParticipantId: cleanString(record.providerParticipantId),
          metadata: record.metadata ?? {},
        },
      });
      result.updated += 1;
    }

    await repositories.runs.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: { ...result },
    });
    return result;
  } catch (error) {
    await repositories.runs.completeRun({
      runId: run.id,
      status: 'failed',
      details: {
        ...result,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

function normalizeAvailabilityStatus(value: string): AvailabilityStatus | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'active' || normalized === 'available') return 'confirmed';
  if (normalized === 'day_to_day') return 'questionable';
  if (normalized === 'inactive' || normalized === 'ruled_out') return 'out';
  return AVAILABILITY_STATUSES.has(normalized as AvailabilityStatus)
    ? (normalized as AvailabilityStatus)
    : null;
}

async function resolveParticipant(
  participants: IngestorRepositoryBundle['participants'],
  record: AvailabilityFeedRecord,
): Promise<ParticipantRow | null> {
  const participantId = cleanString(record.participantId);
  if (participantId) {
    const participant = await participants.findById(participantId);
    if (participant) return participant;
  }

  const providerParticipantId = cleanString(record.providerParticipantId);
  if (providerParticipantId) {
    return participants.findByExternalId(providerParticipantId);
  }

  return null;
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
