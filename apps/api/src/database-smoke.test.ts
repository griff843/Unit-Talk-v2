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

      const { error: driftError } = await client
        .from('picks')
        .update({ status: 'validated' })
        .eq('id', result.pick.id);
      assert.ifError(driftError);

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
            lifecycleFromState: 'queued',
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

