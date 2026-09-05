/**
 * UTV2-1836 — tests for the trusted evidence collector.
 *
 * These test the COLLECTOR's trust rules, not the verifier's conditions —
 * `approval-carry-forward.test.ts` already covers those against injected
 * evidence. What is at stake here is narrower and more dangerous: whether a
 * fact that reaches the verifier could have been written by the PR author.
 *
 * Every test therefore drives `collect` with fake `gh` and `git` and asserts on
 * WHICH command was issued and WHAT was refused — not merely on the verdict. A
 * collector that returned the right answer from the wrong source would pass a
 * verdict-only assertion and still be forgeable.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTHORIZED_REVIEWERS, collect } from './carry-forward-collect.ts';

const HEAD = 'a'.repeat(40);
const APPROVED = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);

function approvalBody(over: Partial<{ issue: string; pr: number; head: string; verdict: string }> = {}): string {
  const { issue = 'UTV2-1812', pr = 1503, head = APPROVED, verdict = 'APPROVED' } = over;
  return [
    `PM_VERDICT: ${verdict}`,
    'schema: pm-verdict/v1',
    `Issue: ${issue}`,
    `PR: ${pr}`,
    `Head SHA: ${head}`,
    '',
    'Reviewed.',
  ].join('\n');
}

interface Recorded {
  git: string[][];
  gh: string[][];
}

/**
 * A fake host. `gitFail` names argv prefixes that should throw, which is how
 * git reports "not an ancestor" and "not a commit" — both are exit codes, not
 * output, and a collector that read stdout instead would silently invert them.
 */
function harness(over: {
  comments?: unknown[];
  reviews?: unknown[];
  checkRuns?: unknown[];
  prState?: string;
  gitFail?: string[][];
  chain?: string;
  changed?: string;
} = {}) {
  const rec: Recorded = { git: [], gh: [] };
  const fails = over.gitFail ?? [];
  const gh = (args: string[]): string => {
    rec.gh.push(args);
    const url = args[args.length - 1];
    if (url.includes('/pulls/') && url.includes('/reviews')) return JSON.stringify(over.reviews ?? []);
    if (url.includes('/pulls/')) {
      return JSON.stringify({ head: { sha: HEAD }, base: { ref: 'main' }, state: over.prState ?? 'open' });
    }
    if (url.includes('/comments')) return JSON.stringify(over.comments ?? []);
    if (url.includes('check-runs')) return JSON.stringify({ check_runs: over.checkRuns ?? [] });
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  const git = (args: string[]): string => {
    rec.git.push(args);
    if (fails.some((f) => f.every((seg, i) => args[i] === seg))) {
      throw new Error(`git ${args.join(' ')} exited non-zero`);
    }
    if (args[0] === 'rev-list') return over.chain ?? '';
    if (args[0] === 'diff') return over.changed ?? '';
    return '';
  };
  return { rec, gh, git };
}

const ok = (body: string, over: Partial<{ login: string; type: string; at: string }> = {}) => ({
  body,
  created_at: over.at ?? '2026-09-05T10:00:00Z',
  html_url: 'https://example.invalid/c/1',
  user: { login: over.login ?? 'griff843', type: over.type ?? 'User' },
});

const call = (h: ReturnType<typeof harness>) =>
  collect({ prNumber: 1503, issueId: 'UTV2-1812', gh: h.gh, git: h.git });

test('the CODEOWNERS set matches the one merge-gate.yml enforces', () => {
  assert.deepEqual([...AUTHORIZED_REVIEWERS], ['griff843']);
});

test('a closed PR is refused before any evidence is gathered', () => {
  const h = harness({ prState: 'closed' });
  const r = call(h);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /is closed, not open/);
  assert.equal(h.rec.git.length, 0, 'no git command should run once the PR is refused');
});

test('origin is fetched before any ancestry question is asked', () => {
  const h = harness({ comments: [ok(approvalBody())] });
  call(h);
  const fetchAt = h.rec.git.findIndex((a) => a[0] === 'fetch');
  const ancestryAt = h.rec.git.findIndex((a) => a[0] === 'merge-base' || a[0] === 'cat-file');
  assert.ok(fetchAt >= 0, 'origin must be fetched');
  assert.ok(ancestryAt > fetchAt, 'every ancestry question must follow the fetch, not precede it');
  assert.deepEqual(h.rec.git[fetchAt], ['fetch', '--quiet', 'origin', 'main']);
});

test('an approval from a login outside CODEOWNERS is not an approval', () => {
  const h = harness({ comments: [ok(approvalBody(), { login: 'someone-else' })] });
  const r = call(h);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /no pm-verdict\/v1 APPROVED comment/);
});

test('a Bot posting under a CODEOWNERS login is not an approval', () => {
  const h = harness({ comments: [ok(approvalBody(), { type: 'Bot' })] });
  const r = call(h);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /no pm-verdict\/v1 APPROVED comment/);
});

test('an approval naming a different issue does not carry this one forward', () => {
  const h = harness({ comments: [ok(approvalBody({ issue: 'UTV2-9999' }))] });
  const r = call(h);
  assert.equal(r.ok, false);
});

test('an approval naming a different PR does not carry this one forward', () => {
  const h = harness({ comments: [ok(approvalBody({ pr: 4242 }))] });
  const r = call(h);
  assert.equal(r.ok, false);
});

test('a CHANGES_REQUIRED verdict is never read as an approval', () => {
  const h = harness({ comments: [ok(approvalBody({ verdict: 'CHANGES_REQUIRED' }))] });
  const r = call(h);
  assert.equal(r.ok, false);
});

test('the head SHA a comment claims is verified as a real commit, not trusted', () => {
  const h = harness({
    comments: [ok(approvalBody())],
    gitFail: [['cat-file']],
  });
  const r = call(h);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /is not a commit in this repository/);
  assert.ok(
    h.rec.git.some((a) => a[0] === 'cat-file' && a[2] === `${APPROVED}^{commit}`),
    'the claimed SHA must be checked against the object database',
  );
});

test('ancestry comes from git exit status, so a non-ancestor approval yields an empty chain', () => {
  const h = harness({
    comments: [ok(approvalBody())],
    gitFail: [['merge-base', '--is-ancestor', APPROVED, HEAD]],
  });
  const r = call(h);
  assert.equal(r.ok, true);
  const { inputs } = r as { inputs: { approvedShaIsAncestor: boolean; firstParentChain: unknown[]; changedPaths: unknown[] } };
  assert.equal(inputs.approvedShaIsAncestor, false);
  assert.deepEqual(inputs.firstParentChain, [], 'a non-ancestor approval must not produce a chain to reason over');
  assert.deepEqual(inputs.changedPaths, []);
});

test('changed paths are a git diff between the two SHAs, never the PR payload', () => {
  const h = harness({
    comments: [ok(approvalBody())],
    changed: 'docs/mission/plan.md\npackage.json\n',
  });
  const r = call(h) as { ok: true; inputs: { changedPaths: string[] } };
  assert.equal(r.ok, true);
  assert.deepEqual(r.inputs.changedPaths, ['docs/mission/plan.md', 'package.json']);
  assert.ok(
    h.rec.git.some((a) => a[0] === 'diff' && a[1] === '--name-only' && a[2] === APPROVED && a[3] === HEAD),
    'the diff must be taken between the approved SHA and the head',
  );
});

test('an absent required check is reported as unresolved, never as green', () => {
  const h = harness({
    comments: [ok(approvalBody())],
    checkRuns: [{ name: 'verify', status: 'completed', conclusion: 'success' }],
  });
  const r = call(h) as { ok: true; inputs: { requiredChecks: { context: string; conclusion: string | null }[] } };
  const byName = Object.fromEntries(r.inputs.requiredChecks.map((c) => [c.context, c.conclusion]));
  assert.equal(byName.verify, 'success');
  assert.equal(byName['Merge Gate'], null, 'a context with no run must be null, not treated as passing');
});

test('an in-progress required check is unresolved even though a conclusion field exists', () => {
  const h = harness({
    comments: [ok(approvalBody())],
    checkRuns: [{ name: 'verify', status: 'in_progress', conclusion: 'success' }],
  });
  const r = call(h) as { ok: true; inputs: { requiredChecks: { context: string; conclusion: string | null }[] } };
  const verify = r.inputs.requiredChecks.find((c) => c.context === 'verify');
  assert.equal(verify?.conclusion, null, 'only a completed run may contribute a conclusion');
});

test('the check-runs query is pinned to the head being evaluated', () => {
  const h = harness({ comments: [ok(approvalBody())] });
  call(h);
  assert.ok(
    h.rec.gh.some((a) => a[a.length - 1].includes(`/commits/${HEAD}/check-runs`)),
    'checks must be read at the exact head, not at the branch tip',
  );
});

test('a changes-requested review after the approval is a withdrawal', () => {
  const h = harness({
    comments: [ok(approvalBody())],
    reviews: [
      {
        state: 'CHANGES_REQUESTED',
        submitted_at: '2026-09-05T11:00:00Z',
        html_url: 'https://example.invalid/r/1',
        user: { login: 'griff843', type: 'User' },
      },
    ],
  });
  const r = call(h) as { ok: true; inputs: { withdrawals: { source: string }[] } };
  assert.equal(r.inputs.withdrawals.length, 1);
  assert.equal(r.inputs.withdrawals[0].source, 'github-review');
});

test('a changes-requested review BEFORE the approval is not a withdrawal', () => {
  const h = harness({
    comments: [ok(approvalBody(), { at: '2026-09-05T12:00:00Z' })],
    reviews: [
      {
        state: 'CHANGES_REQUESTED',
        submitted_at: '2026-09-05T11:00:00Z',
        html_url: 'https://example.invalid/r/1',
        user: { login: 'griff843', type: 'User' },
      },
    ],
  });
  const r = call(h) as { ok: true; inputs: { withdrawals: unknown[] } };
  assert.deepEqual(r.inputs.withdrawals, [], 'the approval already answered anything that preceded it');
});

test('a changes-requested review from outside CODEOWNERS is not a withdrawal', () => {
  const h = harness({
    comments: [ok(approvalBody())],
    reviews: [
      {
        state: 'CHANGES_REQUESTED',
        submitted_at: '2026-09-05T11:00:00Z',
        html_url: 'https://example.invalid/r/1',
        user: { login: 'drive-by', type: 'User' },
      },
    ],
  });
  const r = call(h) as { ok: true; inputs: { withdrawals: unknown[] } };
  assert.deepEqual(r.inputs.withdrawals, []);
});

test('a later CHANGES_REQUIRED verdict from CODEOWNERS is a withdrawal', () => {
  const h = harness({
    comments: [
      ok(approvalBody(), { at: '2026-09-05T10:00:00Z' }),
      ok(approvalBody({ verdict: 'CHANGES_REQUIRED' }), { at: '2026-09-05T13:00:00Z' }),
    ],
  });
  const r = call(h) as { ok: true; inputs: { withdrawals: { source: string }[] } };
  assert.equal(r.inputs.withdrawals.length, 1);
  assert.equal(r.inputs.withdrawals[0].source, 'pm-verdict');
});

test('the most recent approval is the surviving one', () => {
  const h = harness({
    comments: [
      ok(approvalBody({ head: OTHER }), { at: '2026-09-05T09:00:00Z' }),
      ok(approvalBody({ head: APPROVED }), { at: '2026-09-05T10:00:00Z' }),
    ],
  });
  const r = call(h) as { ok: true; inputs: { approvedSha: string } };
  assert.equal(r.inputs.approvedSha, APPROVED, 'an older approval cannot revive a superseded decision');
});

test('a previously posted receipt is never read back as evidence', () => {
  const receipt = [
    'CARRY_FORWARD: VERIFIED',
    'schema: approval-carry-forward/v1',
    'Issue: UTV2-1812',
    'PR: 1503',
    `Head SHA: ${HEAD}`,
  ].join('\n');
  const h = harness({ comments: [ok(receipt)] });
  const r = call(h);
  assert.equal(r.ok, false, 'a receipt must never substitute for the approval it describes');
  assert.match((r as { reason: string }).reason, /no pm-verdict\/v1 APPROVED comment/);
});
