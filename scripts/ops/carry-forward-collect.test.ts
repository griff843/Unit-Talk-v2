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

import { evaluateCarryForward } from './approval-carry-forward.ts';
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

// ---------------------------------------------------------------------------
// Withdrawal semantics (UTV2-1839)
//
// Both of these fail OPEN when got wrong: the collector reports no withdrawal,
// the verifier's C4 passes, and a live objection is carried straight past.
// ---------------------------------------------------------------------------

const APPROVED_AT = '2026-09-05T16:00:00Z';

function withdrawalHarness(over: { comments?: unknown[]; reviews?: unknown[] }) {
  return harness({
    comments: [ok(approvalBody(), { at: APPROVED_AT }), ...(over.comments ?? [])],
    reviews: over.reviews ?? [],
    checkRuns: [
      { name: 'verify', status: 'completed', conclusion: 'success' },
      { name: 'Executor Result Validation', status: 'completed', conclusion: 'success' },
      { name: 'P0 Protocol', status: 'completed', conclusion: 'success' },
    ],
  });
}

test('a comment created before the approval but EDITED after it counts as a withdrawal', () => {
  const { gh, git } = withdrawalHarness({
    comments: [
      {
        body: approvalBody({ verdict: 'CHANGES_REQUIRED' }),
        created_at: '2026-09-05T15:00:00Z',
        updated_at: '2026-09-05T17:00:00Z',
        html_url: 'https://example.invalid/c/edited',
        user: { login: 'griff843', type: 'User' },
      },
    ],
  });
  const result = collect({ prNumber: 1503, issueId: 'UTV2-1812', gh, git });
  assert.equal(result.ok, true);
  const w = (result as { inputs: { withdrawals: { detail: string; createdAt: string }[] } }).inputs.withdrawals;
  assert.equal(w.length, 1);
  assert.match(w[0].detail, /comment edited after the approval; created 2026-09-05T15:00:00Z/);
  // The recorded time must be the edit, not the creation, or C4's
  // "after the approval" comparison silently drops it again.
  assert.equal(w[0].createdAt, '2026-09-05T17:00:00Z');
});

test('a comment created AND edited before the approval is still not a withdrawal', () => {
  const { gh, git } = withdrawalHarness({
    comments: [
      {
        body: approvalBody({ verdict: 'CHANGES_REQUIRED' }),
        created_at: '2026-09-05T14:00:00Z',
        updated_at: '2026-09-05T15:00:00Z',
        html_url: 'https://example.invalid/c/old',
        user: { login: 'griff843', type: 'User' },
      },
    ],
  });
  const result = collect({ prNumber: 1503, issueId: 'UTV2-1812', gh, git });
  assert.deepEqual((result as { inputs: { withdrawals: unknown[] } }).inputs.withdrawals, []);
});

test('a DISMISSED review counts as a withdrawal — dismissal must not erase an objection', () => {
  // GitHub replaces a CHANGES_REQUESTED review's state with DISMISSED when it
  // is dismissed, so filtering on CHANGES_REQUESTED alone lets anyone with
  // write access make a standing objection disappear.
  const { gh, git } = withdrawalHarness({
    reviews: [
      {
        state: 'DISMISSED',
        submitted_at: '2026-09-05T18:00:00Z',
        html_url: 'https://example.invalid/r/1',
        user: { login: 'griff843', type: 'User' },
      },
    ],
  });
  const result = collect({ prNumber: 1503, issueId: 'UTV2-1812', gh, git });
  const w = (result as { inputs: { withdrawals: { detail: string; source: string }[] } }).inputs.withdrawals;
  assert.equal(w.length, 1);
  assert.equal(w[0].source, 'github-review');
  assert.match(w[0].detail, /review dismissed/);
});

test('an APPROVED or COMMENTED review is not a withdrawal', () => {
  const { gh, git } = withdrawalHarness({
    reviews: [
      { state: 'APPROVED', submitted_at: '2026-09-05T18:00:00Z', html_url: 'https://example.invalid/r/2', user: { login: 'griff843', type: 'User' } },
      { state: 'COMMENTED', submitted_at: '2026-09-05T19:00:00Z', html_url: 'https://example.invalid/r/3', user: { login: 'griff843', type: 'User' } },
    ],
  });
  const result = collect({ prNumber: 1503, issueId: 'UTV2-1812', gh, git });
  assert.deepEqual((result as { inputs: { withdrawals: unknown[] } }).inputs.withdrawals, []);
});

test('a DISMISSED review from a login that is not a CODEOWNER is ignored', () => {
  const { gh, git } = withdrawalHarness({
    reviews: [
      { state: 'DISMISSED', submitted_at: '2026-09-05T18:00:00Z', html_url: 'https://example.invalid/r/4', user: { login: 'someone-else', type: 'User' } },
    ],
  });
  const result = collect({ prNumber: 1503, issueId: 'UTV2-1812', gh, git });
  assert.deepEqual((result as { inputs: { withdrawals: unknown[] } }).inputs.withdrawals, []);
  assert.equal(AUTHORIZED_REVIEWERS.has('someone-else'), false);
});

// ---------------------------------------------------------------------------
// Real-git integration (UTV2-1839)
//
// Everything above drives a fake `git`, which proves the collector's trust
// rules but proves nothing about whether the commands it issues mean what the
// conditions assume. These build an actual repository and run the real git
// binary against it, so `diff-tree --cc`, `rev-parse <ref>:<path>`,
// `rev-list --not` and `patch-id --stable` are exercised as themselves.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

interface Repo {
  root: string;
  git: (args: string[]) => string;
  gitWithInput: (args: string[], input: string) => string;
  write: (path: string, body: string) => void;
  commit: (message: string) => string;
  cleanup: () => void;
}

function buildRepo(): Repo {
  const root = mkdtempSync(join(tmpdir(), 'cf-git-'));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  const raw = (cwd: string, args: string[], input?: string): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', input, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });

  raw(root, ['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  raw(root, ['clone', '--quiet', origin, work]);
  for (const [k, v] of [['user.email', 'test@example.invalid'], ['user.name', 'Test'], ['commit.gpgsign', 'false']]) {
    raw(work, ['config', k, v]);
  }

  return {
    root,
    git: (args) => raw(work, args),
    gitWithInput: (args, input) => raw(work, args, input),
    write: (path, body) => {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), body);
    },
    commit: (message) => {
      raw(work, ['add', '-A']);
      raw(work, ['commit', '--quiet', '-m', message]);
      return raw(work, ['rev-parse', 'HEAD']).trim();
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** A `gh` that answers only what `collect` asks, for a given head and approval. */
function ghFor(headSha: string, approvedSha: string) {
  return (args: string[]): string => {
    const url = args[args.length - 1];
    if (url.includes('/pulls/') && url.includes('/reviews')) return '[]';
    if (url.includes('/pulls/')) {
      return JSON.stringify({ head: { sha: headSha }, base: { ref: 'main' }, state: 'open' });
    }
    if (url.includes('/comments')) {
      return JSON.stringify([
        {
          body: approvalBody({ head: approvedSha }),
          created_at: APPROVED_AT,
          html_url: 'https://example.invalid/c/1',
          user: { login: 'griff843', type: 'User' },
        },
      ]);
    }
    if (url.includes('check-runs')) {
      return JSON.stringify({
        check_runs: [
          { name: 'verify', status: 'completed', conclusion: 'success' },
          { name: 'Executor Result Validation', status: 'completed', conclusion: 'success' },
          { name: 'P0 Protocol', status: 'completed', conclusion: 'success' },
        ],
      });
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
}

test('real git: a clean sync from main is admitted, with the anchor and patch-id measured from real objects', () => {
  const repo = buildRepo();
  try {
    repo.write('app.ts', 'export const v = 1;\n');
    repo.write('docs/06_status/lanes/UTV2-1001.json', '{"a":1}\n');
    repo.commit('base');
    repo.git(['push', '--quiet', 'origin', 'main']);

    repo.git(['checkout', '--quiet', '-b', 'feature']);
    repo.write('app.ts', 'export const v = 2;\n');
    const approvedSha = repo.commit('the reviewed work');

    repo.git(['checkout', '--quiet', 'main']);
    repo.write('docs/06_status/lanes/UTV2-1002.json', '{"another":"lane"}\n');
    repo.commit('another lane closes');
    repo.git(['push', '--quiet', 'origin', 'main']);

    repo.git(['checkout', '--quiet', 'feature']);
    repo.git(['merge', '--quiet', '--no-ff', '-m', "Merge remote-tracking branch 'origin/main'", 'main']);
    const headSha = repo.git(['rev-parse', 'HEAD']).trim();

    const out = collect({
      prNumber: 1503,
      issueId: 'UTV2-1812',
      gh: ghFor(headSha, approvedSha),
      git: repo.git,
      gitWithInput: repo.gitWithInput,
    });
    assert.equal(out.ok, true);
    const inputs = (out as { inputs: import('./approval-carry-forward.ts').CarryForwardInputs }).inputs;

    assert.deepEqual(inputs.changedPaths, ['docs/06_status/lanes/UTV2-1002.json']);
    assert.deepEqual(inputs.mergeOwnContent, [{ sha: headSha, paths: [] }]);
    assert.equal(inputs.mainAnchorIsOnMain, true);
    assert.equal(inputs.mainAnchorSha, repo.git(['rev-parse', 'origin/main']).trim());
    // Blob identity is read from real objects, and the incoming path is main's.
    assert.equal(inputs.blobIdentity.length, 1);
    assert.equal(inputs.blobIdentity[0].atHead, inputs.blobIdentity[0].atMain);
    assert.notEqual(inputs.blobIdentity[0].atHead, null);
    // Only the merge itself is off main.
    assert.deepEqual(inputs.commitsNotOnMain, [headSha]);
    // The PR's own contribution to its base is unchanged across the sync.
    assert.equal(inputs.prDiffPatchId.atApproved, inputs.prDiffPatchId.atHead);
    assert.match(String(inputs.prDiffPatchId.atHead), /^[0-9a-f]{40}$/);

    assert.equal(evaluateCarryForward(inputs).verdict, 'VERIFIED');
  } finally {
    repo.cleanup();
  }
});

test('real git: an evil merge on the branch is caught by both C5 and C6', () => {
  const repo = buildRepo();
  try {
    repo.write('app.ts', 'export const v = 1;\n');
    repo.commit('base');
    repo.git(['push', '--quiet', 'origin', 'main']);

    repo.git(['checkout', '--quiet', '-b', 'feature']);
    repo.write('app.ts', 'export const v = 2;\n');
    const approvedSha = repo.commit('the reviewed work');

    repo.git(['checkout', '--quiet', 'main']);
    repo.write('docs/06_status/lanes/UTV2-1002.json', '{"another":"lane"}\n');
    repo.commit('another lane closes');
    repo.git(['push', '--quiet', 'origin', 'main']);

    // The merge itself carries content that is in neither parent. Git records
    // it without complaint, and no two-parent diff shows it.
    repo.git(['checkout', '--quiet', 'feature']);
    repo.git(['merge', '--quiet', '--no-commit', '--no-ff', 'main']);
    repo.write('docs/06_status/lanes/UTV2-1002.json', '{"another":"lane","smuggled":true}\n');
    repo.git(['add', '-A']);
    repo.git(['commit', '--quiet', '-m', "Merge remote-tracking branch 'origin/main'"]);
    const headSha = repo.git(['rev-parse', 'HEAD']).trim();

    const out = collect({
      prNumber: 1503,
      issueId: 'UTV2-1812',
      gh: ghFor(headSha, approvedSha),
      git: repo.git,
      gitWithInput: repo.gitWithInput,
    });
    const inputs = (out as { inputs: import('./approval-carry-forward.ts').CarryForwardInputs }).inputs;

    // Neither parent-to-merge diff reveals it; `--cc` does.
    assert.deepEqual(inputs.mergeOwnContent, [
      { sha: headSha, paths: ['docs/06_status/lanes/UTV2-1002.json'] },
    ]);
    assert.notEqual(inputs.blobIdentity[0].atHead, inputs.blobIdentity[0].atMain);

    const result = evaluateCarryForward(inputs);
    assert.equal(result.verdict, 'REFUSED');
    assert.equal(result.conditions.find((c) => c.id === 'C5')?.status, 'fail');
    assert.equal(result.conditions.find((c) => c.id === 'C6')?.status, 'fail');
    // And the conditions that existed before this lane do not see it at all.
    for (const id of ['C1', 'C2', 'C3', 'C4'] as const) {
      assert.equal(
        result.conditions.find((c) => c.id === id)?.status,
        'pass',
        `${id} unexpectedly caught the evil merge`,
      );
    }
  } finally {
    repo.cleanup();
  }
});

test('real git: a commit smuggled in through a merged side branch is caught by the widened C1', () => {
  const repo = buildRepo();
  try {
    repo.write('app.ts', 'export const v = 1;\n');
    repo.commit('base');
    repo.git(['push', '--quiet', 'origin', 'main']);

    repo.git(['checkout', '--quiet', '-b', 'feature']);
    repo.write('app.ts', 'export const v = 2;\n');
    const approvedSha = repo.commit('the reviewed work');

    // A side branch that never reaches main.
    repo.git(['checkout', '--quiet', '-b', 'side', 'main']);
    repo.write('packages/db/src/sneaky.ts', 'export const owned = true;\n');
    const smuggled = repo.commit('unreviewed change on a side branch');

    repo.git(['checkout', '--quiet', 'feature']);
    repo.git(['merge', '--quiet', '--no-ff', '-m', 'Merge side', 'side']);
    const headSha = repo.git(['rev-parse', 'HEAD']).trim();

    const out = collect({
      prNumber: 1503,
      issueId: 'UTV2-1812',
      gh: ghFor(headSha, approvedSha),
      git: repo.git,
      gitWithInput: repo.gitWithInput,
    });
    const inputs = (out as { inputs: import('./approval-carry-forward.ts').CarryForwardInputs }).inputs;

    assert.ok(inputs.commitsNotOnMain.includes(smuggled), 'the smuggled commit is off main');
    const result = evaluateCarryForward(inputs);
    assert.equal(result.verdict, 'REFUSED');
    assert.equal(result.conditions.find((c) => c.id === 'C1')?.status, 'fail');
  } finally {
    repo.cleanup();
  }
});

test('real git: an octopus merge whose third parent is off main is caught by the widened C1', () => {
  // The premise the widening was written against — "a merge whose second parent
  // is on main can still carry, through THAT parent's ancestry, commits main
  // does not have" — is false for a two-parent merge: if the second parent is
  // an ancestor of main, so is everything reachable from it. What is genuinely
  // reachable, and was genuinely unchecked, is a merge with THREE or more
  // parents: the pre-UTV2-1839 code inspected `parents[1]` and nothing beyond.
  const repo = buildRepo();
  try {
    repo.write('app.ts', 'export const v = 1;\n');
    repo.commit('base');
    repo.git(['push', '--quiet', 'origin', 'main']);

    repo.git(['checkout', '--quiet', '-b', 'feature']);
    repo.write('app.ts', 'export const v = 2;\n');
    const approvedSha = repo.commit('the reviewed work');

    repo.git(['checkout', '--quiet', '-b', 'side', 'main']);
    repo.write('packages/db/src/sneaky.ts', 'export const owned = true;\n');
    const smuggled = repo.commit('unreviewed change on a side branch');

    repo.git(['checkout', '--quiet', 'main']);
    repo.write('docs/06_status/lanes/UTV2-1002.json', '{"a":1}\n');
    repo.commit('another lane closes');
    repo.git(['push', '--quiet', 'origin', 'main']);

    repo.git(['checkout', '--quiet', 'feature']);
    repo.git(['merge', '--quiet', '--no-ff', '-m', 'Merge branches main and side', 'main', 'side']);
    const headSha = repo.git(['rev-parse', 'HEAD']).trim();

    const out = collect({
      prNumber: 1503,
      issueId: 'UTV2-1812',
      gh: ghFor(headSha, approvedSha),
      git: repo.git,
      gitWithInput: repo.gitWithInput,
    });
    const inputs = (out as { inputs: import('./approval-carry-forward.ts').CarryForwardInputs }).inputs;

    // Three parents, and the SECOND one is on main — so the pre-UTV2-1839
    // check would have looked at exactly the innocent one and stopped.
    assert.equal(inputs.firstParentChain.length, 1);
    assert.equal(inputs.firstParentChain[0].parents.length, 3);
    assert.equal(inputs.isAncestorOfMain(inputs.firstParentChain[0].parents[1]), true);
    assert.equal(inputs.firstParentChain[0].parents[2], smuggled);
    assert.equal(inputs.isAncestorOfMain(smuggled), false);

    const result = evaluateCarryForward(inputs);
    assert.equal(result.verdict, 'REFUSED');
    const c1 = result.conditions.find((c) => c.id === 'C1');
    assert.equal(c1?.status, 'fail');
    assert.match(String(c1?.detail), /merged parent\(s\) not on origin\/main/);
    assert.match(String(c1?.detail), new RegExp(smuggled.slice(0, 9)));
  } finally {
    repo.cleanup();
  }
});
