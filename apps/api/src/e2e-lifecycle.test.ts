import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadEnvironment } from '@unit-talk/config';
import type { PickLifecycleState, SubmissionPayload } from '@unit-talk/contracts';
import {
  createCanonicalPickFromSubmission,
  createValidatedSubmission,
} from '@unit-talk/domain';
import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  mapValidatedSubmissionToSubmissionCreateInput,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { evaluateAllPoliciesEagerAndPersist } from './promotion-service.js';
import { enqueueDistributionWithRunTracking } from './run-audit-service.js';
import { recordPickSettlement } from './settlement-service.js';

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
  : 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured';

interface LifecycleRow {
  from_state: string | null;
  to_state: PickLifecycleState;
}

interface PromotionHistoryRow {
  target: string;
  status: string;
  score: number | null;
}

interface OutboxRow {
  id: string;
  pick_id: string;
  target: string;
  status: string;
}

interface SettlementRow {
  id: string;
  pick_id: string;
  status: string;
  result: string | null;
}

test(
  'UTV2-653 E2E lifecycle: submission draft validates, queues, posts, and settles in live DB',
  { skip: skipReason },
  async () => {
    const env = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    const client = createDatabaseClientFromConnection(connection);
    const repositories = createDatabaseRepositoryBundle(connection);
    const fixtureId = `utv2-653-${randomUUID()}`;
    const createdSystemRunIds: string[] = [];

    let pickId: string | null = null;
    let submissionId: string | null = null;

    try {
      const payload: SubmissionPayload = {
        source: 'api',
        submittedBy: 'codex',
        market: 'NBA assists',
        selection: `UTV2-653 Over 8.5 ${fixtureId}`,
        line: 8.5,
        odds: -110,
        stakeUnits: 1,
        confidence: 0.9,
        eventName: `UTV2-653 lifecycle ${fixtureId}`,
        metadata: {
          sport: 'NBA',
          eventName: `UTV2-653 lifecycle ${fixtureId}`,
          proofFixtureId: fixtureId,
          proofIssue: 'UTV2-653',
          promotionScores: {
            edge: 78,
            trust: 79,
            readiness: 88,
            uniqueness: 82,
            boardFit: 90,
          },
        },
      };

      const receivedAt = new Date(Date.now() - 5_000).toISOString();
      const submission = createValidatedSubmission(randomUUID(), payload, receivedAt);
      submissionId = submission.id;
      const materialized = createCanonicalPickFromSubmission(submission, {
        lifecycleState: 'draft',
        approvalStatus: 'approved',
      });
      pickId = materialized.pick.id;

      await repositories.submissions.saveSubmission(
        mapValidatedSubmissionToSubmissionCreateInput(submission),
      );
      await repositories.submissions.saveSubmissionEvent({
        submissionId: submission.id,
        eventName: 'submission.accepted',
        payload: {
          source: payload.source,
          market: payload.market,
          selection: payload.selection,
          fixtureId,
        },
        createdAt: receivedAt,
      });
      await repositories.picks.savePick(materialized.pick, `${fixtureId}:draft-pick`);
      await repositories.picks.saveLifecycleEvent(materialized.lifecycleEvent);

      const validated = await transitionPickLifecycle(
        repositories.picks,
        pickId,
        'validated',
        'UTV2-653 draft submission validated',
        'submitter',
      );
      assert.equal(validated.lifecycleState, 'validated');

      const promotion = await evaluateAllPoliciesEagerAndPersist(
        pickId,
        'utv2-653-test',
        repositories.picks,
        repositories.audit,
        repositories.settlements,
      );
      assert.equal(promotion.pick.promotionStatus, 'qualified');
      assert.ok(
        typeof promotion.pick.promotionScore === 'number' &&
          promotion.pick.promotionScore >= 70,
        'promotion score should be computed and qualify',
      );

      const distribution = await enqueueDistributionWithRunTracking(
        promotion.pick,
        'simulation',
        'utv2-653-test',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      );
      createdSystemRunIds.push(distribution.run.id);
      assert.equal(distribution.target, 'simulation');

      const outbox = await requireLatestOutbox(client, pickId);
      assert.equal(outbox.target, 'simulation');
      assert.equal(outbox.status, 'pending');

      const claimed = await markOutboxProcessing(client, outbox.id, 'utv2-653-worker');
      assert.equal(claimed.id, outbox.id);
      assert.equal(claimed.pick_id, pickId);

      const confirmed = await repositories.outbox.confirmDeliveryAtomic({
        outboxId: claimed.id,
        pickId,
        workerId: 'utv2-653-worker',
        receiptType: 'simulation.delivery',
        receiptStatus: 'sent',
        receiptChannel: 'simulation',
        receiptExternalId: `${fixtureId}:message`,
        receiptIdempotencyKey: `${fixtureId}:receipt`,
        receiptPayload: { fixtureId, proofIssue: 'UTV2-653' },
        lifecycleFromState: 'queued',
        lifecycleToState: 'posted',
        lifecycleWriterRole: 'poster',
        lifecycleReason: 'UTV2-653 downstream delivery confirmed',
        auditAction: 'distribution.sent',
        auditPayload: { pickId, outboxId: claimed.id, target: 'simulation' },
      });
      assert.equal(confirmed.outbox.status, 'sent');
      assert.equal(confirmed.alreadyConfirmed, false);

      const settlement = await recordPickSettlement(
        pickId,
        {
          status: 'settled',
          result: 'win',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: `utv2-653://${fixtureId}`,
          settledBy: 'utv2-653-test',
          notes: 'E2E lifecycle integration test settlement',
        },
        repositories,
      );
      assert.equal(settlement.finalLifecycleState, 'settled');
      assert.equal(settlement.settlementRecord.result, 'win');

      const savedPick = await repositories.picks.findPickById(pickId);
      assert.equal(savedPick?.status, 'settled');

      const lifecycleRows = await listLifecycleRows(client, pickId);
      assert.ok(
        lifecycleRows.length >= 5,
        `expected at least 5 lifecycle rows, got ${lifecycleRows.length}`,
      );
      assert.deepEqual(
        lifecycleRows.map((row) => row.to_state).slice(0, 5),
        ['draft', 'validated', 'queued', 'posted', 'settled'],
      );
      assert.deepEqual(
        lifecycleRows.slice(1, 5).map((row) => [row.from_state, row.to_state]),
        [
          ['draft', 'validated'],
          ['validated', 'queued'],
          ['queued', 'posted'],
          ['posted', 'settled'],
        ],
      );

      const promotionRows = await listPromotionRows(client, pickId);
      assert.ok(
        promotionRows.length >= 1,
        'pick_promotion_history should include at least one row',
      );
      assert.ok(
        promotionRows.some((row) => row.status === 'qualified' && (row.score ?? 0) >= 70),
        'promotion history should include a qualified scored row',
      );

      const outboxRows = await listOutboxRows(client, pickId);
      assert.ok(
        outboxRows.some((row) => row.target === 'simulation'),
        'distribution_outbox should include simulation target',
      );

      const settlementRows = await listSettlementRows(client, pickId);
      assert.ok(
        settlementRows.some((row) => row.status === 'settled' && row.result === 'win'),
        'settlement_records should include the final settled result',
      );
    } finally {
      await cleanupLifecycleFixture(client, {
        pickId,
        submissionId,
        systemRunIds: createdSystemRunIds,
      });
    }
  },
);

async function listLifecycleRows(client: UnitTalkSupabaseClient, pickId: string) {
  const { data, error } = await client
    .from('pick_lifecycle')
    .select('from_state,to_state')
    .eq('pick_id', pickId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to read lifecycle rows: ${error.message}`);
  }

  return (data ?? []) as LifecycleRow[];
}

async function listPromotionRows(client: UnitTalkSupabaseClient, pickId: string) {
  const { data, error } = await client
    .from('pick_promotion_history')
    .select('target,status,score')
    .eq('pick_id', pickId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to read promotion history rows: ${error.message}`);
  }

  return (data ?? []) as PromotionHistoryRow[];
}

async function listOutboxRows(client: UnitTalkSupabaseClient, pickId: string) {
  const { data, error } = await client
    .from('distribution_outbox')
    .select('id,pick_id,target,status')
    .eq('pick_id', pickId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to read outbox rows: ${error.message}`);
  }

  return (data ?? []) as OutboxRow[];
}

async function listSettlementRows(client: UnitTalkSupabaseClient, pickId: string) {
  const { data, error } = await client
    .from('settlement_records')
    .select('id,pick_id,status,result')
    .eq('pick_id', pickId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to read settlement rows: ${error.message}`);
  }

  return (data ?? []) as SettlementRow[];
}

async function requireLatestOutbox(client: UnitTalkSupabaseClient, pickId: string) {
  const rows = await listOutboxRows(client, pickId);
  const outbox = rows.at(-1);
  assert.ok(outbox, 'distribution_outbox row should exist after enqueue');
  return outbox;
}

async function markOutboxProcessing(
  client: UnitTalkSupabaseClient,
  outboxId: string,
  workerId: string,
) {
  const { data, error } = await client
    .from('distribution_outbox')
    .update({
      status: 'processing',
      claimed_at: new Date().toISOString(),
      claimed_by: workerId,
    })
    .eq('id', outboxId)
    .eq('status', 'pending')
    .select('id,pick_id,target,status')
    .single();

  if (error || !data) {
    throw new Error(`Failed to mark outbox row processing: ${error?.message ?? 'unknown error'}`);
  }

  return data as OutboxRow;
}

async function cleanupLifecycleFixture(
  client: UnitTalkSupabaseClient,
  input: {
    pickId: string | null;
    submissionId: string | null;
    systemRunIds: string[];
  },
) {
  if (input.pickId) {
    const outboxRows = await listOutboxRows(client, input.pickId);
    const outboxIds = outboxRows.map((row) => row.id);

    if (outboxIds.length > 0) {
      await deleteIn(client, 'distribution_receipts', 'outbox_id', outboxIds);
    }

    await deleteEq(client, 'settlement_records', 'pick_id', input.pickId);
    await deleteEq(client, 'distribution_outbox', 'pick_id', input.pickId);
    await deleteEq(client, 'pick_promotion_history', 'pick_id', input.pickId);
    await deleteEq(client, 'pick_lifecycle', 'pick_id', input.pickId);
    await deleteEq(client, 'picks', 'id', input.pickId);
  }

  if (input.submissionId) {
    await deleteEq(client, 'submission_events', 'submission_id', input.submissionId);
    await deleteEq(client, 'submissions', 'id', input.submissionId);
  }

  if (input.systemRunIds.length > 0) {
    await deleteIn(client, 'system_runs', 'id', input.systemRunIds);
  }
}

async function deleteEq(
  client: UnitTalkSupabaseClient,
  table: string,
  column: string,
  value: string,
) {
  const { error } = await client.from(table).delete().eq(column, value);
  if (error) {
    throw new Error(`Failed to clean ${table}.${column}=${value}: ${error.message}`);
  }
}

async function deleteIn(
  client: UnitTalkSupabaseClient,
  table: string,
  column: string,
  values: string[],
) {
  const { error } = await client.from(table).delete().in(column, values);
  if (error) {
    throw new Error(`Failed to clean ${table}.${column} in fixture set: ${error.message}`);
  }
}
