/**
 * T1 Live-DB Proof: UTV2-1842 — server-validated Smart Form fallbacks past the
 * event-existence gate, and Track Only non-delivery, against real Postgres.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The unit suites in `submission-service.test.ts`, `smart-form-validation.test.ts`
 * and `controllers/submit-pick-controller.test.ts` pin this lane's behaviour
 * against the in-memory repository bundle. They are the mutation-checked
 * controls, and they are honest about what they are: an in-process assertion
 * that the waiver is keyed on the server-validated classification.
 *
 * They cannot establish that the pick *lands in a real database*. The Milestone 1
 * blocker was never "the code path returns 201" -- it was that a genuine Track
 * Only submission carrying honest `canonical-coverage-gap` provenance could not
 * be persisted at all. Proving that requires a real row, in a real table, read
 * back through a channel that did not create it.
 *
 * WHAT THE LIVE-DB PORTION PROVES
 * -------------------------------
 * 1. The event-existence gate is genuinely ARMED on this database. The gate only
 *    fires once `events` is non-empty, so a proof of a waiver on an empty table
 *    would prove nothing. Test 2 is that control: a smart-form submission with
 *    no `participantResolution` at all, naming an event that does not exist, is
 *    still REFUSED. If the gate were dormant that submission would succeed and
 *    test 2 would fail.
 * 2. With the gate armed, a manual coverage-gap Track Only pick whose
 *    `eventName` matches no row is ACCEPTED, and the row is readable back out of
 *    `public.picks` over PostgREST with its provenance intact: the metadata
 *    records `resolution: manual`, `reason: canonical-coverage-gap` and
 *    `eventId: null`. The waiver does not launder the pick into claiming a
 *    canonical resolution it never had.
 * 3. That same pick creates ZERO rows in `public.distribution_outbox`. This is
 *    Milestone 1 step 6 in miniature and against live data: Track Only produced
 *    no delivery work, asserted by querying the delivery queue itself rather
 *    than by trusting the controller's `outboxEnqueued: false`.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE
 * -----------------------------------
 * It does not prove the structured team-fallback branch against a live database.
 * That branch requires a canonical team-sport catalog with coverage for exactly
 * one side of a matchup, and populating one is reference-data seeding under a
 * reserved provider decision. That branch's waiver is proven by the unit suite
 * and by mutation, and this file says so rather than implying live coverage it
 * does not have.
 *
 * It does not prove the browser half of Milestone 1. It starts at the API.
 *
 * FIXTURES
 * --------
 * Every row this file creates is tagged with `utv2-1842-<runId>` and is NOT
 * deleted, so it can be found after the run. No row it did not create is
 * mutated. The canonical-coverage claim is made with deliberately fabricated
 * participant names carrying the run id, so the `findCanonicalCoverage` check in
 * `validateManualResolution` cannot accidentally match a seeded fixture and turn
 * a real refusal into a passing test for the wrong reason.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY, and executed by the
 * `Writable DB proof (staging only)` job via `pnpm test:t1-proof:live`. It is
 * deliberately NOT in `test:t1-proof:local`, so `pnpm verify` never runs it.
 *
 * Run from a contained workstation it FAILS rather than skips, because
 * containment supplies a real service-role key alongside the loopback
 * `SUPABASE_URL` placeholder, so the credential guard above cannot see the
 * difference. That is the same behaviour every other `t1-proof-*` live file
 * has, and it is the safer of the two: a proof that skipped itself whenever the
 * database was unreachable would report green for a run that asserted nothing.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1842-fallback-event-gate.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import { submitPickController } from './controllers/submit-pick-controller.js';

function hasSupabaseEnv(): boolean {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseEnv()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

const RUN_ID = randomUUID().slice(0, 8);
let repositories: RepositoryBundle;
let supabaseUrl: string;
let serviceRoleKey: string;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  supabaseUrl = env.SUPABASE_URL!;
  serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY!;
  repositories = createDatabaseRepositoryBundle(
    createServiceRoleDatabaseConnectionConfig(env),
  );
});

function authHeaders() {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

async function restQuery<T>(path: string): Promise<T[]> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: authHeaders() });
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  }
  return body as T[];
}

/**
 * Guarantees the events table is non-empty, which is the precondition for the
 * gate firing at all. The row is upserted rather than assumed: relying on
 * whatever staging happens to hold would make both tests below conditional on
 * unrelated fixture state.
 *
 * `events.sport_id` is a foreign key to `sports.id`, so the sport cannot be a
 * hardcoded string -- a literal 'nba' is refused with
 * `events_sport_id_fkey` on any database whose sport ids are not that.
 * Resolving a real id from `sports` keeps the fixture legal wherever this runs,
 * and an empty `sports` table is reported as the environment problem it is
 * rather than being papered over with a fabricated id.
 */
async function armTheGate(label: string): Promise<void> {
  const sports = await restQuery<{ id: string }>('sports?select=id&limit=1');
  assert.equal(
    sports.length,
    1,
    'the sports catalog is empty, so no legal event fixture can be created; the gate cannot be armed and nothing below would prove anything',
  );
  await repositories.events.upsertByExternalId({
    externalId: `utv2-1842-${RUN_ID}-${label}`,
    sportId: sports[0]!.id,
    eventName: `UTV2-1842 unrelated event ${RUN_ID} ${label}`,
    eventDate: new Date().toISOString().slice(0, 10),
    status: 'scheduled',
    metadata: { proof_run: RUN_ID, proof_issue: 'UTV2-1842' },
  });

  // The precondition is asserted directly, not inferred from the upsert
  // succeeding: the gate fires on the table being non-empty, so that is the
  // fact worth checking.
  const anyEvent = await restQuery<{ id: string }>('events?select=id&limit=1');
  assert.equal(anyEvent.length, 1, 'events must be non-empty or the event-existence gate is dormant');
}

/** The eventName below is run-unique, so it cannot match a real or seeded row. */
function unmatchedEventName(label: string): string {
  return `UTV2-1842 uncatalogued ${label} ${RUN_ID}`;
}

function manualCoverageGapPayload(): SubmissionPayload {
  const eventName = unmatchedEventName('manual');
  // `market` is `nba-spread` and the sport is NBA because `picks.market_type_id`
  // is a foreign key into the seeded `market_types` catalog, and an invented
  // market string is refused by `picks_market_type_id_fkey` -- the exact failure
  // `scripts/ci/seed-staging-fixtures.ts` documents. This pair is the one the
  // existing UTV2-1815 live proof already writes successfully against staging.
  //
  // NBA is a team sport, so `validateManualResolution` requires BOTH sides of
  // the entered matchup. Supplying two is therefore not incidental: it is the
  // stricter of the two manual-path rules, so this fixture exercises the manual
  // override at its most constrained rather than at its most permissive.
  return {
    source: 'smart-form',
    market: 'nba-spread',
    selection: `utv2-1842-${RUN_ID} Challenger Alpha`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.6,
    eventName,
    metadata: {
      sport: 'NBA',
      distributionMode: 'track-only',
      proof_run: RUN_ID,
      proof_issue: 'UTV2-1842',
      participantResolution: {
        resolution: 'manual',
        sportId: 'NBA',
        eventId: null,
        manualOverride: true,
        reason: 'canonical-coverage-gap',
        enteredEventName: eventName,
        enteredParticipants: [
          {
            role: 'away',
            displayName: `Challenger Alpha ${RUN_ID}`,
            canonicalParticipantId: null,
          },
          {
            role: 'home',
            displayName: `Challenger Bravo ${RUN_ID}`,
            canonicalParticipantId: null,
          },
        ],
      },
    },
  };
}

interface PickRow {
  id: string;
  metadata: Record<string, unknown> | null;
}

test(
  'UTV2-1842 live DB: a manual coverage-gap Track Only pick persists with honest provenance and creates no delivery row',
  { skip: skipReason },
  async () => {
    await armTheGate('positive');

    const response = await submitPickController(manualCoverageGapPayload(), repositories);
    assert.equal(
      response.status,
      201,
      `the contained pilot's submission must be accepted; got ${response.status} ${JSON.stringify(response.body)}`,
    );
    assert.ok(response.body.ok);
    if (!response.body.ok) return;
    const { pickId } = response.body.data;

    // Read the row back over PostgREST rather than through the repository that
    // wrote it. A repository return value would only re-assert what the writer
    // believed; this asserts what Postgres actually holds.
    const rows = await restQuery<PickRow>(`picks?id=eq.${pickId}&select=id,metadata`);
    assert.equal(rows.length, 1, `expected exactly one persisted pick, got ${rows.length}`);
    const metadata = rows[0]!.metadata ?? {};
    assert.equal(metadata['distributionMode'], 'track-only');

    const resolution = metadata['participantResolution'] as Record<string, unknown> | undefined;
    assert.ok(resolution, 'persisted pick must carry its participantResolution provenance');
    assert.equal(resolution['resolution'], 'manual');
    assert.equal(resolution['reason'], 'canonical-coverage-gap');
    assert.equal(resolution['eventId'], null);

    // Milestone 1 step 6, against the delivery queue itself.
    assert.equal(
      response.body.data.outboxEnqueued,
      false,
      'Track Only must not report an enqueue',
    );
    const outbox = await restQuery<{ id: string }>(
      `distribution_outbox?pick_id=eq.${pickId}&select=id`,
    );
    assert.equal(
      outbox.length,
      0,
      `Track Only must create no delivery work; found ${outbox.length} distribution_outbox row(s)`,
    );
  },
);

test(
  'UTV2-1842 live DB: the event-existence gate is still armed — a smart-form pick with no server-validated fallback is refused',
  { skip: skipReason },
  async () => {
    // This is the control for test 1. It shares the same armed gate and the same
    // unmatched event name; the only difference is the absence of a
    // participantResolution, so validateSmartFormRelationships reports
    // `not-smart-form` and the waiver does not apply. If this submission were
    // accepted, the waiver would be a general escape from the gate and test 1's
    // acceptance would prove nothing about the classification.
    await armTheGate('negative');

    await assert.rejects(
      () =>
        submitPickController(
          {
            source: 'smart-form',
            market: 'nba-spread',
            selection: `utv2-1842-${RUN_ID} Player Over 18.5`,
            line: 18.5,
            odds: -110,
            stakeUnits: 1,
            confidence: 0.6,
            eventName: unmatchedEventName('control'),
            metadata: { sport: 'NBA', proof_run: RUN_ID, proof_issue: 'UTV2-1842' },
          },
          repositories,
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('EVENT_NOT_FOUND') || err.message.includes(RUN_ID),
          `refusal must name the event gate or the unmatched event; got: ${err.message}`,
        );
        return true;
      },
    );
  },
);
