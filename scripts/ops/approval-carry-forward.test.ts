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
  evaluateC5,
  evaluateC6,
  evaluateC7,
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
    // C5/C6/C7 evidence for the same real case: two clean merges from main,
    // four bookkeeping paths whose content at the head is main's own, nothing
    // reachable off main but the merges themselves, and an unchanged PR diff.
    mergeOwnContent: [
      { sha: HEAD, paths: [] },
      { sha: 'd82396753aedd9b299853b13bf9a596fcb6893b7', paths: [] },
    ],
    blobIdentity: [
      { path: 'docs/06_status/lanes/UTV2-1834.json', atHead: 'a'.repeat(40), atMain: 'a'.repeat(40) },
      { path: 'docs/06_status/proof/UTV2-1834/evidence.json', atHead: 'b'.repeat(40), atMain: 'b'.repeat(40) },
      { path: 'docs/06_status/readiness/readiness-score.json', atHead: 'c'.repeat(40), atMain: 'c'.repeat(40) },
      { path: '.ops/sync/UTV2-1833.yml', atHead: 'd'.repeat(40), atMain: 'd'.repeat(40) },
    ],
    mainAnchorSha: '1faf29c35c1b2c13ed99adf836d2d0f11ac6f52e',
    mainAnchorIsOnMain: true,
    commitsNotOnMain: [HEAD, 'd82396753aedd9b299853b13bf9a596fcb6893b7'],
    prDiffPatchId: { atApproved: 'e'.repeat(40), atHead: 'e'.repeat(40) },
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
  assert.match(result.detail, /merged parent\(s\) not on origin\/main/);
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

// --- C5: evil merges and unreviewed conflict resolutions -------------------
//
// The fixtures below are measured, not invented. On 2026-09-06, against
// `origin/main` at 175f07c10:
//
//   $ for s in $(git rev-list --first-parent --merges -20 origin/main); do
//       echo "$s $(git diff-tree --cc -r --name-only $s | tail -n +2 | wc -l)"; done
//
// reported 0 for nineteen of the twenty merges and 1 for c31b8ee19, whose
// single reported path is docs/06_status/lanes/UTV2-1514.json — a path
// ALLOW_PATTERNS[0] admits.

const EVIL_MERGE = 'c31b8ee191e1704a5ebca70e60e178b97a433d99';

/** The nineteen merges measured clean in that same window. */
const CLEAN_MERGES = [
  '1734bf2017eb0fe5e00d93a4cff3d074d7be4546',
  '5ed005a6da848917a355c4c0ee5e7d8f5513713b',
  'c35afcfcfa333709780fb930793a0cd81641173b',
  'b2dbf5225c79160536e3ea2d03d96054664b7331',
  '412fd1a8f0e65244acd6e058c2f7136095dbb7ab',
  '8a7b5849aa747a80ce7f00d190d53c8df87cd139',
  '6997ad82a7b10a14399a8ff877536c9d12ac51b2',
  '0b47dd00a65cff2ecb5d4e113273ef35b99a1118',
  'b20c0469507eb0b7ba99dd3c451049011d7d7a29',
  'c8e951a213d98e61add82e9e0b0c0a78686eb290',
  '709b06270431336fcc087a0a25f50d72ec927d92',
  'ed62fee13f951fba10740cfe226a776fae594393',
  '0ea8c653017663ccb8d854b08984e583c61617ff',
  'f3b3fbda09acc5b30d857ae249a77691d475869e',
  'eed18a7328cd106c303c352be9cbb4bd08dd9f2c',
  '1041457b197f013986d350adf0c68dbb4964d02a',
  '388ef5f58c985f9da0f1c9cf9ef3305bb7a206a2',
  '736d0d41603702da50af148ae714e98dd4befcfa',
  '0a1fcfc4671a58930f06899ad24634017cb48398',
];

const MAIN_PARENT = '1faf29c35c1b2c13ed99adf836d2d0f11ac6f52e';

/** The evil merge, placed on a chain, with every other condition satisfied. */
function evilMergeInputs(): CarryForwardInputs {
  return baseInputs({
    firstParentChain: [merge(EVIL_MERGE, MAIN_PARENT, "Merge remote-tracking branch 'origin/main'")],
    commitsNotOnMain: [EVIL_MERGE],
    mergeOwnContent: [{ sha: EVIL_MERGE, paths: ['docs/06_status/lanes/UTV2-1514.json'] }],
    changedPaths: ['docs/06_status/lanes/UTV2-1514.json'],
    blobIdentity: [
      // The merge's content IS what the head now holds, and it is also what
      // the anchor holds, because the evil merge is itself on main. C6 cannot
      // see this one; only C5 can.
      { path: 'docs/06_status/lanes/UTV2-1514.json', atHead: 'f'.repeat(40), atMain: 'f'.repeat(40) },
    ],
  });
}

test('C5 refuses the real evil merge c31b8ee19, naming the path it introduced', () => {
  const result = evaluateC5(evilMergeInputs());
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /c31b8ee19/);
  assert.match(result.detail, /docs\/06_status\/lanes\/UTV2-1514\.json/);
});

test('C5 admits the nineteen merges measured clean in the same window', () => {
  const result = evaluateC5(
    baseInputs({
      firstParentChain: CLEAN_MERGES.map((sha) => merge(sha, MAIN_PARENT)),
      commitsNotOnMain: CLEAN_MERGES,
      mergeOwnContent: CLEAN_MERGES.map((sha) => ({ sha, paths: [] })),
    }),
  );
  assert.equal(result.status, 'pass');
  assert.match(result.detail, /19 merge\(s\) measured/);
});

test('C5 refuses a chain merge that was never measured — not measured is not clean', () => {
  const result = evaluateC5(
    baseInputs({
      firstParentChain: [merge(HEAD, MAIN_PARENT), merge(EVIL_MERGE, MAIN_PARENT)],
      mergeOwnContent: [{ sha: HEAD, paths: [] }],
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /no merge-content measurement for c31b8ee19/);
  assert.match(result.detail, /absence of evidence/);
});

test('INVERSION: without C5, the real evil merge passes every other condition', () => {
  // This is the whole justification for C5 existing. If C1-C4, C6 and C7 caught
  // it, C5 would be decoration. They do not: the merge introduces content on a
  // path the allowlist admits, and once that content is on main it is also what
  // the anchor holds, so the blob comparison agrees too.
  const input = evilMergeInputs();
  for (const condition of [evaluateC1(input), evaluateC2(input), evaluateC4(input), evaluateC6(input), evaluateC7(input)]) {
    assert.equal(condition.status, 'pass', `${condition.id} unexpectedly caught the evil merge: ${condition.detail}`);
  }
  assert.equal(evaluateC3(input).result.status, 'pass');
  assert.equal(evaluateC5(input).status, 'fail');
  assert.equal(evaluateCarryForward(input).verdict, 'REFUSED');
});

// --- C6: incoming content must literally be main's -------------------------

test('C6 admits paths whose blob at the head equals main\'s blob at the anchor', () => {
  const result = evaluateC6(baseInputs());
  assert.equal(result.status, 'pass');
  assert.match(result.detail, /4 path\(s\) byte-identical to main/);
});

test('C6 refuses a path whose blob at the head differs from main\'s', () => {
  const result = evaluateC6(
    baseInputs({
      blobIdentity: [
        { path: 'docs/06_status/lanes/UTV2-1834.json', atHead: '1'.repeat(40), atMain: '2'.repeat(40) },
      ],
      changedPaths: ['docs/06_status/lanes/UTV2-1834.json'],
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /UTV2-1834\.json \(head 111111111 vs main 222222222\)/);
});

test('C6 refuses a path that exists at the head but not on main', () => {
  const result = evaluateC6(
    baseInputs({
      blobIdentity: [{ path: '.ops/sync/UTV2-9999.yml', atHead: '3'.repeat(40), atMain: null }],
      changedPaths: ['.ops/sync/UTV2-9999.yml'],
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /head 333333333 vs main absent/);
});

test('C6 treats absent-on-both-sides as identical, so a deletion main also made is admitted', () => {
  const result = evaluateC6(
    baseInputs({
      blobIdentity: [{ path: '.ops/sync/UTV2-1833.yml', atHead: null, atMain: null }],
      changedPaths: ['.ops/sync/UTV2-1833.yml'],
    }),
  );
  assert.equal(result.status, 'pass');
});

test('C6 refuses when the comparison anchor is not on the base branch', () => {
  const result = evaluateC6(baseInputs({ mainAnchorIsOnMain: false }));
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /is not an ancestor of the freshly fetched base branch/);
});

test('C6 refuses a changed path that was never measured', () => {
  const result = evaluateC6(
    baseInputs({
      changedPaths: ['docs/06_status/lanes/UTV2-1834.json', 'docs/06_status/readiness/readiness-score.json'],
      blobIdentity: [
        { path: 'docs/06_status/lanes/UTV2-1834.json', atHead: '4'.repeat(40), atMain: '4'.repeat(40) },
      ],
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /no blob measurement for docs\/06_status\/readiness\/readiness-score\.json/);
});

test('INVERSION: without C6, content that is on an allowed path but is not main\'s passes everything else', () => {
  // A bookkeeping path is admitted by C3 by name. Nothing in C1-C5 or C7 looks
  // at what that path now contains — C1 sees only merges, C2 sees a
  // non-reviewed path, C5 sees a clean merge because the content arrived on
  // the branch side rather than in the merge itself.
  const input = baseInputs({
    changedPaths: ['docs/06_status/lanes/UTV2-1834.json'],
    blobIdentity: [
      { path: 'docs/06_status/lanes/UTV2-1834.json', atHead: '9'.repeat(40), atMain: '8'.repeat(40) },
    ],
  });
  for (const condition of [evaluateC1(input), evaluateC2(input), evaluateC4(input), evaluateC5(input), evaluateC7(input)]) {
    assert.equal(condition.status, 'pass', `${condition.id} unexpectedly caught it: ${condition.detail}`);
  }
  assert.equal(evaluateC3(input).result.status, 'pass');
  assert.equal(evaluateC6(input).status, 'fail');
  assert.equal(evaluateCarryForward(input).verdict, 'REFUSED');
});

// --- C1, widened -----------------------------------------------------------

test('C1 refuses a commit reachable from the head that main does not contain', () => {
  // The merge's own second parent IS on main, so the per-parent check passes.
  // What it cannot see is that the merge dragged in, through that parent's
  // ancestry, a commit main never had.
  const smuggled = '7'.repeat(40);
  const result = evaluateC1(
    baseInputs({
      firstParentChain: [merge(HEAD, MAIN_PARENT)],
      commitsNotOnMain: [HEAD, smuggled],
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /reachable from the head but not from origin\/main/);
  assert.match(result.detail, /7777777/);
});

test('C1 checks every merged parent, not only the second — an octopus merge is not exempt', () => {
  const result = evaluateC1(
    baseInputs({
      firstParentChain: [
        {
          sha: HEAD,
          parents: [`${HEAD}-p1`, MAIN_PARENT, '6'.repeat(40)],
          subject: 'Merge branches main and something-else',
        },
      ],
      commitsNotOnMain: [HEAD],
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /merged parent\(s\) not on origin\/main/);
  assert.match(result.detail, /6666666/);
});

// --- C7 --------------------------------------------------------------------

test('C7 passes when the PR diff patch-id is identical at both points', () => {
  const result = evaluateC7(baseInputs());
  assert.equal(result.status, 'pass');
  assert.match(result.detail, /identical at the approved SHA and at the head/);
});

test('C7 refuses when the PR diff patch-id changed', () => {
  const result = evaluateC7(
    baseInputs({ prDiffPatchId: { atApproved: 'a'.repeat(40), atHead: 'b'.repeat(40) } }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /patch-id changed/);
});

test('C7 reports an uncomputable patch-id as unproven rather than refusing on it alone', () => {
  const result = evaluateC7(baseInputs({ prDiffPatchId: { atApproved: null, atHead: 'b'.repeat(40) } }));
  assert.equal(result.status, 'pass');
  assert.match(result.detail, /unavailable/);
  assert.match(result.detail, /C6 is the enforcing condition/);
});

test('the receipt records the anchor and both patch-ids so a reader can recheck them', () => {
  const receipt = renderReceipt(evaluateCarryForward(baseInputs()), 'https://example.invalid/run/1');
  assert.match(receipt, /^Main-Anchor-SHA: 1faf29c35c1b2c13ed99adf836d2d0f11ac6f52e$/m);
  assert.match(receipt, /^PR-Diff-Patch-Id: e{40} \(approved\) \/ e{40} \(head\)$/m);
  assert.match(receipt, /\[x\] C5 —/);
  assert.match(receipt, /\[x\] C6 —/);
  assert.match(receipt, /\[x\] C7 —/);
});
