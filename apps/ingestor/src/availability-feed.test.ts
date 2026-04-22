import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryParticipantRepository,
  type ParticipantRow,
  type SystemRunRepository,
  type SystemRunRecord,
} from '@unit-talk/db';
import { applyAvailabilityFeedRecords } from './availability-feed.js';

class FakeRunRepository {
  readonly runs: SystemRunRecord[] = [];

  async startRun(input: {
    runType: string;
    actor?: string;
    details: Record<string, unknown>;
  }): Promise<SystemRunRecord> {
    const now = new Date().toISOString();
    const run: SystemRunRecord = {
      id: `run-${this.runs.length + 1}`,
      run_type: input.runType,
      actor: input.actor ?? null,
      status: 'running',
      started_at: now,
      finished_at: null,
      details: input.details as SystemRunRecord['details'],
      idempotency_key: null,
      created_at: now,
    };
    this.runs.push(run);
    return run;
  }

  async completeRun(input: {
    runId: string;
    status: 'succeeded' | 'failed' | 'cancelled';
    details?: Record<string, unknown>;
  }): Promise<SystemRunRecord> {
    const run = this.runs.find((row) => row.id === input.runId);
    assert.ok(run, 'run should exist');
    run.status = input.status;
    run.finished_at = new Date().toISOString();
    run.details = (input.details as SystemRunRecord['details'] | undefined) ?? run.details;
    return run;
  }

  async listByType(runType: string, limit = 20): Promise<SystemRunRecord[]> {
    return this.runs
      .filter((run) => run.run_type === runType)
      .slice(0, limit);
  }
}

test('applyAvailabilityFeedRecords writes provider availability into participant metadata', async () => {
  const participants = new InMemoryParticipantRepository([
    makeParticipant({
      id: 'participant-1',
      external_id: 'provider-player-1',
      metadata: { headshot_url: 'https://example.test/headshot.png' },
    }),
  ]);
  const runs = new FakeRunRepository();

  const result = await applyAvailabilityFeedRecords(
    { participants, runs: runs as SystemRunRepository },
    [{
      source: 'sportsdata',
      providerParticipantId: 'provider-player-1',
      status: 'questionable',
      injuryNote: 'Hamstring',
      lastUpdatedAt: '2026-04-21T12:00:00.000Z',
      metadata: { reportId: 'injury-123' },
    }],
  );

  assert.equal(result.updated, 1);
  assert.equal(result.skipped, 0);

  const participant = await participants.findById('participant-1');
  const metadata = participant?.metadata as Record<string, unknown>;
  const availability = metadata['availability'] as Record<string, unknown>;
  assert.equal(availability['source'], 'sportsdata');
  assert.equal(availability['status'], 'questionable');
  assert.equal(availability['injuryNote'], 'Hamstring');
  assert.equal(metadata['headshot_url'], 'https://example.test/headshot.png');
  assert.equal(runs.runs[0]?.status, 'succeeded');
});

test('applyAvailabilityFeedRecords distinguishes missing participants and invalid statuses', async () => {
  const participants = new InMemoryParticipantRepository([]);
  const runs = new FakeRunRepository();

  const result = await applyAvailabilityFeedRecords(
    { participants, runs: runs as SystemRunRepository },
    [
      {
        source: 'sportsdata',
        providerParticipantId: 'missing-player',
        status: 'probable',
        lastUpdatedAt: '2026-04-21T12:00:00.000Z',
      },
      {
        source: 'sportsdata',
        providerParticipantId: 'missing-player',
        status: 'not-a-status',
        lastUpdatedAt: '2026-04-21T12:00:00.000Z',
      },
    ],
  );

  assert.equal(result.updated, 0);
  assert.equal(result.missingParticipant, 1);
  assert.equal(result.invalidStatus, 1);
  assert.equal(result.skipped, 2);
  assert.equal(runs.runs[0]?.status, 'succeeded');
});

function makeParticipant(overrides: Partial<ParticipantRow>): ParticipantRow {
  const now = '2026-04-21T12:00:00.000Z';
  return {
    id: 'participant-1',
    display_name: 'Test Player',
    external_id: 'provider-player-1',
    league: null,
    metadata: {},
    participant_type: 'player',
    sport: 'NBA',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}
