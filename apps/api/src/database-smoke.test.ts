import assert from 'node:assert/strict';
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

    const result = await processSubmission(
      {
        source: 'db-smoke',
        submittedBy: 'codex',
        market: 'NBA points',
        selection: 'Player Over 21.5',
        line: 21.5,
        odds: -110,
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
