import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_STALE_CLAIM_MS,
  analyseStuckClaims,
  buildTriageReport,
  classifyDeadLetter,
  isCanaryTarget,
  isMemberFacingTarget,
  replayVerdict,
  verifyTargets,
  type DeadLetterClass,
  type OutboxRow,
} from './outbox-triage.ts';

/**
 * Fixtures mirror the real `distribution_outbox` Row type in
 * packages/db/src/database.types.ts field for field. Inventing a field here
 * would make every filter below vacuously true, so the shape is deliberately
 * exhaustive rather than partial.
 */
function row(overrides: Partial<OutboxRow> & Pick<OutboxRow, 'id' | 'status' | 'target'>): OutboxRow {
  return {
    pick_id: `pick-${overrides.id}`,
    attempt_count: 1,
    last_error: null,
    claimed_at: null,
    claimed_by: null,
    updated_at: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

const LIVE_REASONS: Record<string, DeadLetterClass> = {
  "proof-pick-blocked: source 't1-proof' is not a live source": 'proof_pick_blocked',
  stale_pending_operator_review: 'stale_pending_operator_review',
  'operator-disposition-2026-06-10: Mode 1 public delivery hold — stale discord:best-bets posts voided per PM go':
    'operator_disposition_voided',
  governance_public_delivery_suppressed_mode1_predeploy: 'governance_public_delivery_suppressed',
};

test('every live production reason string classifies to its named class', () => {
  for (const [reason, expected] of Object.entries(LIVE_REASONS)) {
    assert.equal(classifyDeadLetter(reason), expected, `reason: ${reason}`);
  }
});

test('a null or blank reason is classified, not silently dropped', () => {
  assert.equal(classifyDeadLetter(null), 'unclassified_null_reason');
  assert.equal(classifyDeadLetter('   '), 'unclassified_null_reason');
});

test('an unseen reason string does not fall into a reviewed class', () => {
  // Mutation: a reason that resembles a reviewed one but is not it must NOT
  // borrow that class, or a future failure mode inherits an old verdict.
  assert.equal(classifyDeadLetter('discord 500 gateway timeout'), 'unrecognised');
  assert.equal(classifyDeadLetter('source is live'), 'unrecognised');
});

test('target classification fails closed on an unrecognised target', () => {
  assert.equal(isCanaryTarget('discord:canary'), true);
  assert.equal(isCanaryTarget('utv2-1497-canary-alpha'), true);
  assert.equal(isMemberFacingTarget('discord:best-bets'), true);
  // The decisive case: something nobody has reviewed is member-facing, not safe.
  assert.equal(isMemberFacingTarget('discord:brand-new-channel'), true);
});

test('verifyTargets is safe only when no live row targets a member channel', () => {
  const safe = verifyTargets([
    row({ id: '1', status: 'pending', target: 'discord:canary' }),
    row({ id: '2', status: 'processing', target: 'utv2-1497-canary-alpha' }),
    // Dead letters on a member channel do not make the LIVE queue unsafe.
    row({ id: '3', status: 'dead_letter', target: 'discord:best-bets' }),
  ]);
  assert.equal(safe.safe, true);
  assert.deepEqual(safe.memberFacingTargets, []);
  assert.deepEqual(safe.canaryTargets, ['discord:canary', 'utv2-1497-canary-alpha']);

  // Mutation: promote that one dead letter to pending and the verdict flips.
  const unsafe = verifyTargets([
    row({ id: '1', status: 'pending', target: 'discord:canary' }),
    row({ id: '3', status: 'pending', target: 'discord:best-bets' }),
  ]);
  assert.equal(unsafe.safe, false);
  assert.deepEqual(unsafe.memberFacingTargets, ['discord:best-bets']);
});

test('a stale claim on an unconfigured target is reported as permanently orphaned', () => {
  const now = new Date('2026-08-26T00:00:00.000Z');
  const analysis = analyseStuckClaims(
    [
      row({
        id: 'orphan',
        status: 'processing',
        target: 'utv2-1497-canary-alpha',
        claimed_at: '2026-07-30T00:00:00.000Z',
        claimed_by: 'utv2-1497-worker-1-batch-a',
      }),
      row({
        id: 'reapable',
        status: 'processing',
        target: 'discord:canary',
        claimed_at: '2026-07-30T00:00:00.000Z',
        claimed_by: 'worker-live-1',
      }),
    ],
    { now, configuredTargets: ['discord:canary'] },
  );

  assert.equal(analysis.claims.length, 2);
  assert.deepEqual(
    analysis.orphaned.map((claim) => claim.id),
    ['orphan'],
  );
  // reapStaleClaims is per-target: the canary-fixture target is not in the
  // worker's configured set, so no reaper pass will ever reach it.
  assert.equal(analysis.claims.find((c) => c.id === 'orphan')?.reachableByReaper, false);
  assert.equal(analysis.claims.find((c) => c.id === 'reapable')?.reachableByReaper, true);
  assert.deepEqual(analysis.distinctWorkers, ['utv2-1497-worker-1-batch-a', 'worker-live-1']);
});

test('stale-claim detection fires on the threshold it names and not before', () => {
  const now = new Date('2026-08-26T00:00:00.000Z');
  const at = (offsetMs: number) =>
    analyseStuckClaims(
      [
        row({
          id: 'x',
          status: 'processing',
          target: 't',
          claimed_at: new Date(now.getTime() - offsetMs).toISOString(),
          claimed_by: 'w',
        }),
      ],
      { now, configuredTargets: [] },
    ).claims.length;

  assert.equal(at(DEFAULT_STALE_CLAIM_MS - 1), 0);
  assert.equal(at(DEFAULT_STALE_CLAIM_MS), 0);
  assert.equal(at(DEFAULT_STALE_CLAIM_MS + 1), 1);
});

test('an unclaimed processing row is not counted as a stuck claim', () => {
  const analysis = analyseStuckClaims(
    [row({ id: 'x', status: 'processing', target: 't', claimed_at: null, claimed_by: null })],
    { now: new Date('2026-08-26T00:00:00.000Z'), configuredTargets: [] },
  );
  assert.equal(analysis.claims.length, 0);
});

test('no dead-letter class is approved for replay, including an unknown one', () => {
  const classes: DeadLetterClass[] = [
    'proof_pick_blocked',
    'stale_pending_operator_review',
    'operator_disposition_voided',
    'governance_public_delivery_suppressed',
    'unclassified_null_reason',
    'unrecognised',
  ];
  for (const deadLetterClass of classes) {
    const verdict = replayVerdict(deadLetterClass);
    assert.equal(verdict.approved, false, `${deadLetterClass} must not be approved`);
    assert.ok(verdict.reason.length > 0);
  }

  // Mutation: a class value that does not exist yet still refuses, with a
  // reason, rather than returning an undefined verdict.
  const fabricated = replayVerdict('brand_new_class' as DeadLetterClass);
  assert.equal(fabricated.approved, false);
  assert.match(fabricated.reason, /fail closed/);
});

test('the full report reproduces the live production shape', () => {
  const now = new Date('2026-08-26T00:00:00.000Z');
  const rows: OutboxRow[] = [
    ...Array.from({ length: 3 }, (_, i) =>
      row({ id: `pending-${i}`, status: 'pending', target: 'discord:canary' }),
    ),
    ...Array.from({ length: 32 }, (_, i) =>
      row({
        id: `processing-${i}`,
        status: 'processing',
        target: `utv2-1497-canary-${i % 4}`,
        claimed_at: '2026-07-30T00:00:00.000Z',
        claimed_by: `utv2-1497-worker-${i % 8}-batch-${Math.floor(i / 8)}`,
      }),
    ),
    ...Object.entries(LIVE_REASONS).flatMap(([reason], index) =>
      Array.from({ length: index + 1 }, (_, i) =>
        row({
          id: `dl-${index}-${i}`,
          status: 'dead_letter',
          target: index === 0 ? 'discord:canary' : 'discord:best-bets',
          last_error: reason,
        }),
      ),
    ),
    row({ id: 'dl-null', status: 'dead_letter', target: 'discord:best-bets', last_error: null }),
  ];

  const report = buildTriageReport(rows, { now, configuredTargets: [] });

  assert.equal(report.totalDeadLetters, 1 + 2 + 3 + 4 + 1);
  assert.equal(report.maxDeadLetterAttempts, 1);
  assert.equal(report.targetVerification.safe, true);
  assert.equal(report.stuckClaims.claims.length, 32);
  assert.equal(report.stuckClaims.orphaned.length, 32);
  // 8 worker slots across 4 batches = 32 distinct worker identities, which is
  // what the live queue actually holds.
  assert.equal(report.stuckClaims.distinctWorkers.length, 32);
  assert.equal(report.stuckClaims.distinctTargets.length, 4);
  assert.equal(report.anyClassApprovedForReplay, false);
  assert.equal(
    report.replayVerdicts.every((verdict) => verdict.approved === false),
    true,
  );
  assert.equal(report.replayVerdicts.length, 5);
});
