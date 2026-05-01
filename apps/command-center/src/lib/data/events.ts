/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDataClient } from './client';
import { normalizePayload, summarizePayload, type EventStreamRecord } from '../events-feed';

type Client = any;

interface EventStreamResponse {
  events: EventStreamRecord[];
  observedAt: string;
}

export async function getEventStream(limit = 250): Promise<EventStreamResponse> {
  const client = getDataClient() as Client;
  const boundedLimit = Math.min(Math.max(limit, 25), 500);

  const { data, error } = await client
    .from('submission_events')
    .select('id, event_name, payload, created_at, submission_id, submissions(source)')
    .order('created_at', { ascending: false })
    .limit(boundedLimit);

  if (error) {
    throw new Error(`Failed to load submission events: ${error.message}`);
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const events = rows.map(mapSubmissionEventRow);

  return {
    events,
    observedAt: new Date().toISOString(),
  };
}

function mapSubmissionEventRow(row: Record<string, unknown>): EventStreamRecord {
  const payload = normalizePayload(row['payload']);
  const submissionsRelation = row['submissions'];
  const relationRow = Array.isArray(submissionsRelation)
    ? normalizePayload(submissionsRelation[0])
    : normalizePayload(submissionsRelation);

  const source =
    (typeof relationRow?.['source'] === 'string' && relationRow['source'].trim()) ||
    (typeof payload?.['source'] === 'string' && payload['source'].trim()) ||
    'submission-service';

  return {
    id: String(row['id'] ?? ''),
    timestamp: typeof row['created_at'] === 'string' ? row['created_at'] : new Date(0).toISOString(),
    type: typeof row['event_name'] === 'string' ? row['event_name'] : 'unknown',
    source,
    summary: summarizePayload(payload),
    payload,
    submissionId: typeof row['submission_id'] === 'string' ? row['submission_id'] : null,
  };
}
