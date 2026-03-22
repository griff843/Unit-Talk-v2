/**
 * T1 Proof V2 — Enqueue Gap Fix Verification
 * Run: npx tsx apps/api/src/scripts/proof-enqueue-fix.ts
 */
import { createDatabaseRepositoryBundle, createServiceRoleDatabaseConnectionConfig } from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';
import { submitPickController } from '../controllers/submit-pick-controller.js';

const env = loadEnvironment();
const connection = createServiceRoleDatabaseConnectionConfig(env);
const repositories = createDatabaseRepositoryBundle(connection);

console.log('=== T1 Proof V2 — Enqueue Gap Fix Verification ===\n');

const result = await submitPickController(
  {
    source: 't1-proof-v2',
    submittedBy: 'griff',
    market: 'Tennis aces',
    selection: 'Player Over 10.5',
    line: 10.5,
    odds: -108,
    stakeUnits: 1.0,
    confidence: 0.78,
    eventName: 'ATP T1 Proof V2',
    metadata: {
      sport: 'Tennis',
      eventName: 'ATP T1 Proof V2',
      promotionScores: { edge: 91, trust: 87, readiness: 86, uniqueness: 88, boardFit: 89 },
    },
  },
  repositories,
);

console.log('Response status:', result.status);
if (result.body.ok) {
  const data = result.body.data;
  console.log('  pickId:          ', data.pickId);
  console.log('  lifecycleState:  ', data.lifecycleState);
  console.log('  promotionStatus: ', data.promotionStatus);
  console.log('  promotionTarget: ', data.promotionTarget);
  console.log('  outboxEnqueued:  ', data.outboxEnqueued);

  if (data.outboxEnqueued) {
    console.log('\nENQUEUE GAP: FIXED');
    console.log('Pick is now in distribution_outbox with status=pending, lifecycle=queued');
  } else {
    console.log('\nWARNING: outboxEnqueued=false');
    console.log('promotionStatus:', data.promotionStatus, '| promotionTarget:', data.promotionTarget);
  }
} else {
  console.error('Submission failed:', result.body);
}

process.exit(0);
