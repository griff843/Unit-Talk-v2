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
 * It does not prove the browser half of Milestone 1. It starts at the API.
 *
 * WHAT UTV2-1854 ADDED
 * --------------------
 * This block used to say the structured team-fallback branch could not be proven
 * against a live database, because that branch needed a canonical team catalog and
 * populating one was reference-data seeding under a reserved provider decision.
 * That constraint is gone: the branch resolves from `participants`, the provider
 * observation layer every other reference-data surface already reads, so proving it
 * needs two participant rows rather than a seeded catalog. The paragraph is
 * corrected here rather than left standing as a disclaimer for a limit that no
 * longer applies -- a stale "this is not proven" is as misleading as a stale claim
 * that it is.
 *
 * 4. A structured Track Only pick whose two sides are participant ids is ACCEPTED,
 *    and the ids that were verified are the ids that are PERSISTED. Asserting the
 *    ids rather than the display names is the point: a fabricated resolution
 *    survives a name check and does not survive a `participants.id` check.
 * 5. That pick likewise creates ZERO `distribution_outbox` rows.
 * 6. The control for 4: the same payload with one side naming no participants row
 *    is REFUSED, and refused *for a participant-identity reason* rather than any
 *    other. Without the reason assertion an unrelated refusal would pass as this
 *    control.
 *
 * The two team rows those tests use are fixtures in the run's own namespace, tagged
 * `utv2-1854-<runId>` in both `external_id` and `display_name`, deleted by the
 * `after` hook with a leak assertion. Staging's `participants` table is empty
 * (measured 2026-09-07), so depending on ambient rows would make the proof
 * conditional on fixture state it does not control. Creating two rows the test owns
 * and removes is not reference-data seeding: nothing outside this file reads them,
 * and no production database is touched.
 *
 * FIXTURES
 * --------
 * Every row this file creates is tagged with `utv2-1842-<runId>`. The evidence
 * rows -- the picks, and their absence from the delivery queue -- are NOT
 * deleted, so they can be found after the run. No row it did not create is
 * mutated.
 *
 * The two `armTheGate` event rows are the deliberate exception, and the `after`
 * hook below deletes them. They are not evidence; they are infrastructure, and
 * unlike every other row here they mutate a GLOBAL precondition:
 * `checkEventExistenceGate` skips entirely when `events` is empty, so leaving
 * them behind silently arms the gate for every later run against this database.
 * That is not hypothetical -- ten of them accumulated across five runs on
 * 2026-09-07 and turned `t1-proof-awaiting-approval.test.ts`'s UTV2-1672 Track
 * Only suite red on an unrelated PR, because that suite's manual coverage-gap
 * submission reaches 201 only while the gate is dormant. A proof that leaves
 * the system in a state where other proofs fail is not finished. The canonical-coverage claim is made with deliberately fabricated
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

import test, { after, before } from 'node:test';
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
/** External ids of the arming events, so the `after` hook deletes exactly them. */
const armedEventExternalIds: string[] = [];
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

after(async () => {
  if (skipReason || armedEventExternalIds.length === 0) return;

  // Deleted by external_id, which is this run's own namespace
  // (`utv2-1842-<RUN_ID>-<label>`), so a concurrent run's arming rows and every
  // pre-existing row are untouched. Failing to clean up is reported rather than
  // swallowed: a silent cleanup failure would leave the next run's UTV2-1672
  // suite red for a reason nothing in this file explains.
  const encoded = armedEventExternalIds.map((id) => `"${id}"`).join(',');
  const resp = await fetch(`${supabaseUrl}/rest/v1/events?external_id=in.(${encoded})`, {
    method: 'DELETE',
    headers: { ...authHeaders(), Prefer: 'return=representation' },
  });
  const body = await resp.json();
  assert.ok(resp.ok, `arming-event cleanup failed: ${JSON.stringify(body)}`);
  assert.equal(
    (body as unknown[]).length,
    armedEventExternalIds.length,
    `expected to delete ${armedEventExternalIds.length} arming events, deleted ${(body as unknown[]).length}`,
  );

  // The global precondition this file mutated must be restored, not merely
  // "probably restored". Any row left matching this file's own name prefix is
  // leaked state that would arm the gate for the next run.
  const leaked = await restQuery<{ id: string }>(
    'events?select=id&event_name=like.UTV2-1842%20unrelated%20event%20*',
  );
  assert.equal(leaked.length, 0, `${leaked.length} UTV2-1842 arming event(s) leaked into the database`);
});

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
  const externalId = `utv2-1842-${RUN_ID}-${label}`;
  await repositories.events.upsertByExternalId({
    externalId,
    sportId: sports[0]!.id,
    eventName: `UTV2-1842 unrelated event ${RUN_ID} ${label}`,
    eventDate: new Date().toISOString().slice(0, 10),
    status: 'scheduled',
    metadata: { proof_run: RUN_ID, proof_issue: 'UTV2-1842' },
  });
  // Recorded only after the upsert succeeds, so the `after` hook's exact-count
  // assertion cannot fail on a row that was never created.
  if (!armedEventExternalIds.includes(externalId)) armedEventExternalIds.push(externalId);

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

function manualCoverageGapPayload(
  overrides: { distributionMode?: 'track-only' | 'delivery-eligible'; caseLabel?: string } = {},
): SubmissionPayload {
  // `caseLabel` exists because `computeSubmissionIdempotencyKey`
  // (submission-service.ts:80-90) hashes only source|market|selection|line|odds|eventName --
  // metadata is not an input. Two submissions differing only in
  // `metadata.distributionMode` therefore collide on that key, and the idempotency check at
  // submission-service.ts:150 returns an idempotent success BEFORE the event-existence gate
  // at :203 is ever reached. A literally byte-identical-but-for-distributionMode payload
  // consequently cannot observe the gate at all: it observes the duplicate short-circuit and
  // resolves, which is exactly how this file failed against staging on 2026-09-07.
  //
  // So the label varies `selection` and `eventName` -- the two key inputs -- and nothing else.
  // Neither is an input to `waivesEventExistenceGate`: the eventName stays a run-unique name
  // that matches no catalog row, and the selection stays a fabricated run-scoped string. The
  // manual coverage-gap shape, sport, market, line and odds are held fixed, so
  // `distributionMode` remains the only difference the waiver predicate can see.
  const caseLabel = overrides.caseLabel ?? 'manual';
  const eventName = unmatchedEventName(caseLabel);
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
    selection: `utv2-1842-${RUN_ID}-${caseLabel} Challenger Alpha`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.6,
    eventName,
    metadata: {
      sport: 'NBA',
      distributionMode: overrides.distributionMode ?? 'track-only',
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

test(
  'UTV2-1842 live DB: the same fallback kind submitted delivery-eligible is refused by the gate and persists nothing',
  { skip: skipReason },
  async () => {
    // The review finding on #1529, asserted against the real database rather
    // than against the in-memory bundle. This payload differs from the accepted
    // one in test 1 in `distributionMode` and in the run-scoped `caseLabel` that
    // keeps the two submissions distinct under the idempotency key -- see the
    // comment on `manualCoverageGapPayload`. Neither the selection nor the
    // eventName is an input to `waivesEventExistenceGate`, and the eventName is
    // still a name no catalog row matches, so the Track Only half of the waiver
    // predicate remains the only thing that can explain a different result.
    // Delete it and this test goes red while test 1 stays green.
    //
    // It matters at this layer specifically: an authenticated capper is
    // server-pinned to `track-only` upstream, but an operator or service-role
    // caller is not, and a qualified delivery-eligible pick proceeds to the
    // controller's outbox-enqueue path. Waiving on the fallback kind alone
    // would have admitted a pick naming no canonical event into member
    // delivery.
    await armTheGate('delivery-eligible');

    const payload = manualCoverageGapPayload({
      distributionMode: 'delivery-eligible',
      caseLabel: 'delivery-eligible',
    });
    await assert.rejects(
      () => submitPickController(payload, repositories),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('EVENT_NOT_FOUND') || err.message.includes(RUN_ID),
          `refusal must name the event gate or the unmatched event; got: ${err.message}`,
        );
        return true;
      },
    );

    // Refusal is only meaningful if nothing was written. `picks` has no
    // event_name column -- the matchup name lives in metadata -- so the row is
    // looked up by `selection`, which carries this run's id and this case's
    // label and therefore cannot be satisfied by an unrelated row, nor by the
    // row test 1 wrote. The `distributionMode` filter below is kept as a second
    // constraint rather than removed: it is what makes the assertion say the
    // specific thing this test is about.
    const persisted = await restQuery<{ id: string; metadata: Record<string, unknown> | null }>(
      `picks?select=id,metadata&selection=eq.${encodeURIComponent(payload.selection)}`,
    );
    const deliveryEligible = persisted.filter(
      (row) => (row.metadata ?? {})['distributionMode'] === 'delivery-eligible',
    );
    assert.equal(
      deliveryEligible.length,
      0,
      `a refused delivery-eligible fallback must persist no pick; found ${deliveryEligible.length}`,
    );
  },
);

// ===========================================================================
// UTV2-1854 — the structured team-fallback branch, against a live database.
//
// The header block above says this file "does not prove the structured
// team-fallback branch against a live database", because that branch needed a
// canonical team catalog and populating one was reference-data seeding under a
// reserved provider decision. UTV2-1854 removed that constraint: the branch now
// resolves from `participants`, which is the provider observation layer the rest
// of reference data already reads. The paragraph is corrected in this lane
// rather than left standing as a disclaimer for a limit that no longer exists.
//
// The two team rows below are fixtures in this run's own namespace, created and
// deleted here. They are NOT reference-data seeding: nothing outside this file
// reads them, they carry the run id in both `external_id` and `display_name`,
// and the `after` hook asserts they are gone. Staging's `participants` table is
// empty (measured 2026-09-07), so relying on ambient rows would make this test
// conditional on fixture state it does not control.
// ===========================================================================

/** `participants.id` of this run's two fixture teams, in [away, home] order. */
let fixtureTeamIds: { away: string; home: string } | null = null;
const fixtureParticipantExternalIds: string[] = [];

async function createFixtureTeams(): Promise<{ away: string; home: string }> {
  if (fixtureTeamIds) return fixtureTeamIds;
  const rows = [
    {
      external_id: `utv2-1854-${RUN_ID}-away`,
      participant_type: 'team',
      sport: 'NBA',
      display_name: `UTV2-1854 Away Club ${RUN_ID}`,
      metadata: { proof_run: RUN_ID, proof_issue: 'UTV2-1854' },
    },
    {
      external_id: `utv2-1854-${RUN_ID}-home`,
      participant_type: 'team',
      sport: 'NBA',
      display_name: `UTV2-1854 Home Club ${RUN_ID}`,
      metadata: { proof_run: RUN_ID, proof_issue: 'UTV2-1854' },
    },
  ];
  const resp = await fetch(`${supabaseUrl}/rest/v1/participants`, {
    method: 'POST',
    headers: { ...authHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  const body = (await resp.json()) as Array<{ id: string; external_id: string }>;
  assert.ok(resp.ok, `fixture team creation failed: ${JSON.stringify(body)}`);
  assert.equal(body.length, 2, `expected 2 fixture teams, created ${body.length}`);
  for (const row of body) fixtureParticipantExternalIds.push(row.external_id);
  const away = body.find((row) => row.external_id.endsWith('-away'))!;
  const home = body.find((row) => row.external_id.endsWith('-home'))!;
  fixtureTeamIds = { away: away.id, home: home.id };
  return fixtureTeamIds;
}

function structuredFallbackPayload(
  teams: { away: string; home: string },
  // No `caseLabel` override here, deliberately, unlike `manualCoverageGapPayload`
  // above: the refusal control below is rejected by `validateSmartFormRelationships`
  // before `submitPick` computes an idempotency key, so the two cases may share a
  // selection and event name without the accepted one being observed as a replay.
  // See the NOTE at the end of this file.
  overrides: { awayId?: string } = {},
): SubmissionPayload {
  const awayName = `UTV2-1854 Away Club ${RUN_ID}`;
  const homeName = `UTV2-1854 Home Club ${RUN_ID}`;
  // `validateStructuredMatchupName` binds the persisted name to the two verified
  // sides, away first -- the same "Away @ Home" the Smart Form derives itself.
  const eventName = `${awayName} @ ${homeName}`;
  return {
    source: 'smart-form',
    market: 'nba-spread',
    selection: awayName,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.6,
    eventName,
    metadata: {
      sport: 'NBA',
      distributionMode: 'track-only',
      proof_run: RUN_ID,
      proof_issue: 'UTV2-1854',
      participantResolution: {
        resolution: 'canonical',
        sportId: 'NBA',
        eventId: null,
        enteredEventName: eventName,
        away: {
          participantType: 'team',
          participantId: overrides.awayId ?? teams.away,
          displayName: awayName,
        },
        home: {
          participantType: 'team',
          participantId: teams.home,
          displayName: homeName,
        },
      },
    },
  } as unknown as SubmissionPayload;
}

test(
  'UTV2-1854 live DB: a structured Track Only pick resolves both sides from participants, persists their ids, and creates no delivery row',
  { skip: skipReason },
  async () => {
    await armTheGate('structured');
    const teams = await createFixtureTeams();

    const response = await submitPickController(structuredFallbackPayload(teams), repositories);
    assert.equal(
      response.status,
      201,
      `the structured path must be reachable; got ${response.status} ${JSON.stringify(response.body)}`,
    );
    assert.ok(response.body.ok);
    if (!response.body.ok) return;
    const { pickId } = response.body.data;

    const rows = await restQuery<PickRow>(`picks?id=eq.${pickId}&select=id,metadata`);
    assert.equal(rows.length, 1, `expected exactly one persisted pick, got ${rows.length}`);
    const metadata = rows[0]!.metadata ?? {};
    assert.equal(metadata['distributionMode'], 'track-only');

    // The identities that were verified are the identities that were persisted.
    // Asserting the ids rather than the names is the point: a name survives a
    // fabricated resolution, a `participants.id` does not.
    const resolution = metadata['participantResolution'] as Record<string, unknown>;
    assert.ok(resolution, 'persisted pick must carry its participantResolution provenance');
    assert.equal(resolution['resolution'], 'canonical');
    assert.equal(resolution['eventId'], null);
    assert.equal((resolution['away'] as Record<string, unknown>)['participantId'], teams.away);
    assert.equal((resolution['home'] as Record<string, unknown>)['participantId'], teams.home);

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
  'UTV2-1854 live DB: the structured path still refuses a participant id that names no row',
  { skip: skipReason },
  async () => {
    // The control for the test above. Without it, a `searchTeams` that answered
    // with everything -- or a `validateSearchBackedTeam` that stopped checking --
    // would make the acceptance above pass for the wrong reason.
    await armTheGate('structured-control');
    const teams = await createFixtureTeams();

    // `validateSmartFormRelationships` runs at `submit-pick-controller.ts:46` and
    // signals a relationship refusal by THROWING an ApiError, not by returning a
    // non-201 response -- the same shape the two UTV2-1842 refusal controls above
    // assert. Measured against staging on 2026-09-07: the first form of this test
    // awaited a response object and the refusal it exists to observe reached it as
    // a rejection instead.
    await assert.rejects(
      () =>
        submitPickController(
          structuredFallbackPayload(teams, { awayId: randomUUID() }),
          repositories,
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        // Assert the reason, not merely a rejection: a refusal for an unrelated
        // cause (auth, rate limit, a malformed market) would otherwise pass as
        // this control while proving nothing about participant verification.
        assert.match(
          err.message,
          /participant|canonical|not found|unverified/iu,
          `refused, but not for a participant-identity reason: ${err.message}`,
        );
        return true;
      },
    );
  },
);

// NOTE for the lane: the idempotency-key collision the manual fixture documents
// does NOT apply to the refusal control above. `validateSmartFormRelationships`
// runs in `submit-pick-controller.ts:46`, before `submitPick` computes the key at
// `submission-service.ts:146`, so the control is refused at validation and never
// reaches the duplicate short-circuit. The accepted case and the control may
// therefore share selection/eventName without the acceptance being observed as an
// idempotent replay. Assert the refusal REASON, not merely a non-201, so a
// refusal for an unrelated reason cannot pass as this control.

after(async () => {
  // A SEPARATE hook from the arming-event cleanup above, deliberately: that one
  // early-returns when no event was armed, and these fixture rows must be removed
  // whenever they were created regardless of what else the run did.
  if (skipReason || fixtureParticipantExternalIds.length === 0) return;

  const encoded = fixtureParticipantExternalIds.map((id) => `"${id}"`).join(',');
  const resp = await fetch(`${supabaseUrl}/rest/v1/participants?external_id=in.(${encoded})`, {
    method: 'DELETE',
    headers: { ...authHeaders(), Prefer: 'return=representation' },
  });
  const body = await resp.json();
  assert.ok(resp.ok, `fixture participant cleanup failed: ${JSON.stringify(body)}`);
  assert.equal(
    (body as unknown[]).length,
    fixtureParticipantExternalIds.length,
    `expected to delete ${fixtureParticipantExternalIds.length} fixture participants, deleted ${(body as unknown[]).length}`,
  );

  // Leak assertion, same reasoning as the arming events: reference data that
  // survives the run would make a later run's coverage answers depend on this
  // file's leftovers.
  const leaked = await restQuery<{ id: string }>(
    `participants?select=id&external_id=like.utv2-1854-${RUN_ID}*`,
  );
  assert.equal(leaked.length, 0, `${leaked.length} UTV2-1854 fixture participant(s) leaked`);
});
