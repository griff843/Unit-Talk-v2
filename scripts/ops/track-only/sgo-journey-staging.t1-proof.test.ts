/**
 * T1 Live-DB Proof: the SGO-backed Track Only result journey, against staging
 * (UTV2-1889)
 *
 * `sgo-journey-proof.test.ts` composes this same journey in memory and proves the
 * LOGIC: the market key, the paired-score outcome, the participant attribution, the
 * settlement and the statistics. It cannot prove the one thing the lane is actually
 * for, because it substitutes the database. In memory,
 * `createInMemoryRepositoryBundle` accepts every write, so a repository that would
 * reject a row, silently coerce a column, or fail a constraint in Postgres reads as
 * a clean pass. That was recorded honestly as `runtime_proof.coverage_gap: OPEN`,
 * and this file is what closes it.
 *
 * What this proves that the in-memory suite does not:
 *
 *   1. The resolver's rows SURVIVE a real insert -- real column types, real
 *      constraints, real foreign keys to `events` and `participants`.
 *   2. The grading pass READS BACK what the resolver wrote, through PostgREST,
 *      rather than through an object the same process put in a Map.
 *   3. The settlement PERSISTS as a row, and is found again by a fresh read.
 *   4. Track Only's lifecycle and non-delivery hold against the real tables, which
 *      is where a delivery row would actually have to appear to matter.
 *
 * The journey code is NOT re-implemented here. `runSgoJourneyProof` is called with a
 * staging-backed bundle injected, so the identical function the in-memory suite
 * exercises is what runs. If the two disagree, that disagreement is the finding.
 *
 * WHAT IS NOT SET UP: the settlement. This test seeds a provider payload, canonical
 * teams and an event, and a pick. It never writes a `settlement_records` row, never
 * names the expected outcome to any production code, and never asserts a value it
 * also inserted. The outcome (`win`, from 5-3 on the away side) is DERIVED by the
 * real grading pass from scores the real resolver wrote, and read back from the
 * database afterwards.
 *
 * SGO IS NOT CONTACTED. The provider payload is served from memory through the
 * injected `fetchImpl`, exactly as in the in-memory suite. This proof requires a
 * database credential; it does not require, and does not perform, SGO activation.
 *
 * Isolation: every external identifier is namespaced by `CI_FIXTURE_RUN_ID`, so a
 * run reads only rows it wrote, concurrent runs cannot collide, and no row this
 * proof creates can be mistaken for real data. Rows are NOT deleted, matching every
 * other T1 live proof in this repository.
 *
 * Run: UNIT_TALK_APP_ENV=local pnpm exec tsx --test scripts/ops/track-only/sgo-journey-staging.t1-proof.test.ts
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  outboxStatuses,
  type RepositoryBundle,
} from '@unit-talk/db';

import { assertStagingTarget } from '../../ci/assert-staging-target.js';
import {
  buildStagingResultsPayload,
  fixtureEventExternalId,
  runSgoJourneyProof,
  STAGING_FIXTURE_PREFIX,
  type SgoJourneyProofReport,
} from './sgo-journey-proof.js';

function readEnv(): Record<string, string | undefined> | null {
  try {
    return loadEnvironment() as unknown as Record<string, string | undefined>;
  } catch {
    return null;
  }
}

const env = readEnv();
const hasCredential = Boolean(
  env && env['SUPABASE_URL'] && env['SUPABASE_SERVICE_ROLE_KEY'],
);
// Resolved up front, because "can this run here at all" is decided by the TARGET,
// not merely by the presence of a credential. A workstation under containment holds
// a placeholder `SUPABASE_URL` that is truthy and unresolvable, which is a reason to
// skip locally and never a reason to proceed.
const targetIsApprovedStaging = Boolean(env && assertStagingTarget(env).ok);

/**
 * `CI_FIXTURE_RUN_ID` is set by the one CI job that holds a database credential.
 * Its presence therefore means "this run is SUPPOSED to execute against staging".
 *
 * That distinction is what makes zero skips observable rather than assumed. A
 * credential-free workstation skips, which is correct and is how every other T1
 * live proof behaves. But in the credentialed job a missing or misconfigured
 * credential must be a RED test, never a quiet skip -- a skip there would report
 * exactly the same green as a pass, which is the failure mode that lets a proof
 * stop running without anyone noticing.
 */
const ciFixtureRunId = process.env['CI_FIXTURE_RUN_ID'];
const mustRun = Boolean(ciFixtureRunId);

const skipReason = mustRun
  ? false
  : hasCredential && targetIsApprovedStaging
    ? false
    : 'no approved staging target configured — skipping live DB proof';

// Namespaced per run. In CI this is the workflow run and attempt; locally it is a
// random suffix, so two local invocations never read each other's rows either.
const RUN_NAMESPACE = (ciFixtureRunId ?? `local-${randomUUID().slice(0, 8)}`)
  .replace(/[^A-Za-z0-9-]/g, '-')
  .slice(0, 64);

let repositories: RepositoryBundle;
let report: SgoJourneyProofReport;

before(async () => {
  if (skipReason) return;

  assert.ok(
    env,
    'environment failed to load, so the staging target cannot be identified',
  );

  // The existing control, reused rather than reimplemented. It refuses production,
  // unknown, ambiguous, proxied and unresolvable targets alike, BEFORE any client is
  // constructed. A second copy of this rule here is exactly how the two would drift.
  const staging = assertStagingTarget(env);
  assert.equal(
    staging.ok,
    true,
    `refusing to run the journey proof: ${staging.reason}`,
  );

  assert.ok(
    hasCredential,
    'CI_FIXTURE_RUN_ID is set, so this run is expected to reach staging, but ' +
      'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are not configured. Failing rather ' +
      'than skipping: a skipped proof reports the same green as a passing one.',
  );

  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);

  // The whole journey, once, against staging. Every assertion below reads this
  // report or re-reads the database; none of them re-runs the journey, so the
  // stages cannot disagree between assertions.
  report = await runSgoJourneyProof({
    pickMarket: 'moneyline',
    pickSelection: 'Fixture Away Nine',
    pickLine: null,
    pickTeamSide: 'away',
    repositories,
    fixtureNamespace: RUN_NAMESPACE,
  });
});

test('the fixture is namespaced and identifiable, so no row it writes can be mistaken for real data', { skip: skipReason }, () => {
  assert.ok(report.fixtureEventId.startsWith(STAGING_FIXTURE_PREFIX));
  assert.equal(report.fixtureEventId, fixtureEventExternalId(RUN_NAMESPACE));
  assert.ok(
    report.fixtureEventId.includes(RUN_NAMESPACE.toUpperCase()),
    `fixture event id ${report.fixtureEventId} is not scoped to this run`,
  );
});

test('the real resolver wrote real rows to staging, read back from the database', { skip: skipReason }, async () => {
  // Re-read through the repository rather than trusting the report, so this is a
  // statement about what is IN the database, not about what the process believed.
  const eventRow = await repositories.events.findByExternalId(report.fixtureEventId);
  assert.ok(eventRow, 'the fixture event was not persisted to staging');

  const rows = await repositories.gradeResults.listByEvent(eventRow.id);
  assert.ok(rows.length > 0, 'the resolver persisted no results at all');

  // The moneyline pair is the case UTV2-1868 exists for: the provider erases the
  // side from the market key, so each row must carry its own participant.
  const moneyline = rows.filter(
    (row) => row.market_key === 'game_moneyline_win',
  );
  assert.equal(
    moneyline.length,
    2,
    'a moneyline must persist one row per side, not one row for the game',
  );
  const attributed = new Set(moneyline.map((row) => row.participant_id));
  assert.equal(
    attributed.size,
    2,
    'both moneyline rows resolved to the same participant, so the side was lost',
  );
  assert.ok(
    !attributed.has(null),
    'a moneyline result persisted with no participant, which is the historical defect',
  );

  // Outcome, not raw score. 5-3 to the away side: the away row is the win.
  const values = moneyline.map((row) => Number(row.actual_value)).sort();
  assert.deepEqual(
    values,
    [0, 1],
    `moneyline rows persisted ${JSON.stringify(values)} — a win flag is 0 or 1, ` +
      'so anything else is a raw score written under an outcome key',
  );

  // The game total is genuinely game-scoped and must NOT borrow a side.
  const total = rows.filter((row) => row.market_key === 'game_total_ou');
  assert.equal(total.length, 1);
  assert.equal(total[0]?.participant_id, null);
  assert.equal(Number(total[0]?.actual_value), 8);
});

test('the real grading pass settled the pick, and the settlement persists in staging', { skip: skipReason }, async () => {
  assert.equal(report.settle.errors, 0, 'the grading pass reported errors');
  assert.equal(report.settle.attempted, 1);
  assert.equal(report.settle.graded, 1);

  // Re-read rather than trusting the in-process report: the property under test is
  // persistence, and a settlement that exists only in the returned object is
  // precisely what the in-memory proof already established.
  const settlement = await repositories.settlements.findLatestForPick(
    report.settle.pickId,
  );
  assert.ok(settlement, 'no settlement row was persisted for the fixture pick');
  assert.equal(
    settlement.result,
    'win',
    'the away side scored 5 to the home side 3, so the away moneyline is a win',
  );
  assert.equal(settlement.pick_id, report.settle.pickId);

  // Traceable to its score provenance: the settlement must be attributable to the
  // rows the resolver wrote, not to an outcome supplied by this test.
  assert.equal(report.settle.settlementResult, 'win');
  assert.equal(report.settle.evidencePlane, true);
});

test('Track Only stays validated and creates no delivery, asserted against the real tables', { skip: skipReason }, async () => {
  const pick = await repositories.picks.findPickById(report.settle.pickId);
  assert.ok(pick);
  // The evidence plane settles WITHOUT a lifecycle move. `settled` here would mean
  // the pick had been treated as delivered.
  assert.equal(
    pick.status,
    'validated',
    'a Track Only pick moved lifecycle state during grading',
  );

  // Every status the schema defines, not the repository's `['sent']` default: a
  // `pending` or `failed` row is already a breach, and the default would miss it.
  const delivery = await repositories.outbox.findLatestByPick(pick.id, [
    ...outboxStatuses,
  ]);
  assert.equal(
    delivery,
    null,
    'a Track Only pick produced a distribution_outbox row',
  );
  assert.equal(report.settle.deliveryRowCount, 0);
});

test('the real statistics compute from the persisted settlement', { skip: skipReason }, () => {
  assert.equal(report.stats.record.decided, 1);
  assert.equal(report.stats.record.win, 1);
  assert.equal(report.stats.record.loss, 0);
  assert.equal(report.journeyCompletes, true);
  assert.deepEqual(
    report.gaps,
    [],
    `the journey reported gaps against staging: ${JSON.stringify(report.gaps)}`,
  );
});

test('an incomplete result is refused rather than guessed, against staging', { skip: skipReason }, async () => {
  // A half-scored event: the home side has a score and the away side does not.
  // A moneyline cannot be decided from one side, and the correct behaviour is to
  // write NOTHING rather than to infer the missing half.
  const namespace = `${RUN_NAMESPACE}-HALF`.slice(0, 64);
  const payload = buildStagingResultsPayload({ fixtureNamespace: namespace }) as {
    data: { odds: Record<string, { score?: number }> }[];
  };
  delete payload.data[0]!.odds['points-away-game-ml-away']!.score;

  const halfReport = await runSgoJourneyProof({
    pickMarket: 'moneyline',
    pickSelection: 'Fixture Away Nine',
    pickLine: null,
    pickTeamSide: 'away',
    payload,
    repositories,
    fixtureNamespace: namespace,
  });

  const eventRow = await repositories.events.findByExternalId(
    halfReport.fixtureEventId,
  );
  assert.ok(eventRow);

  // The two fixtures must be distinct rows, and distinct by *name* as well as by id.
  // The grading service resolves a pick's event from `metadata.eventName` and start-time
  // proximity, never from the participants, so a shared name would let this pick settle
  // against the fully-scored fixture and report a refusal that never happened.
  const mainEventRow = await repositories.events.findByExternalId(report.fixtureEventId);
  assert.ok(mainEventRow);
  assert.notEqual(eventRow.id, mainEventRow.id);
  assert.notEqual(
    eventRow.event_name,
    mainEventRow.event_name,
    'both fixtures share an event name, so grading cannot tell them apart',
  );

  const rows = await repositories.gradeResults.listByEvent(eventRow.id);
  const moneyline = rows.filter((row) => row.market_key === 'game_moneyline_win');
  assert.equal(
    moneyline.length,
    0,
    'a half-scored moneyline persisted a result, so an outcome was guessed from one side',
  );

  // And the pick therefore does not settle. Refusing to write the result is only
  // half the control; the other half is that nothing downstream invents one.
  const settlement = await repositories.settlements.findLatestForPick(
    halfReport.settle.pickId,
  );
  assert.equal(
    settlement,
    null,
    'a pick settled against an event whose result was refused',
  );
  assert.equal(halfReport.journeyCompletes, false);
});
