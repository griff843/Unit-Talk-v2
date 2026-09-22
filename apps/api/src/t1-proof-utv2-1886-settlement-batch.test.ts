/**
 * T1 Live-DB Proof: batched settlement lookup (UTV2-1886)
 *
 * `runGradingPass` no longer asks `findLatestForPick` once per pick; it asks
 * `findLatestForPicks` once for the whole population. The unit tests in
 * `packages/db/src/settlement-invariants.test.ts` prove the chunking, the
 * pagination and the reduction against an injected fetcher. They cannot prove
 * the one thing that has shipped broken twice before (UTV2-519, UTV2-521): that
 * the PostgREST query itself behaves the way the pure logic assumes.
 *
 * Three assumptions are live-DB assumptions, not logic assumptions:
 *   1. `.in('pick_id', chunk)` returns rows for every id in the list.
 *   2. `.range(offset, offset + limit - 1)` under a stable two-key ordering
 *      yields DISJOINT, CONSECUTIVE pages — so paging cannot duplicate a row
 *      into one page and drop it from another.
 *   3. `.order('created_at', desc).order('id', desc)` agrees with
 *      `compareSettlementRecordsDescending`, so the batch path and
 *      `findLatestForPick` name the same settlement as current.
 *
 * An under-read is the fail-OPEN direction: an absent key reads as "no
 * settlement exists", and the caller then settles an already-settled pick.
 * That is why completeness, not speed, is what this proof asserts.
 *
 * The second test is the one the batch read cannot do without. It forces real
 * pagination at page sizes of 1 and 2 and requires the paged map to equal the
 * unpaged one, so a settlement that lives on a LATER page than the first cannot
 * go missing — the exact failure that would report a settled pick as unsettled.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Test-created rows are NOT deleted.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1886-settlement-batch.test.ts
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { CanonicalPick, SubmissionPayload } from '@unit-talk/contracts';
import {
  collectLatestSettlementsByPick,
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
  type SettlementRecord,
} from '@unit-talk/db';

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
  // The same factory the repository uses, so the proof drives the repository's
  // own client rather than a second one configured differently.
  client = createDatabaseClientFromConnection(connection);
});

async function createPick(label: string): Promise<string> {
  // Written through the repository bundle rather than the submission controller.
  // The property under test is the settlement read, and routing every fixture
  // through promotion and distribution would put rows in tables this proof has
  // no business touching. `savePick` is the same DatabaseRepository the grading
  // pass reads back through.
  const submissionId = randomUUID();
  const now = new Date().toISOString();
  const selection = `UTV2-1886 BATCH PROOF ${label} ${RUN_ID}`;

  const payload: SubmissionPayload = {
    source: 'smart-form',
    market: 'nba-spread',
    selection,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: { proofRun: RUN_ID, proofIssue: 'UTV2-1886', label },
  };
  await repositories.submissions.saveSubmission({
    id: submissionId,
    payload,
    receivedAt: now,
  });

  const pick: CanonicalPick = {
    id: randomUUID(),
    submissionId,
    market: 'nba-spread',
    selection,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    source: 'smart-form',
    submittedBy: `utv2-1886-proof-${RUN_ID}`,
    approvalStatus: 'pending',
    promotionStatus: 'not_eligible',
    lifecycleState: 'validated',
    metadata: { proofRun: RUN_ID, proofIssue: 'UTV2-1886', label },
    createdAt: now,
  };
  await repositories.picks.savePick(pick);
  return pick.id;
}

async function recordSettlement(
  pickId: string,
  seq: number,
  correctsId: string | null,
): Promise<SettlementRecord> {
  return repositories.settlements.record({
    pickId,
    status: 'settled',
    result: seq % 2 === 0 ? 'win' : 'loss',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `utv2-1886-proof-${RUN_ID}-${seq}`,
    settledBy: 'utv2-1886-proof',
    settledAt: new Date(Date.now() + seq * 1000).toISOString(),
    payload: { proofRun: RUN_ID, seq },
    ...(correctsId ? { correctsId } : {}),
  });
}

/**
 * The same query `DatabaseSettlementRepository.findLatestForPicks` issues,
 * reproduced here so the proof can drive it at a page size small enough to
 * force real pagination without writing 1000+ rows. If this closure and the
 * repository's diverge, the divergence is visible in the first test, which
 * calls the repository itself.
 */
function livePageFetcher() {
  return async (
    chunk: string[],
    offset: number,
    limit: number,
  ): Promise<SettlementRecord[]> => {
    const { data, error } = await client
      .from('settlement_records')
      .select()
      .in('pick_id', chunk)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`live page read failed: ${error.message}`);
    }

    return (data ?? []) as SettlementRecord[];
  };
}

test(
  'UTV2-1886: findLatestForPicks agrees with findLatestForPick against live Postgres, and omits unsettled picks',
  { skip: skipReason },
  async () => {
    // Three settled picks with 1, 2 and 3 settlements, plus one pick that is
    // deliberately never settled. The unsettled pick is the control: without it
    // a batch that simply returned every pick it was asked about would pass.
    const settledIds: string[] = [];
    for (const [index, count] of [1, 2, 3].entries()) {
      const pickId = await createPick(`settled-${index}`);
      let previous: string | null = null;
      for (let seq = 0; seq < count; seq += 1) {
        const row = await recordSettlement(pickId, seq, previous);
        previous = row.id;
      }
      settledIds.push(pickId);
    }
    const unsettledId = await createPick('unsettled');

    const batch = await repositories.settlements.findLatestForPicks([
      ...settledIds,
      unsettledId,
    ]);

    for (const pickId of settledIds) {
      const single = await repositories.settlements.findLatestForPick(pickId);
      assert.ok(
        single,
        `findLatestForPick must find a settlement for ${pickId}`,
      );
      assert.equal(
        batch.get(pickId)?.id,
        single.id,
        `batch and single-pick reads must name the same current settlement for ${pickId}`,
      );
    }

    assert.equal(
      batch.has(unsettledId),
      false,
      'a pick with no settlement must be ABSENT from the map, not present with a null value',
    );
    assert.equal(
      batch.size,
      settledIds.length,
      'exactly the settled picks are returned',
    );
  },
);

test(
  'UTV2-1886: a page-size-1 live read returns the same map as a single-page read',
  { skip: skipReason },
  async () => {
    // Six settlement rows across two picks, then the same population read three
    // ways. If PostgREST `.range()` under this two-key ordering ever duplicated
    // or dropped a row across page boundaries, the paged reads would disagree
    // with the unpaged one -- and the disagreement would be a silently missing
    // pick, which reads as "not settled".
    const pickA = await createPick('paged-a');
    const pickB = await createPick('paged-b');

    let previous: string | null = null;
    for (let seq = 0; seq < 3; seq += 1) {
      previous = (await recordSettlement(pickA, seq, previous)).id;
    }
    previous = null;
    for (let seq = 0; seq < 3; seq += 1) {
      previous = (await recordSettlement(pickB, seq, previous)).id;
    }

    const ids = [pickA, pickB];
    const fetcher = livePageFetcher();

    const unpaged = await collectLatestSettlementsByPick(ids, fetcher, {
      pageSize: 1000,
    });
    const pagedByOne = await collectLatestSettlementsByPick(ids, fetcher, {
      pageSize: 1,
    });
    const pagedByTwo = await collectLatestSettlementsByPick(ids, fetcher, {
      pageSize: 2,
    });

    // A page size of 1 means five of the six rows live on a page AFTER the
    // first. If the loop stopped at the first page, or if a later page were
    // skipped, `pagedByOne` would be missing a pick or naming a stale row.
    for (const [label, paged] of [
      ['pageSize 1', pagedByOne],
      ['pageSize 2', pagedByTwo],
    ] as const) {
      assert.equal(paged.size, unpaged.size, `${label}: same number of picks`);
      for (const [pickId, record] of unpaged) {
        assert.equal(
          paged.get(pickId)?.id,
          record.id,
          `${label}: same current settlement for ${pickId}`,
        );
      }
    }

    // And the paged result still agrees with the per-pick read, so the
    // pagination is not merely self-consistent.
    for (const pickId of ids) {
      const single = await repositories.settlements.findLatestForPick(pickId);
      assert.ok(single);
      assert.equal(pagedByOne.get(pickId)?.id, single.id);
    }
  },
);

test(
  'UTV2-1886: a chunk smaller than the id list still returns every settled pick',
  { skip: skipReason },
  async () => {
    // Chunking is the other way a pick can vanish. Three picks read at a chunk
    // size of 1 exercises three separate `.in()` calls whose results must union,
    // not replace one another.
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const pickId = await createPick(`chunked-${index}`);
      await recordSettlement(pickId, index, null);
      ids.push(pickId);
    }

    const chunked = await collectLatestSettlementsByPick(
      ids,
      livePageFetcher(),
      {
        chunkSize: 1,
        pageSize: 1000,
      },
    );

    assert.equal(chunked.size, 3, 'all three picks must survive chunking');
    for (const pickId of ids) {
      assert.ok(
        chunked.get(pickId),
        `pick ${pickId} must be present after chunked read`,
      );
    }
  },
);


// UTV2-1605: this suite already runs behind ci:assert-staging in
// test:t1-proof:live. These cases prove the new repository method and its
// consumption/persistence by the real grader, not generic DB connectivity.
test('UTV2-1605: grading freshness equals the live maximum sourced_at', { skip: skipReason }, async () => {
  const db = createDatabaseClientFromConnection(
    createServiceRoleDatabaseConnectionConfig(loadEnvironment()),
  );
  // Independent oracle: scan source timestamps in ID order and reduce in JS.
  // Bracket it with repository reads to tolerate concurrent staging inserts.
  const before = await repositories.gradeResults.findLatestSourcedAt();
  let maximum: number | null = null;
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('game_results')
      .select('id,sourced_at').order('id').range(offset, offset + 499);
    assert.equal(error, null);
    for (const row of data ?? []) {
      const timestamp = Date.parse(row.sourced_at);
      assert.ok(Number.isFinite(timestamp));
      maximum = maximum === null ? timestamp : Math.max(maximum, timestamp);
    }
    if ((data ?? []).length < 500) break;
  }
  const after = await repositories.gradeResults.findLatestSourcedAt();
  // Earlier live suites seed game_results. Refuse an empty/vacuous proof.
  assert.notEqual(maximum, null, 'staging must contain result fixtures');
  assert.ok(before !== null && after !== null);
  assert.ok(Date.parse(before) <= maximum!);
  assert.ok(Date.parse(after) >= maximum!);
  if (before === after) assert.equal(Date.parse(after), maximum);
});

test('UTV2-1605: real grading run persists the live input-freshness read', { skip: skipReason }, async () => {
  const { runGradingPass, classifyInputFreshness } = await import('./grading-service.js');
  const db = createDatabaseClientFromConnection(
    createServiceRoleDatabaseConnectionConfig(loadEnvironment()),
  );
  let runId: string | null = null;
  let observedTimestamp: string | null = null;
  let reads = 0;
  const now = new Date();
  const result = await runGradingPass({
    ...repositories,
    gradeResults: {
      insert: (input) => repositories.gradeResults.insert(input),
      findResult: (criteria) => repositories.gradeResults.findResult(criteria),
      listByEvent: (eventId) => repositories.gradeResults.listByEvent(eventId),
      findLatestSourcedAt: async () => {
        reads += 1;
        observedTimestamp = await repositories.gradeResults.findLatestSourcedAt();
        return observedTimestamp;
      },
    },
    runs: {
      startRun: async (input) => {
        const row = await repositories.runs.startRun(input);
        runId = row.id;
        return row;
      },
      completeRun: (input) => repositories.runs.completeRun(input),
      listByType: (runType, limit) => repositories.runs.listByType(runType, limit),
      reapStaleRuns: (input) => repositories.runs.reapStaleRuns(input),
    },
  }, {
    // Real repository reads, deliberately no candidate settlement or delivery.
    restrictToPickIds: new Set<string>(),
    now: () => now,
  });
  assert.equal(reads, 1, 'the runtime must call the new live repository capability');
  assert.ok(runId);
  assert.deepEqual(result.inputFreshness, classifyInputFreshness(observedTimestamp, now));
  assert.equal(result.outcomeClass, 'no_op_nothing_gradeable');
  assert.equal(result.attempted, 0);
  assert.equal(result.graded, 0);
  const { data: row, error } = await db.from('system_runs').select('*').eq('id', runId).single();
  assert.equal(error, null);
  assert.ok(row);
  assert.equal(row.status, 'succeeded');
  const details = row.details as Record<string, unknown>;
  assert.equal(details['outcome_class'], 'no_op_nothing_gradeable');
  assert.ok(typeof details['rows_scanned'] === 'number' && details['rows_scanned'] > 0,
    'candidate restriction must not erase the rows the real repository scanned');
  assert.equal(details['graded_count'], 0);
  assert.equal(details['error_count'], 0);
  assert.equal(details['newest_game_result_sourced_at'], observedTimestamp);
  assert.equal(details['freshness_threshold_ms'], 6 * 60 * 60 * 1000);
});
