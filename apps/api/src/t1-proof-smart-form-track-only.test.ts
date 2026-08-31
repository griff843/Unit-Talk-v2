/**
 * T1 Pre-Merge Proof: UTV2-1672 Smart Form Track Only is load-bearing in Postgres.
 *
 * Every other control in this lane runs against in-memory repositories. That is
 * exactly the shape that has shipped broken before: the guard holds under
 * `InMemoryOutboxRepository` and diverges against the real database. This proof
 * exercises the shipped path -- `submitPickController` with live repositories,
 * and `DatabaseOutboxRepository` against real Postgres -- and asserts the three
 * properties the lane claims:
 *
 *   1. A Track Only Smart Form submission persists as Track Only and produces
 *      zero rows in `distribution_outbox`.
 *   2. The repository chokepoint refuses a direct `enqueue` for that persisted
 *      pick, so no route -- including ones that bypass every per-route guard --
 *      can create delivery work for it.
 *   3. The same chokepoint refuses `enqueueDistributionAtomic`, so the
 *      server-side atomic path is not a way around it, and refuses rather than
 *      allows when the pick row cannot be read at all.
 *
 * No member delivery is created and no existing row is mutated. Fixtures are
 * tagged `utv2-1672-trackonly-*` and left in place; a Track Only pick cannot
 * become actionable, which is the property being proved.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. In CI this runs only against staging --
 * `ci:assert-staging` refuses any other target.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-smart-form-track-only.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  DatabaseOutboxRepository,
  TrackOnlyDeliveryForbiddenError,
  type DatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import { submitPickController } from './controllers/submit-pick-controller.js';

function hasSupabaseSmokeEnvironment() {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseSmokeEnvironment()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

let repositories: RepositoryBundle;
let connection: DatabaseConnectionConfig;
let supabaseUrl: string;
let serviceRoleKey: string;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  supabaseUrl = env.SUPABASE_URL!;
  serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY!;
  connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
});

async function restQuery<T>(path: string): Promise<T[]> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  return body as T[];
}

/**
 * A Smart Form submission in the shape the form actually sends: Track Only,
 * with a manual coverage-gap resolution over names no canonical catalog holds.
 */
function trackOnlySubmission(fixtureId: string): SubmissionPayload {
  const eventName = `Nobody Atall vs Someone Else Entirely ${fixtureId}`;
  return {
    source: 'smart-form',
    submittedBy: 'utv2-1672-proof-capper',
    market: 'moneyline',
    selection: `UTV2-1672 TRACK ONLY ${fixtureId}`,
    odds: -110,
    stakeUnits: 1,
    confidence: 70,
    eventName,
    metadata: {
      proof_fixture_id: fixtureId,
      proof_issue: 'UTV2-1672',
      sport: 'MMA',
      distributionMode: 'track-only',
      participantResolution: {
        resolution: 'manual',
        sportId: 'MMA',
        eventId: null,
        manualOverride: true,
        reason: 'canonical-coverage-gap',
        enteredEventName: eventName,
        enteredParticipants: [
          { role: 'competitor', displayName: `Nobody Atall ${fixtureId}`, canonicalParticipantId: null },
          { role: 'competitor', displayName: `Someone Else Entirely ${fixtureId}`, canonicalParticipantId: null },
        ],
      },
    },
  };
}

interface OutboxRow {
  id: string;
  pick_id: string;
  status: string;
  target: string;
}

interface PickRow {
  id: string;
  source: string;
  metadata: Record<string, unknown> | null;
}

test(
  'UTV2-1672: a Track Only Smart Form submission persists as Track Only and creates zero delivery rows',
  { skip: skipReason },
  async () => {
    const fixtureId = `utv2-1672-trackonly-${randomUUID()}`;
    const response = await submitPickController(trackOnlySubmission(fixtureId), repositories);

    assert.equal(response.status, 201, `expected 201, got ${response.status}: ${JSON.stringify(response.body)}`);
    assert.ok(response.body.ok, 'submission was refused');
    const data = (response.body as { ok: true; data: { pickId: string; outboxEnqueued: boolean } }).data;
    assert.equal(data.outboxEnqueued, false, 'Track Only must not report enqueued delivery work');

    const picks = await restQuery<PickRow>(`picks?id=eq.${data.pickId}&select=id,source,metadata`);
    assert.equal(picks.length, 1, 'the pick must be persisted');
    assert.equal(picks[0]!.source, 'smart-form');
    assert.equal(
      (picks[0]!.metadata ?? {})['distributionMode'],
      'track-only',
      'Track Only must be persisted, not merely honoured in memory',
    );

    const rows = await restQuery<OutboxRow>(
      `distribution_outbox?pick_id=eq.${data.pickId}&select=id,pick_id,status,target`,
    );
    assert.deepEqual(rows, [], `Track Only pick produced delivery work: ${JSON.stringify(rows)}`);
  },
);

test(
  'UTV2-1672: the repository chokepoint refuses direct and atomic enqueue for a persisted Track Only pick',
  { skip: skipReason },
  async () => {
    const fixtureId = `utv2-1672-trackonly-${randomUUID()}`;
    const response = await submitPickController(trackOnlySubmission(fixtureId), repositories);
    assert.ok(response.body.ok, 'submission was refused');
    const pickId = (response.body as { ok: true; data: { pickId: string } }).data.pickId;

    const outbox = new DatabaseOutboxRepository(connection);

    // A route that bypasses every per-route guard still cannot create the row.
    await assert.rejects(
      () =>
        outbox.enqueue({
          pickId,
          target: 'discord:best-bets',
          payload: { note: 'UTV2-1672 live chokepoint proof' },
          idempotencyKey: `${fixtureId}-direct`,
        }),
      (error: unknown) => error instanceof TrackOnlyDeliveryForbiddenError,
      'the direct enqueue chokepoint did not hold against Postgres',
    );

    // Nor can the server-side atomic path.
    await assert.rejects(
      () =>
        outbox.enqueueDistributionAtomic({
          pickId,
          fromState: 'qualified',
          toState: 'distributing',
          writerRole: 'api',
          reason: 'UTV2-1672 live chokepoint proof',
          lifecycleCreatedAt: new Date().toISOString(),
          outboxTarget: 'discord:best-bets',
          outboxPayload: { note: 'UTV2-1672 live chokepoint proof' },
          outboxIdempotencyKey: `${fixtureId}-atomic`,
        }),
      (error: unknown) => error instanceof TrackOnlyDeliveryForbiddenError,
      'the atomic enqueue chokepoint did not hold against Postgres',
    );

    const rows = await restQuery<OutboxRow>(
      `distribution_outbox?pick_id=eq.${pickId}&select=id,pick_id,status,target`,
    );
    assert.deepEqual(rows, [], `refused calls still left delivery work: ${JSON.stringify(rows)}`);
  },
);

test(
  'UTV2-1672: the chokepoint refuses rather than allows when the pick row cannot be read',
  { skip: skipReason },
  async () => {
    const outbox = new DatabaseOutboxRepository(connection);
    await assert.rejects(
      () =>
        outbox.enqueue({
          pickId: randomUUID(),
          target: 'discord:best-bets',
          payload: {},
          idempotencyKey: `utv2-1672-unreadable-${randomUUID()}`,
        }),
      /Track Only status cannot be established/u,
      'an unreadable pick row must not be treated as safe to deliver',
    );
  },
);
