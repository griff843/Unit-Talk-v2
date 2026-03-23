/**
 * Full-Cycle Verification — Force-Promote Proof Script
 *
 * Purpose: Promote a pick that already has the correct domain score (86.12) but
 * was blocked by board caps filled by previous test-run picks. Uses the
 * force_promote override which bypasses board caps.
 *
 * Run: npx tsx apps/api/src/scripts/proof-force-promote.ts <pickId>
 */
import { createDatabaseRepositoryBundle, createServiceRoleDatabaseConnectionConfig } from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';
import { applyPromotionOverride } from '../promotion-service.js';
import { enqueueDistributionWithRunTracking } from '../run-audit-service.js';

const pickId = process.argv[2];
if (!pickId) {
  console.error('Usage: npx tsx proof-force-promote.ts <pickId>');
  process.exit(1);
}

const env = loadEnvironment();
const connection = createServiceRoleDatabaseConnectionConfig(env);
const repositories = createDatabaseRepositoryBundle(connection);

console.log(`=== Full-Cycle Verification — Force-Promote Proof ===`);
console.log(`Pick ID: ${pickId}\n`);

// Step 1: Force-promote to best-bets (bypasses board caps)
const promotionResult = await applyPromotionOverride(
  {
    pickId,
    actor: 'verification-sprint',
    action: 'force_promote',
    reason: 'full-cycle-verification-sprint board-full-bypass',
    target: 'best-bets',
  },
  repositories.picks,
  repositories.audit,
);

console.log('Promotion result:');
console.log('  pick.promotionStatus:', promotionResult.pick.promotionStatus);
console.log('  pick.promotionTarget:', promotionResult.pick.promotionTarget);
console.log('  decision.qualified:  ', promotionResult.decision.qualified);
console.log('  decision.status:     ', promotionResult.decision.status);

if (!promotionResult.decision.qualified) {
  console.error('\nERROR: Force-promote did not qualify the pick. Reasons:', promotionResult.decision.explanation?.suppressionReasons);
  process.exit(1);
}

// Step 2: Enqueue for distribution
const distributionTarget = `discord:${promotionResult.pick.promotionTarget}`;
console.log(`\nEnqueueing for distribution target: ${distributionTarget}`);

try {
  await enqueueDistributionWithRunTracking(
    promotionResult.pick,
    distributionTarget,
    'proof-force-promote',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );
  console.log(`\nOUTBOX ENQUEUED: TRUE`);
  console.log(`Pick ${pickId} is now status=queued and in distribution_outbox`);
} catch (err) {
  console.error('Enqueue failed:', err);
  process.exit(1);
}

process.exit(0);
