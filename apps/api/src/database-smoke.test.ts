import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { processSubmission } from './submission-service.js';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { recordPickSettlement } from './settlement-service.js';

type DatabaseRepositoryBundle = ReturnType<typeof createDatabaseRepositoryBundle>;

function smokeSkip() {
  try {
    const env = loadEnvironment();
    return (env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY)
      ? false
      : 'SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not configured';
  } catch {
    return 'environment load failed';
  }
}

function hasSupabaseSmokeEnvironment() {
  try {
    const env = loadEnvironment();
    return Boolean(
      env.SUPABASE_URL &&
        env.SUPABASE_ANON_KEY &&
        env.SUPABASE_SERVICE_ROLE_KEY,
    );
  } catch {
    return false;
  }
}

async function createSmokePick(
  repositories: DatabaseRepositoryBundle,
  scenario: string,
) {
  const smokeRunId = randomUUID();
  return processSubmission(
    {
      source: 'api',
      eventName: `db-smoke-${scenario}-${smokeRunId}`,
      submittedBy: 'codex',
      market: 'NBA points',
      selection: `Player ${scenario} Over 21.5`,
      line: 21.5,
      odds: -110,
      stakeUnits: 1,
    },
    repositories,
  );
}

test(
  'database repository bundle persists a submission and settlement when Supabase is configured',
  {
    skip: hasSupabaseSmokeEnvironment()
      ? false
      : 'SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not configured',
  },
  async () => {
    const environment = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(environment);
    const client = createDatabaseClientFromConnection(connection);
    const repositories = createDatabaseRepositoryBundle(connection);
    const smokeRunId = randomUUID();

    const result = await processSubmission(
      {
        source: 'api',
        eventName: `db-smoke-${smokeRunId}`,
      submittedBy: 'codex',
      market: 'NBA points',
      selection: 'Player Over 21.5',
      line: 21.5,
      odds: -110,
      stakeUnits: 1,
    },
    repositories,
  );

    const queued = await transitionPickLifecycle(
      repositories.picks,
      result.pick.id,
      'queued',
      'db smoke queue',
    );
    const posted = await transitionPickLifecycle(
      repositories.picks,
      result.pick.id,
      'posted',
      'db smoke post',
      'poster',
    );
    const settlement = await recordPickSettlement(
      result.pick.id,
      {
        status: 'settled',
        result: 'win',
        source: 'operator',
        confidence: 'confirmed',
        evidenceRef: 'db-smoke://boxscore',
        settledBy: 'codex',
      },
      repositories,
    );
    const savedPick = await repositories.picks.findPickById(result.pick.id);

    try {
      assert.equal(result.submissionRecord.status, 'validated');
      assert.equal(result.submissionEventRecord!.event_name, 'submission.accepted');
      assert.equal(queued.lifecycleState, 'queued');
      assert.equal(posted.lifecycleState, 'posted');
      assert.equal(settlement.settlementRecord.status, 'settled');
      assert.ok(savedPick);
      assert.equal(savedPick?.id, result.pick.id);
      assert.equal(savedPick?.submission_id, result.submission.id);
      assert.equal(savedPick?.status, 'settled');
    } finally {
      await client.from('picks').delete().eq('id', result.pick.id);
      await client.from('submissions').delete().eq('id', result.submission.id);
    }
  },
);

test(
  'UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row',
  { skip: smokeSkip() },
  async () => {
    const environment = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(environment);
    const client = createDatabaseClientFromConnection(connection);
    const repositories = createDatabaseRepositoryBundle(connection);
    const result = await createSmokePick(repositories, 'utv2-920-invalid-enqueue');
    const idempotencyKey = `utv2-920-invalid-enqueue:${result.pick.id}`;

    try {
      const enqueueResult = await repositories.outbox.enqueueDistributionAtomic({
        pickId: result.pick.id,
        fromState: 'posted',
        toState: 'queued',
        writerRole: 'promoter',
        reason: 'UTV2-920 invalid enqueue smoke',
        lifecycleCreatedAt: new Date().toISOString(),
        outboxTarget: `utv2-920:${result.pick.id}`,
        outboxPayload: { pickId: result.pick.id, proofIssue: 'UTV2-920' },
        outboxIdempotencyKey: idempotencyKey,
      });

      assert.equal(enqueueResult, null);

      const savedPick = await repositories.picks.findPickById(result.pick.id);
      assert.equal(savedPick?.status, 'validated');

      const { count: lifecycleCount, error: lifecycleError } = await client
        .from('pick_lifecycle')
        .select('id', { count: 'exact', head: true })
        .eq('pick_id', result.pick.id)
        .eq('to_state', 'queued');
      assert.ifError(lifecycleError);
      assert.equal(lifecycleCount, 0);

      const outbox = await repositories.outbox.findByIdempotencyKey?.(idempotencyKey);
      assert.equal(outbox, null);
    } finally {
      await client.from('picks').delete().eq('id', result.pick.id);
      await client.from('submissions').delete().eq('id', result.submission.id);
    }
  },
);

test(
  'UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes',
  { skip: smokeSkip() },
  async () => {
    const environment = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(environment);
    const client = createDatabaseClientFromConnection(connection);
    const repositories = createDatabaseRepositoryBundle(connection);
    const result = await createSmokePick(repositories, 'utv2-920-invalid-delivery');
    const target = `utv2-920:${result.pick.id}`;

    try {
      const enqueueResult = await repositories.outbox.enqueueDistributionAtomic({
        pickId: result.pick.id,
        fromState: 'validated',
        toState: 'queued',
        writerRole: 'promoter',
        reason: 'UTV2-920 delivery setup',
        lifecycleCreatedAt: new Date().toISOString(),
        outboxTarget: target,
        outboxPayload: { pickId: result.pick.id, proofIssue: 'UTV2-920' },
        outboxIdempotencyKey: `utv2-920-delivery:${result.pick.id}`,
      });
      assert.ok(enqueueResult);

      const claimed = await repositories.outbox.claimNextAtomic(target, 'utv2-920-worker');
      assert.ok(claimed);
      assert.equal(claimed.id, enqueueResult.outbox.id);
      assert.equal(claimed.status, 'processing');

      // UTV2-1107: direct status drift (queued→validated) is now blocked by the picks_fsm_guard
      // BEFORE UPDATE trigger. Test the RPC rejection by passing wrong lifecycleFromState instead.
      await assert.rejects(
        () =>
          repositories.outbox.confirmDeliveryAtomic({
            outboxId: claimed.id,
            pickId: result.pick.id,
            workerId: 'utv2-920-worker',
            receiptType: 'utv2-920.delivery',
            receiptStatus: 'sent',
            receiptChannel: target,
            receiptExternalId: `utv2-920:${result.pick.id}:message`,
            receiptIdempotencyKey: `utv2-920-receipt:${result.pick.id}`,
            receiptPayload: { pickId: result.pick.id, proofIssue: 'UTV2-920' },
            lifecycleFromState: 'draft',
            lifecycleToState: 'posted',
            lifecycleWriterRole: 'poster',
            lifecycleReason: 'UTV2-920 delivery transition',
            auditAction: 'distribution.sent',
            auditPayload: { pickId: result.pick.id, outboxId: claimed.id },
          }),
        /INVALID_DELIVERY_TRANSITION/,
      );

      const { data: outboxAfter, error: outboxError } = await client
        .from('distribution_outbox')
        .select('status')
        .eq('id', claimed.id)
        .single();
      assert.ifError(outboxError);
      assert.equal(outboxAfter?.status, 'processing');

      const { count: receiptCount, error: receiptError } = await client
        .from('distribution_receipts')
        .select('id', { count: 'exact', head: true })
        .eq('outbox_id', claimed.id);
      assert.ifError(receiptError);
      assert.equal(receiptCount, 0);

      const { count: lifecycleCount, error: lifecycleError } = await client
        .from('pick_lifecycle')
        .select('id', { count: 'exact', head: true })
        .eq('pick_id', result.pick.id)
        .eq('to_state', 'posted');
      assert.ifError(lifecycleError);
      assert.equal(lifecycleCount, 0);

      const { count: auditCount, error: auditError } = await client
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('entity_type', 'distribution_outbox')
        .eq('entity_id', claimed.id)
        .eq('action', 'distribution.sent');
      assert.ifError(auditError);
      assert.equal(auditCount, 0);
    } finally {
      await client.from('picks').delete().eq('id', result.pick.id);
      await client.from('submissions').delete().eq('id', result.submission.id);
    }
  },
);

test(
  'UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row',
  { skip: smokeSkip() },
  async () => {
    const environment = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(environment);
    const client = createDatabaseClientFromConnection(connection);
    const repositories = createDatabaseRepositoryBundle(connection);
    const result = await createSmokePick(repositories, 'utv2-920-invalid-settlement');

    try {
      await assert.rejects(
        () =>
          repositories.settlements.settlePickAtomic({
            pickId: result.pick.id,
            settlement: {
              pickId: result.pick.id,
              status: 'settled',
              result: 'win',
              source: 'operator',
              confidence: 'confirmed',
              evidenceRef: 'db-smoke://utv2-920',
              settledBy: 'codex',
              settledAt: new Date().toISOString(),
              payload: { proofIssue: 'UTV2-920' },
            },
            lifecycleFromState: 'posted',
            lifecycleToState: 'settled',
            lifecycleWriterRole: 'settler',
            lifecycleReason: 'UTV2-920 settlement transition',
            auditAction: 'settlement.recorded',
            auditActor: 'codex',
            auditPayload: { pickId: result.pick.id },
          }),
        /INVALID_SETTLEMENT_TRANSITION/,
      );

      const savedPick = await repositories.picks.findPickById(result.pick.id);
      assert.equal(savedPick?.status, 'validated');

      const { count: settlementCount, error: settlementError } = await client
        .from('settlement_records')
        .select('id', { count: 'exact', head: true })
        .eq('pick_id', result.pick.id);
      assert.ifError(settlementError);
      assert.equal(settlementCount, 0);

      const { count: lifecycleCount, error: lifecycleError } = await client
        .from('pick_lifecycle')
        .select('id', { count: 'exact', head: true })
        .eq('pick_id', result.pick.id)
        .eq('to_state', 'settled');
      assert.ifError(lifecycleError);
      assert.equal(lifecycleCount, 0);

      const { count: auditCount, error: auditError } = await client
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('entity_type', 'settlement_records')
        .eq('entity_ref', result.pick.id)
        .eq('action', 'settlement.recorded');
      assert.ifError(auditError);
      assert.equal(auditCount, 0);
    } finally {
      await client.from('picks').delete().eq('id', result.pick.id);
      await client.from('submissions').delete().eq('id', result.submission.id);
    }
  },
);

test(
  'UTV2-883: no duplicate participants for the same external_id and sport',
  { skip: smokeSkip() },
  async () => {
    const environment = loadEnvironment();
    const repositories = createDatabaseRepositoryBundle(
      createServiceRoleDatabaseConnectionConfig(environment),
    );
    const allPlayers = await repositories.participants.listByType('player');
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const row of allPlayers) {
      if (!row.external_id) continue;
      const key = `${row.external_id}:${row.sport}:${row.participant_type}`;
      if (seen.has(key)) {
        duplicates.push(key);
      } else {
        seen.set(key, row.id);
      }
    }
    assert.equal(
      duplicates.length,
      0,
      `Duplicate participants found: ${duplicates.slice(0, 5).join(', ')} — UTV2-883 invariant violated`,
    );
  },
);

test(
  'UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows',
  { skip: smokeSkip() },
  async () => {
    const environment = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(environment);
    const client = createDatabaseClientFromConnection(connection);
    const repositories = createDatabaseRepositoryBundle(connection);
    const result = await createSmokePick(repositories, 'utv2-996-duplicate');

    try {
      await transitionPickLifecycle(repositories.picks, result.pick.id, 'queued', 'utv2-996 drill queue');
      await transitionPickLifecycle(repositories.picks, result.pick.id, 'posted', 'utv2-996 drill post', 'poster');

      const first = await recordPickSettlement(
        result.pick.id,
        { status: 'settled', result: 'win', source: 'operator', confidence: 'confirmed', evidenceRef: 'db-smoke://utv2-996-dup', settledBy: 'codex' },
        repositories,
      );

      // Second call from 'settled' state routes to correction (service design: re-settle = correct)
      const second = await recordPickSettlement(
        result.pick.id,
        { status: 'settled', result: 'win', source: 'operator', confidence: 'confirmed', evidenceRef: 'db-smoke://utv2-996-dup', settledBy: 'codex' },
        repositories,
      );

      // Correction creates a new record — different ID
      assert.notEqual(first.settlementRecord.id, second.settlementRecord.id, 're-settlement must produce a correction record');
      // Correction points to original
      assert.equal(second.settlementRecord.corrects_id, first.settlementRecord.id, 'correction corrects_id must reference original');

      // Exactly one base record (corrects_id = null) — no true duplicate rows
      const { count: baseCount, error: baseError } = await client
        .from('settlement_records')
        .select('id', { count: 'exact', head: true })
        .eq('pick_id', result.pick.id)
        .is('corrects_id', null);
      assert.ifError(baseError);
      assert.equal(baseCount, 1, 'exactly one base settlement record must exist — no true duplicate rows');
    } finally {
      await client.from('picks').delete().eq('id', result.pick.id);
      await client.from('submissions').delete().eq('id', result.submission.id);
    }
  },
);

test(
  'UTV2-996: correction chain is additive — original settlement row is not mutated',
  { skip: smokeSkip() },
  async () => {
    const environment = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(environment);
    const client = createDatabaseClientFromConnection(connection);
    const repositories = createDatabaseRepositoryBundle(connection);
    const result = await createSmokePick(repositories, 'utv2-996-correction');

    try {
      await transitionPickLifecycle(repositories.picks, result.pick.id, 'queued', 'utv2-996 drill queue');
      await transitionPickLifecycle(repositories.picks, result.pick.id, 'posted', 'utv2-996 drill post', 'poster');

      const original = await recordPickSettlement(
        result.pick.id,
        { status: 'settled', result: 'win', source: 'operator', confidence: 'confirmed', evidenceRef: 'db-smoke://utv2-996-orig', settledBy: 'codex' },
        repositories,
      );

      const correction = await recordPickSettlement(
        result.pick.id,
        { status: 'settled', result: 'loss', source: 'operator', confidence: 'confirmed', evidenceRef: 'db-smoke://utv2-996-corr', settledBy: 'codex' },
        repositories,
      );

      assert.notEqual(original.settlementRecord.id, correction.settlementRecord.id, 'correction must produce a new settlement record');
      assert.equal(correction.settlementRecord.corrects_id, original.settlementRecord.id, 'correction corrects_id must point to original record');

      const { data: originalRow, error: origError } = await client
        .from('settlement_records')
        .select('id, result, corrects_id')
        .eq('id', original.settlementRecord.id)
        .single();
      assert.ifError(origError);
      assert.equal(originalRow!.result, 'win', 'original row result must not be mutated by correction');
      assert.equal(originalRow!.corrects_id, null, 'original row corrects_id must remain null');

      const { count: auditCount, error: auditError } = await client
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('entity_ref', result.pick.id)
        .like('action', 'settlement.%');
      assert.ifError(auditError);
      assert.ok((auditCount ?? 0) >= 2, 'audit_log must have entries for both original and correction settlements');
    } finally {
      await client.from('picks').delete().eq('id', result.pick.id);
      await client.from('submissions').delete().eq('id', result.submission.id);
    }
  },
);


// ── UTV2-1902 live-DB: Smart Form promotion is score-gated, persisted ────────
// Staging proof of the UTV2-1902 rule against the real schema: the promotion
// decision is read back from picks and pick_promotion_history, not from the
// in-memory result object.

async function submitSmartForm1902Live(
  label: string,
  extraMetadata: Record<string, unknown>,
  promotionScores: Record<string, number>,
) {
  const environment = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(environment);
  const client = createDatabaseClientFromConnection(connection);
  const repositories = createDatabaseRepositoryBundle(connection);
  const runId = randomUUID();
  const result = await processSubmission(
    {
      source: 'smart-form',
      submittedBy: 'griff843',
      market: 'MLB - Moneyline',
      selection: `UTV2-1902 live ${label} ${runId}`,
      odds: -120,
      confidence: 0.4,
      metadata: {
        sport: 'MLB',
        eventName: `UTV2-1902 live ${label} ${runId} at Opponent`,
        capper: 'griff843',
        promotionScores,
        ...extraMetadata,
      },
    },
    repositories,
  );
  const pickId = result.pick.id;
  const { data: pick, error: pickError } = await client
    .from('picks')
    .select('id, source, promotion_status, promotion_target, promotion_score, promotion_reason')
    .eq('id', pickId)
    .single();
  assert.equal(pickError, null, `picks read: ${pickError?.message}`);
  const { data: history, error: historyError } = await client
    .from('pick_promotion_history')
    .select('target, status, score, override_action, reason')
    .eq('pick_id', pickId);
  assert.equal(historyError, null, `pick_promotion_history read: ${historyError?.message}`);
  const { data: outbox, error: outboxError } = await client
    .from('distribution_outbox')
    .select('id')
    .eq('pick_id', pickId);
  assert.equal(outboxError, null, `distribution_outbox read: ${outboxError?.message}`);
  console.log(
    `UTV2-1902 live-DB ${label}: ${JSON.stringify({ pick, history, outboxRows: outbox?.length ?? null })}`,
  );
  return { pick: pick!, history: history ?? [], outbox: outbox ?? [] };
}

const liveSkip1902 = hasSupabaseSmokeEnvironment()
  ? false
  : 'SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not configured';

test('UTV2-1902 live-DB: a below-threshold Smart Form pick persists with no board target and no force_promote', { skip: liveSkip1902 }, async () => {
  const { pick, history, outbox } = await submitSmartForm1902Live('below', {}, {
    edge: 30, trust: 35, readiness: 40, uniqueness: 30, boardFit: 35,
  });
  assert.equal(pick.source, 'smart-form');
  assert.notEqual(pick.promotion_status, 'qualified', 'source alone must never qualify a pick');
  assert.equal(pick.promotion_target, null);
  assert.ok(history.length > 0, 'the promotion decision is still recorded');
  for (const row of history) {
    assert.notEqual(row.override_action, 'force_promote', `no source-only force_promote on ${row.target}`);
    assert.notEqual(row.status, 'qualified', `no board qualified row on ${row.target}`);
    assert.doesNotMatch(row.reason ?? '', /route directly to best-bets/);
  }
  assert.equal(outbox.length, 0);
});

test('UTV2-1902 live-DB: a qualifying Smart Form pick persists as qualified for best-bets by score', { skip: liveSkip1902 }, async () => {
  const { pick, history } = await submitSmartForm1902Live('qualifying', {}, {
    edge: 75, trust: 75, readiness: 80, uniqueness: 75, boardFit: 80,
  });
  const bestBets = history.find((row) => row.target === 'best-bets');
  assert.ok(bestBets, 'a best-bets decision row exists');
  assert.equal(bestBets!.override_action, null, 'decided by policy, not by override');
  assert.doesNotMatch(bestBets!.reason ?? '', /route directly to best-bets/, 'no source routing');
  // Staging accumulates qualified fixtures, so the shared slate cap can be saturated. The
  // score-gate claim is that the pick clears every score threshold; the only admissible refusal
  // is board capacity, which is a genuine policy decision rather than source routing.
  assert.doesNotMatch(bestBets!.reason ?? '', /below threshold/, 'the pick clears every best-bets score threshold');
  if (bestBets!.status === 'qualified') {
    assert.equal(pick.promotion_status, 'qualified');
    assert.equal(pick.promotion_target, 'best-bets');
  } else {
    assert.match(bestBets!.reason ?? '', /board cap/, `only board capacity may refuse a qualifying score: ${bestBets!.reason}`);
  }
});

test('UTV2-1902 live-DB: a human capper delivery pick that meets a board threshold persists with no board target', { skip: liveSkip1902 }, async () => {
  const { pick, history, outbox } = await submitSmartForm1902Live(
    'human-capper',
    {
      distributionMode: 'delivery-eligible',
      deliveryAuthorization: {
        version: 'human-capper-delivery/v1',
        decision: 'authorized',
        authority: 'server-allowlist',
        capperId: 'griff843',
        decidedAt: new Date().toISOString(),
      },
    },
    { edge: 80, trust: 80, readiness: 85, uniqueness: 82, boardFit: 83 },
  );
  assert.notEqual(pick.promotion_status, 'qualified');
  assert.equal(pick.promotion_target, null);
  assert.match(pick.promotion_reason ?? '', /board promotion not applicable/);
  assert.ok(Number(pick.promotion_score ?? 0) >= 70, `score retained as information: ${pick.promotion_score}`);
  for (const row of history) {
    assert.notEqual(row.status, 'qualified', `no board qualified row on ${row.target}`);
    assert.notEqual(row.override_action, 'force_promote');
  }
  assert.equal(outbox.length, 0, 'promotion evaluation writes no outbox row');
});
