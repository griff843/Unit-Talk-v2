import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ALLOW_PATTERNS,
  CARRY_FORWARD_SCHEMA,
  denyPatternsFor,
  evaluateC1,
  evaluateC2,
  evaluateC3,
  evaluateC4,
  evaluateCarryForward,
  renderReceipt,
  type CarryForwardInputs,
  type ChainCommit,
} from './approval-carry-forward.ts';

const APPROVED = 'b06593e94aec45cb7b015c868ac1aa7e65031a31';
const HEAD = '6bfc5875ae5e8e4eced7b4ccde86f95a499d2faf';
const MAIN_COMMITS = new Set([
  '1faf29c35c1b2c13ed99adf836d2d0f11ac6f52e',
  '1d76b75e1296871346284c50032b706009416fc6',
  '879569a1b0000000000000000000000000000000',
]);

function merge(sha: string, secondParent: string, subject = 'Merge branch main'): ChainCommit {
  return { sha, parents: [`${sha}-p1`, secondParent], subject };
}

/**
 * The real case this mechanism was built for: PR #1503 at UTV2-1812, where the
 * approved head was overtaken purely by other lanes' merges into main.
 */
function baseInputs(overrides: Partial<CarryForwardInputs> = {}): CarryForwardInputs {
  return {
    issueId: 'UTV2-1812',
    headSha: HEAD,
    approvedSha: APPROVED,
    approvedAt: '2026-09-05T16:00:00.000Z',
    approvalCommentUrl: 'https://github.com/griff843/Unit-Talk-v2/pull/1503#issuecomment-1',
    approvedShaIsAncestor: true,
    firstParentChain: [
      merge(HEAD, '1faf29c35c1b2c13ed99adf836d2d0f11ac6f52e'),
      merge('d82396753aedd9b299853b13bf9a596fcb6893b7', '1d76b75e1296871346284c50032b706009416fc6'),
    ],
    isAncestorOfMain: (sha) => MAIN_COMMITS.has(sha),
    changedPaths: [
      'docs/06_status/lanes/UTV2-1834.json',
      'docs/06_status/proof/UTV2-1834/evidence.json',
      'docs/06_status/readiness/readiness-score.json',
      '.ops/sync/UTV2-1833.yml',
    ],
    requiredChecks: [
      { context: 'verify', conclusion: 'success' },
      { context: 'Executor Result Validation', conclusion: 'success' },
      { context: 'P0 Protocol', conclusion: 'success' },
    ],
    withdrawals: [],
    ...overrides,
  };
}

test('the real carry-forward case verifies end to end', () => {
  const result = evaluateCarryForward(baseInputs());
  assert.equal(result.verdict, 'VERIFIED');
  assert.equal(result.schema, CARRY_FORWARD_SCHEMA);
  assert.deepEqual(result.refusals, []);
  assert.equal(result.admitted_paths.length, 4);
  assert.equal(result.original_verdict_sha, APPROVED);
  assert.equal(result.current_head_sha, HEAD);
});

// --- C1 -------------------------------------------------------------------

test('C1 refuses a newly authored commit on the first-parent chain', () => {
  const result = evaluateC1(
    baseInputs({
      firstParentChain: [
        merge(HEAD, '1faf29c35c1b2c13ed99adf836d2d0f11ac6f52e'),
        { sha: 'deadbeef1', parents: ['only-one'], subject: 'fix: sneak in a change' },
      ],
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /newly authored commit/);
  assert.match(result.detail, /sneak in a change/);
});

test('C1 refuses a merge whose second parent is not on origin/main', () => {
  const result = evaluateC1(
    baseInputs({
      firstParentChain: [merge(HEAD, 'f0rgedf0rgedf0rgedf0rgedf0rgedf0rgedf0rg')],
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /second parent is not on origin\/main/);
});

test('C1 refuses when the approved SHA is not an ancestor of the head', () => {
  const result = evaluateC1(baseInputs({ approvedShaIsAncestor: false }));
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /not an ancestor/);
});

test('C1 refuses an empty chain rather than silently carrying forward', () => {
  const result = evaluateC1(baseInputs({ firstParentChain: [] }));
  assert.equal(result.status, 'fail');
});

// --- C2 -------------------------------------------------------------------

for (const path of [
  'apps/command-center/src/middleware.ts',
  'packages/domain/src/pick.ts',
  'apps/api/src/submission-service.test.ts',
  'package.json',
  'pnpm-lock.yaml',
  'deploy/rollback.sh',
  'supabase/migrations/20260905_add_table.sql',
  'docs/06_status/proof/UTV2-1812/evidence.json',
]) {
  test(`C2 refuses when the reviewed artifact ${path} changed`, () => {
    const result = evaluateC2(baseInputs({ changedPaths: [path] }));
    assert.equal(result.status, 'fail');
    assert.match(result.detail, /reviewed artifacts changed/);
  });
}

test('C2 passes when only other lanes bookkeeping changed', () => {
  assert.equal(evaluateC2(baseInputs()).status, 'pass');
});

// --- C3 -------------------------------------------------------------------

for (const path of [
  'docs/mission/intent.md',
  'docs/05_operations/STANDING_GUARDRAILS.md',
  '.github/workflows/merge-gate.yml',
  'CODEOWNERS',
  '.lane/lanes/governance.yml',
  '.claude/hooks/session-start.sh',
  'scripts/ops/lane-close.ts',
]) {
  test(`C3 denies ${path}, which changes mission, security or approval policy`, () => {
    const { result } = evaluateC3(baseInputs({ changedPaths: [path] }));
    assert.equal(result.status, 'fail');
    assert.match(result.detail, /denied by/);
  });
}

test("C3 denies this issue's own lane manifest and proof, while admitting another lane's", () => {
  const own = evaluateC3(
    baseInputs({ changedPaths: ['docs/06_status/lanes/UTV2-1812.json'] }),
  );
  assert.equal(own.result.status, 'fail', "the lane's own manifest must never be carried forward");

  const other = evaluateC3(
    baseInputs({ changedPaths: ['docs/06_status/lanes/UTV2-1834.json'] }),
  );
  assert.equal(other.result.status, 'pass');
});

test('C3 refuses an unclassified path rather than defaulting to admit', () => {
  const { result } = evaluateC3(baseInputs({ changedPaths: ['README.md'] }));
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /matches no permitted bookkeeping rule/);
});

test('C3 evaluates deny before allow, so no allow pattern can widen into a denied path', () => {
  // This path matches an allow pattern by shape and a deny pattern by identity.
  const { result } = evaluateC3(
    baseInputs({ issueId: 'UTV2-1834', changedPaths: ['docs/06_status/proof/UTV2-1834/evidence.json'] }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /denied by/);
});

test('C3 records the admitting rule for every path it lets through', () => {
  const { admitted } = evaluateC3(baseInputs());
  assert.equal(admitted.length, 4);
  for (const entry of admitted) {
    assert.ok(ALLOW_PATTERNS.includes(entry.rule), `rule ${entry.rule} must be a declared allow pattern`);
  }
});

test('the deny list never exempts docs/ or .ops/ wholesale', () => {
  const deny = denyPatternsFor('UTV2-1812');
  assert.ok(!ALLOW_PATTERNS.includes('docs/**'));
  assert.ok(!ALLOW_PATTERNS.includes('.ops/**'));
  assert.ok(deny.includes('docs/mission/**'));
  assert.ok(deny.includes('docs/05_operations/**'));
});

// --- C4 -------------------------------------------------------------------

test('C4 refuses a red required check at the head', () => {
  const result = evaluateC4(
    baseInputs({
      requiredChecks: [
        { context: 'verify', conclusion: 'failure' },
        { context: 'Executor Result Validation', conclusion: 'success' },
        { context: 'P0 Protocol', conclusion: 'success' },
      ],
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /"verify" is failure/);
});

test('C4 refuses an absent required context rather than treating it as green', () => {
  const result = evaluateC4(
    baseInputs({ requiredChecks: [{ context: 'verify', conclusion: 'success' }] }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /is absent at the head/);
});

test('C4 refuses when a pm-verdict CHANGES_REQUIRED followed the approval', () => {
  const result = evaluateC4(
    baseInputs({
      withdrawals: [
        { source: 'pm-verdict', createdAt: '2026-09-05T17:00:00.000Z', detail: 'CHANGES_REQUIRED' },
      ],
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /pm-verdict after approval/);
});

test('C4 refuses when a GitHub review requested changes after the approval', () => {
  const result = evaluateC4(
    baseInputs({
      withdrawals: [
        { source: 'github-review', createdAt: '2026-09-05T17:00:00.000Z', detail: 'CHANGES_REQUESTED' },
      ],
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /github-review after approval/);
});

test('C4 ignores a changes-requested decision that predates the approval', () => {
  const result = evaluateC4(
    baseInputs({
      withdrawals: [
        { source: 'pm-verdict', createdAt: '2026-09-05T15:00:00.000Z', detail: 'CHANGES_REQUIRED' },
      ],
    }),
  );
  assert.equal(result.status, 'pass');
});

test("C4 does not require Merge Gate's own verdict, which is the caller", () => {
  const result = evaluateC4(baseInputs());
  assert.equal(result.status, 'pass');
});

// --- receipt --------------------------------------------------------------

test('the receipt states plainly that it is not an independent review', () => {
  const receipt = renderReceipt(evaluateCarryForward(baseInputs()), 'https://example/run/1');
  assert.match(
    receipt,
    /not an independent review and asserts nothing about the implementation/,
  );
  assert.match(receipt, /APPROVAL_CARRY_FORWARD: VERIFIED/);
  assert.match(receipt, new RegExp(`Original-Verdict-SHA: ${APPROVED}`));
  assert.match(receipt, new RegExp(`Current-Head-SHA: ${HEAD}`));
});

test('a refused result renders its refusals and admits no paths', () => {
  const result = evaluateCarryForward(
    baseInputs({ changedPaths: ['apps/command-center/src/middleware.ts'] }),
  );
  assert.equal(result.verdict, 'REFUSED');
  assert.deepEqual(result.admitted_paths, []);
  const receipt = renderReceipt(result, 'https://example/run/1');
  assert.match(receipt, /APPROVAL_CARRY_FORWARD: REFUSED/);
  assert.match(receipt, /Refusals:/);
});

test('a single failing condition refuses the whole carry-forward', () => {
  for (const override of [
    { approvedShaIsAncestor: false },
    { changedPaths: ['packages/domain/src/pick.ts'] },
    { changedPaths: ['docs/mission/intent.md'] },
    {
      withdrawals: [
        { source: 'pm-verdict' as const, createdAt: '2026-09-05T17:00:00.000Z', detail: 'CHANGES_REQUIRED' },
      ],
    },
  ]) {
    const result = evaluateCarryForward(baseInputs(override));
    assert.equal(result.verdict, 'REFUSED', `expected refusal for ${JSON.stringify(override)}`);
  }
});
