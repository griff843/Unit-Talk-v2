import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  type LaneManifest,
  ROOT,
  issueToManifestPath,
  preflightTokenPathForBranch,
} from './shared.js';
import { recoverMissingPreflightToken } from './lane-link-pr.js';
import {
  buildLaneFinalizePlan,
  resolveLaneFinalizeInput,
  runLaneFinalizePlan,
  type LaneFinalizeRunner,
} from './lane-finalize.js';

function runLaneLinkPr(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      'scripts/ops/lane-link-pr.ts',
      ...args,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env,
    },
  );
}

function withManifest(
  issueId: string,
  status:
    | 'started'
    | 'in_progress'
    | 'in_review'
    | 'merged'
    | 'done'
    | 'blocked'
    | 'reopened',
  laneType: 'codex-cli' | 'claude' | 'codex-cloud' = 'codex-cli',
  mutate?: (manifest: Record<string, unknown>) => void,
): string {
  const preflightToken = `.out/ops/preflight/${issueId.toLowerCase()}-token.json`;
  const preflightTokenPath = path.join(ROOT, preflightToken);
  fs.mkdirSync(path.dirname(preflightTokenPath), { recursive: true });
  fs.writeFileSync(preflightTokenPath, '{}\n', 'utf8');

  const manifest = {
    schema_version: 1,
    issue_id: issueId,
    lane_type: laneType,
    tier: 'T2',
    worktree_path: path.join(
      ROOT,
      '.out',
      'worktrees',
      `codex__${issueId.toLowerCase()}-receive`,
    ),
    branch: `codex/${issueId.toLowerCase()}-receive`,
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/codex-receive.ts'],
    expected_proof_paths: ['docs/06_status/proof/placeholder.md'],
    status,
    started_at: '2026-04-11T00:00:00.000Z',
    heartbeat_at: '2026-04-11T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: preflightToken,
    created_by: laneType === 'claude' ? 'claude' : 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
  };
  if (mutate) {
    mutate(manifest);
  }
  const filePath = issueToManifestPath(issueId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return filePath;
}

function cleanup(issueId: string): void {
  fs.rmSync(issueToManifestPath(issueId), { force: true });
  fs.rmSync(
    path.join(
      ROOT,
      '.out',
      'ops',
      'preflight',
      `${issueId.toLowerCase()}-token.json`,
    ),
    {
      force: true,
    },
  );
}

function recoveryManifest(issueId: string): LaneManifest {
  const branch = `codex/${issueId.toLowerCase()}-recovery`;
  return {
    schema_version: 1,
    issue_id: issueId,
    lane_type: 'governance',
    executor: 'codex-cli',
    tier: 'T1',
    worktree_path: ROOT,
    branch,
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/lane-link-pr.ts'],
    expected_proof_paths: [],
    status: 'started',
    started_at: '2026-08-08T00:00:00.000Z',
    heartbeat_at: '2026-08-08T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: `.out/ops/preflight/${branch}.json`,
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
  };
}

test('missing-token recovery re-proves ownership, PR binding, dependencies, and scope', () => {
  const manifest = recoveryManifest('UTV2-99110');
  const tokenPath = preflightTokenPathForBranch(manifest.branch);
  fs.rmSync(tokenPath, { force: true });
  let writtenToken: Record<string, unknown> | undefined;
  try {
    recoverMissingPreflightToken(
      manifest,
      manifest.branch,
      'https://github.com/example/unit-talk/pull/130',
      {
        cwd: ROOT,
        currentBranch: () => manifest.branch,
        currentHead: () => 'a'.repeat(40),
        isClean: () => true,
        dependenciesReady: () => true,
        readPullRequest: () => ({
          url: 'https://github.com/example/unit-talk/pull/130',
          headRefName: manifest.branch,
          headRefOid: 'a'.repeat(40),
          baseRefName: 'main',
          state: 'OPEN',
        }),
        activeManifests: () => [manifest],
        now: () => new Date('2026-08-08T12:00:00.000Z'),
        randomUUID: () => 'recovery-run-id',
        writeToken: (_path, token) => {
          writtenToken = token as unknown as Record<string, unknown>;
        },
      },
    );
    assert.strictEqual(writtenToken?.['head_sha'], 'a'.repeat(40));
    assert.strictEqual(writtenToken?.['status'], 'pass');
    assert.strictEqual(writtenToken?.['preflight_run_id'], 'recovery-run-id');
  } finally {
    fs.rmSync(tokenPath, { force: true });
  }
});

test('missing-token recovery fails closed when only the PR head ref differs', () => {
  const manifest = recoveryManifest('UTV2-99117');
  const tokenPath = preflightTokenPathForBranch(manifest.branch);
  fs.rmSync(tokenPath, { force: true });
  let tokenWritten = false;
  try {
    assert.throws(
      () =>
        recoverMissingPreflightToken(
          manifest,
          manifest.branch,
          'https://github.com/example/unit-talk/pull/136',
          {
            cwd: ROOT,
            currentBranch: () => manifest.branch,
            currentHead: () => 'a'.repeat(40),
            isClean: () => true,
            dependenciesReady: () => true,
            readPullRequest: () => ({
              url: 'https://github.com/example/unit-talk/pull/136',
              headRefName: 'codex/utv2-99117-other-ref',
              headRefOid: 'a'.repeat(40),
              baseRefName: 'main',
              state: 'OPEN',
            }),
            activeManifests: () => [manifest],
            writeToken: () => {
              tokenWritten = true;
            },
          },
        ),
      /does not match the open lane branch, base, and current HEAD/,
    );
    assert.equal(tokenWritten, false);
  } finally {
    fs.rmSync(tokenPath, { force: true });
  }
});

test('missing-token recovery fails closed on a foreign active scope collision', () => {
  const manifest = recoveryManifest('UTV2-99111');
  const foreign = {
    ...recoveryManifest('UTV2-99112'),
    file_scope_lock: [...manifest.file_scope_lock],
  };
  assert.throws(
    () =>
      recoverMissingPreflightToken(
        manifest,
        manifest.branch,
        'https://github.com/example/unit-talk/pull/131',
        {
          cwd: ROOT,
          currentBranch: () => manifest.branch,
          currentHead: () => 'b'.repeat(40),
          isClean: () => true,
          dependenciesReady: () => true,
          readPullRequest: () => ({
            url: 'https://github.com/example/unit-talk/pull/131',
            headRefName: manifest.branch,
            headRefOid: 'b'.repeat(40),
            baseRefName: 'main',
            state: 'OPEN',
          }),
          activeManifests: () => [manifest, foreign],
          writeToken: () => assert.fail('token must not be written'),
        },
      ),
    /scope overlaps active UTV2-99112/,
  );
});

test('lane-link-pr transitions a codex-cli lane to in_review', () => {
  const issueId = 'UTV2-99101';
  try {
    withManifest(issueId, 'started');
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      `codex/${issueId.toLowerCase()}-receive`,
      '--pr',
      'https://github.com/example/unit-talk/pull/123',
    ]);
    assert.strictEqual(result.status, 0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      code: string;
      status: string;
      pr_url: string;
    };
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.code, 'lane_linked');
    assert.strictEqual(payload.status, 'in_review');
    assert.strictEqual(
      payload.pr_url,
      'https://github.com/example/unit-talk/pull/123',
    );
  } finally {
    cleanup(issueId);
  }
});

test('lane-link-pr fails branch_mismatch from manifest truth', () => {
  const issueId = 'UTV2-99102';
  try {
    withManifest(issueId, 'started');
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      'codex/utv2-99102-other',
      '--pr',
      'https://github.com/example/unit-talk/pull/124',
    ]);
    assert.strictEqual(result.status, 1);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'branch_mismatch');
  } finally {
    cleanup(issueId);
  }
});

test('lane-link-pr is idempotent when already in_review with the same PR URL', () => {
  const issueId = 'UTV2-99103';
  try {
    withManifest(issueId, 'in_review', 'codex-cli', (manifest) => {
      manifest.pr_url = 'https://github.com/example/unit-talk/pull/125';
    });
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      `codex/${issueId.toLowerCase()}-receive`,
      '--pr',
      'https://github.com/example/unit-talk/pull/125',
    ]);
    assert.strictEqual(result.status, 0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      code: string;
      status: string;
      pr_url: string;
    };
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.code, 'lane_link_pr_noop');
    assert.strictEqual(payload.status, 'in_review');
    assert.strictEqual(
      payload.pr_url,
      'https://github.com/example/unit-talk/pull/125',
    );
  } finally {
    cleanup(issueId);
  }
});

test('lane-link-pr rejects conflicting PR URL for already in_review lanes', () => {
  const issueId = 'UTV2-99107';
  try {
    withManifest(issueId, 'in_review', 'codex-cli', (manifest) => {
      manifest.pr_url = 'https://github.com/example/unit-talk/pull/125';
    });
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      `codex/${issueId.toLowerCase()}-receive`,
      '--pr',
      'https://github.com/example/unit-talk/pull/999',
    ]);
    assert.strictEqual(result.status, 1);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'pr_url_mismatch');
  } finally {
    cleanup(issueId);
  }
});

test('lane-link-pr is a no-op for merged or done lanes when PR URL matches manifest truth', () => {
  for (const [issueId, status] of [
    ['UTV2-99108', 'merged'],
    ['UTV2-99109', 'done'],
  ] as const) {
    try {
      withManifest(issueId, status, 'codex-cli', (manifest) => {
        manifest.pr_url = 'https://github.com/example/unit-talk/pull/128';
      });
      const result = runLaneLinkPr([
        issueId,
        '--branch',
        `codex/${issueId.toLowerCase()}-receive`,
        '--pr',
        'https://github.com/example/unit-talk/pull/128',
      ]);
      assert.strictEqual(result.status, 0);
      const payload = JSON.parse(result.stdout) as {
        ok: boolean;
        code: string;
        status: string;
      };
      assert.strictEqual(payload.ok, true);
      assert.strictEqual(payload.code, 'lane_link_pr_noop');
      assert.strictEqual(payload.status, status);
    } finally {
      cleanup(issueId);
    }
  }
});

test('lane-link-pr rejects non-transitionable blocked status', () => {
  const issueId = 'UTV2-99104';
  try {
    withManifest(issueId, 'blocked');
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      `codex/${issueId.toLowerCase()}-receive`,
      '--pr',
      'https://github.com/example/unit-talk/pull/126',
    ]);
    assert.strictEqual(result.status, 1);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'status_not_transitionable');
  } finally {
    cleanup(issueId);
  }
});

test('lane-link-pr rejects invalid pr urls', () => {
  const issueId = 'UTV2-99105';
  try {
    withManifest(issueId, 'started');
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      `codex/${issueId.toLowerCase()}-receive`,
      '--pr',
      'not-a-pr-url',
    ]);
    assert.strictEqual(result.status, 1);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'pr_url_invalid');
  } finally {
    cleanup(issueId);
  }
});

test('lane-link-pr binds a Claude lane and resolves its issue from the branch name', () => {
  const issueId = 'UTV2-99106';
  try {
    withManifest(issueId, 'started', 'claude', (manifest) => {
      manifest['branch'] = `claude/${issueId.toLowerCase()}-receive`;
    });
    const result = runLaneLinkPr([
      '--branch',
      `claude/${issueId.toLowerCase()}-receive`,
      '--pr',
      'https://github.com/example/unit-talk/pull/127',
    ]);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      code: string;
      status: string;
      pr_url: string;
    };
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.code, 'lane_linked');
    assert.strictEqual(payload.status, 'in_review');
    assert.strictEqual(
      payload.pr_url,
      'https://github.com/example/unit-talk/pull/127',
    );
  } finally {
    cleanup(issueId);
  }
});

test('PR binding feeds merge closeout without manual metadata repair', () => {
  const issueId = 'UTV2-99113';
  try {
    const manifestPath = withManifest(
      issueId,
      'started',
      'claude',
      (manifest) => {
        manifest['branch'] = `claude/${issueId.toLowerCase()}-lifecycle`;
      },
    );
    const link = runLaneLinkPr([
      '--branch',
      `claude/${issueId.toLowerCase()}-lifecycle`,
      '--pr',
      'https://github.com/example/unit-talk/pull/132',
    ]);
    assert.strictEqual(link.status, 0, link.stderr || link.stdout);

    const linkedManifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8'),
    ) as LaneManifest;
    const resolved = resolveLaneFinalizeInput({ manifest: linkedManifest });
    assert.deepStrictEqual(resolved, { issueId, pr: '132' });

    const result = runLaneFinalizePlan(
      buildLaneFinalizePlan({ manifest: linkedManifest, pr: resolved.pr }),
      {
        runner: (() => ({
          status: 0,
          stdout: '',
          stderr: '',
        })) as LaneFinalizeRunner,
      },
    );
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(
      result.steps.map((step) => step.id),
      [
        'record_merge',
        'apply_tier_label',
        'apply_linear_tier_label',
        'generate_proof',
        'reconcile_current',
        'close_lane',
      ],
    );
    assert.strictEqual(
      result.steps.every((step) => step.status === 'passed'),
      true,
    );
  } finally {
    cleanup(issueId);
  }
});

test('GitHub pull_request binding does not depend on an ephemeral preflight token', () => {
  const issueId = 'UTV2-99114';
  try {
    withManifest(issueId, 'started', 'claude', (manifest) => {
      manifest['branch'] = `claude/${issueId.toLowerCase()}-event-binding`;
    });
    fs.rmSync(
      path.join(
        ROOT,
        '.out',
        'ops',
        'preflight',
        `${issueId.toLowerCase()}-token.json`,
      ),
      {
        force: true,
      },
    );

    const result = runLaneLinkPr(
      [
        '--branch',
        `claude/${issueId.toLowerCase()}-event-binding`,
        '--base',
        'main',
        '--pr',
        'https://github.com/example/unit-talk/pull/133',
        '--github-event',
      ],
      {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'pull_request_target',
      },
    );
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      code: string;
      preflight_recovered: boolean;
    };
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.code, 'lane_linked');
    assert.strictEqual(payload.preflight_recovered, false);
  } finally {
    cleanup(issueId);
  }
});

test('GitHub event binding fails closed when the PR base differs from manifest truth', () => {
  const issueId = 'UTV2-99115';
  try {
    withManifest(issueId, 'started', 'codex-cli');
    const result = runLaneLinkPr(
      [
        '--branch',
        `codex/${issueId.toLowerCase()}-receive`,
        '--base',
        'release-candidate',
        '--pr',
        'https://github.com/example/unit-talk/pull/134',
        '--github-event',
      ],
      {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'pull_request_target',
      },
    );
    assert.strictEqual(result.status, 1);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'base_branch_mismatch');
  } finally {
    cleanup(issueId);
  }
});

test('GitHub event binding requires an explicit PR base', () => {
  const issueId = 'UTV2-99116';
  try {
    withManifest(issueId, 'started', 'codex-cli');
    const result = runLaneLinkPr(
      [
        '--branch',
        `codex/${issueId.toLowerCase()}-receive`,
        '--pr',
        'https://github.com/example/unit-talk/pull/135',
        '--github-event',
      ],
      {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'pull_request_target',
      },
    );
    assert.strictEqual(result.status, 1);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'base_branch_required');
  } finally {
    cleanup(issueId);
  }
});

test('pull request workflow binds and revalidates lane PRs automatically', () => {
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'lane-pr-binding.yml'),
    'utf8',
  );
  assert.match(
    workflow,
    /pull_request_target:\s*\n\s*types:\s*\[opened, reopened, edited\]/,
  );
  assert.match(workflow, /id: lane/);
  assert.match(
    workflow,
    /BRANCH: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/,
  );
  assert.match(
    workflow,
    /PR_URL: \$\{\{ github\.event\.pull_request\.html_url \}\}/,
  );
  assert.match(
    workflow,
    /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/,
  );
  assert.doesNotMatch(
    workflow,
    /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/,
  );
  assert.match(workflow, /working-directory: lane/);
  assert.match(workflow, /--base "\$BASE_BRANCH"/);
  assert.match(workflow, /--ignore-scripts/);
  assert.match(workflow, /for attempt in 1 2 3/);
  assert.match(workflow, /git rebase "origin\/\$BRANCH"/);
  assert.doesNotMatch(workflow, /working-directory: lane[\s\S]*?pnpm install/);
});
