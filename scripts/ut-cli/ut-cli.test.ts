import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runPhaseClose } from './commands/phase-close.js';
import { runPhasePr } from './commands/phase-pr.js';
import { runPhaseStart } from './commands/phase-start.js';
import { runPhaseVerify } from './commands/phase-verify.js';
import { loadMetadata } from './lib/metadata.js';
import { evaluateScope } from './lib/scope.js';
import type { CommandContext, ShellAdapter, ShellResult } from './types.js';

class FakeShell implements ShellAdapter {
  private readonly handlers = new Map<string, ShellResult>();

  register(command: string, args: string[], result: ShellResult): void {
    this.handlers.set(`${command} ${args.join(' ')}`, result);
  }

  run(command: string, args: string[]): ShellResult {
    const key = `${command} ${args.join(' ')}`;
    const result = this.handlers.get(key);
    if (!result) {
      throw new Error(`missing fake shell handler for ${key}`);
    }
    return result;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function createFixtureRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-cli-'));
  writeText(
    path.join(repoRoot, '.ut-issues', 'UTV2-491.yaml'),
    `id: UTV2-491
title: "P7A-01 - add awaiting_approval lifecycle state"
tier: T1
phase: "7a"
upstream_dependencies:
  - UTV2-485
allowed_files:
  - "packages/contracts/src/picks.ts"
  - "supabase/migrations/*_utv2_491_*.sql"
forbidden_files:
  - "apps/api/src/controllers/submit-pick-controller.ts"
expected_collateral:
  - "packages/db/src/database.types.ts"
requires_migration: true
requires_sql_review: true
requires_status_sync: true
pm_review_required: true
rollback_plan: |
  revert it
verification_commands:
  - name: "contracts-test"
    cmd: "pnpm --filter @unit-talk/contracts test"
sql_review_criteria: null
downstream_unlocks:
  - UTV2-492
pre_existing_failures: null
`,
  );
  writeJson(path.join(repoRoot, '.ut-state', 'UTV2-485', 'closed.json'), { closed: true });
  writeJson(path.join(repoRoot, '.ut-state', 'UTV2-491', 'started.json'), {
    timestamp: '2026-04-10T00:00:00.000Z',
    branch: 'feat/utv2-491-p7a-01-add-awaiting-approval-lifecycle-state',
    startingSha: 'abc123',
    metadataHash: 'hash',
  });
  writeText(
    path.join(repoRoot, 'supabase', 'migrations', '202604100003_utv2_491_test.sql'),
    'select 1;\n',
  );
  writeText(path.join(repoRoot, 'packages', 'contracts', 'src', 'picks.ts'), 'export const pick = true;\n');
  writeText(path.join(repoRoot, 'docs', '06_status', 'PROGRAM_STATUS.md'), 'UTV2-491\n');
  return repoRoot;
}

function buildContext(repoRoot: string, shell: ShellAdapter): CommandContext {
  return { cwd: repoRoot, shell };
}

test('metadata validation blocks unknown fields', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-cli-meta-'));
  writeText(
    path.join(repoRoot, '.ut-issues', 'UTV2-999.yaml'),
    `id: UTV2-999
title: "bad"
tier: T1
phase: null
upstream_dependencies: []
allowed_files: []
forbidden_files: []
expected_collateral: []
requires_migration: false
requires_sql_review: false
requires_status_sync: false
pm_review_required: false
rollback_plan: test
verification_commands:
  - name: "x"
    cmd: "echo x"
sql_review_criteria: null
downstream_unlocks: []
unexpected: true
`,
  );
  assert.throws(() => loadMetadata(repoRoot, 'UTV2-999'));
});

test('scope evaluation distinguishes pass, collateral, and forbidden', () => {
  const result = evaluateScope(
    [
      'packages/contracts/src/picks.ts',
      'packages/db/src/database.types.ts',
      'apps/api/src/controllers/submit-pick-controller.ts',
    ],
    [],
    ['packages/contracts/src/picks.ts'],
    ['apps/api/src/controllers/submit-pick-controller.ts'],
    ['packages/db/src/database.types.ts'],
    null,
  );

  assert.deepStrictEqual(result.forbidden, ['apps/api/src/controllers/submit-pick-controller.ts']);
  assert.deepStrictEqual(result.collateral, ['packages/db/src/database.types.ts']);
});

test('phase:verify passes with scoped diff and migration', async () => {
  const repoRoot = createFixtureRepo();
  const shell = new FakeShell();
  shell.register('git', ['branch', '--show-current'], {
    status: 0,
    stdout: 'feat/utv2-491-p7a-01-add-awaiting-approval-lifecycle-state\n',
    stderr: '',
  });
  shell.register('git', ['diff', '--name-only', 'abc123..HEAD'], {
    status: 0,
    stdout: 'packages/contracts/src/picks.ts\nsupabase/migrations/202604100003_utv2_491_test.sql\n',
    stderr: '',
  });
  shell.register('git', ['diff', '--cached', '--name-only'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--name-only'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['ls-files', '--others', '--exclude-standard'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--numstat', 'abc123..HEAD'], {
    status: 0,
    stdout: '1\t0\tpackages/contracts/src/picks.ts\n1\t0\tsupabase/migrations/202604100003_utv2_491_test.sql\n',
    stderr: '',
  });
  shell.register('git', ['config', 'user.email'], {
    status: 0,
    stdout: 'codex@example.com\n',
    stderr: '',
  });
  // Register both Windows and Linux shell variants for cross-platform CI
  shell.register('cmd.exe', ['/d', '/s', '/c', 'pnpm --filter @unit-talk/contracts test'], {
    status: 0,
    stdout: '',
    stderr: '',
  });
  shell.register('sh', ['-c', 'pnpm --filter @unit-talk/contracts test'], {
    status: 0,
    stdout: '',
    stderr: '',
  });

  const code = await runPhaseVerify(buildContext(repoRoot, shell), 'UTV2-491', {
    dryRun: false,
    json: false,
    skipGate: null,
    skipReason: null,
    ackUntracked: null,
  });

  assert.strictEqual(code, 0);
  const verifyFile = fs
    .readdirSync(path.join(repoRoot, '.ut-state', 'UTV2-491'))
    .find((entry) => entry.startsWith('verify-'));
  assert.ok(verifyFile);
});

test('phase:verify blocks forbidden files', async () => {
  const repoRoot = createFixtureRepo();
  const shell = new FakeShell();
  shell.register('git', ['branch', '--show-current'], {
    status: 0,
    stdout: 'feat/utv2-491-p7a-01-add-awaiting-approval-lifecycle-state\n',
    stderr: '',
  });
  shell.register('git', ['diff', '--name-only', 'abc123..HEAD'], {
    status: 0,
    stdout: 'apps/api/src/controllers/submit-pick-controller.ts\nsupabase/migrations/202604100003_utv2_491_test.sql\n',
    stderr: '',
  });
  shell.register('git', ['diff', '--cached', '--name-only'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--name-only'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['ls-files', '--others', '--exclude-standard'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--numstat', 'abc123..HEAD'], {
    status: 0,
    stdout: '1\t0\tapps/api/src/controllers/submit-pick-controller.ts\n',
    stderr: '',
  });

  const code = await runPhaseVerify(buildContext(repoRoot, shell), 'UTV2-491', {
    dryRun: false,
    json: false,
    skipGate: null,
    skipReason: null,
    ackUntracked: null,
  });

  assert.strictEqual(code, 1);
});

test('phase:verify blocks when required migration is missing', async () => {
  const repoRoot = createFixtureRepo();
  const shell = new FakeShell();
  shell.register('git', ['branch', '--show-current'], {
    status: 0,
    stdout: 'feat/utv2-491-p7a-01-add-awaiting-approval-lifecycle-state\n',
    stderr: '',
  });
  shell.register('git', ['diff', '--name-only', 'abc123..HEAD'], {
    status: 0,
    stdout: 'packages/contracts/src/picks.ts\n',
    stderr: '',
  });
  shell.register('git', ['diff', '--cached', '--name-only'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--name-only'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['ls-files', '--others', '--exclude-standard'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--numstat', 'abc123..HEAD'], {
    status: 0,
    stdout: '1\t0\tpackages/contracts/src/picks.ts\n',
    stderr: '',
  });

  const code = await runPhaseVerify(buildContext(repoRoot, shell), 'UTV2-491', {
    dryRun: false,
    json: false,
    skipGate: null,
    skipReason: null,
    ackUntracked: null,
  });

  assert.strictEqual(code, 1);
});

test('phase:pr blocks when sql-review hash mismatches', async () => {
  const repoRoot = createFixtureRepo();
  writeJson(path.join(repoRoot, '.ut-state', 'UTV2-491', 'verify-20260410T120000.json'), {
    timestamp: '2026-04-10T12:00:00.000Z',
    verifier: 'codex@example.com',
    verdict: 'pass',
    branch: 'feat/utv2-491-p7a-01-add-awaiting-approval-lifecycle-state',
    startingSha: 'abc123',
    diffSummary: { files: [], stats: [], acknowledgedUntracked: [], warnings: [] },
    migrations: {
      detected: true,
      paths: [{ path: 'supabase/migrations/202604100003_utv2_491_test.sql', sha256: 'verify-hash' }],
    },
    gateResults: [],
    skippedGates: [],
  });
  writeJson(path.join(repoRoot, '.ut-state', 'UTV2-491', 'sql-review.json'), {
    timestamp: '2026-04-10T12:05:00.000Z',
    reviewer: 'chatgpt',
    reviewedAgainst: null,
    migrations: [{ path: 'supabase/migrations/202604100003_utv2_491_test.sql', sha256: 'review-hash' }],
  });

  const shell = new FakeShell();
  shell.register('git', ['branch', '--show-current'], {
    status: 0,
    stdout: 'feat/utv2-491-p7a-01-add-awaiting-approval-lifecycle-state\n',
    stderr: '',
  });
  shell.register('git', ['diff', '--name-only', 'abc123..HEAD'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--cached', '--name-only'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--name-only'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['ls-files', '--others', '--exclude-standard'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--numstat', 'abc123..HEAD'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['log', '--format=%H%x1f%s%x1f%b%x1e', 'abc123..HEAD'], {
    status: 0,
    stdout: 'def456\x1ffeat(utv2-491): test\x1f\x1e',
    stderr: '',
  });

  const code = await runPhasePr(buildContext(repoRoot, shell), 'UTV2-491', {
    dryRun: true,
    title: null,
    bodyFrom: null,
    draft: false,
    json: false,
  });

  assert.strictEqual(code, 1);
});

test('phase:pr blocks when commit subject format is invalid', async () => {
  const repoRoot = createFixtureRepo();
  writeJson(path.join(repoRoot, '.ut-state', 'UTV2-491', 'verify-20260410T120000.json'), {
    timestamp: '2026-04-10T12:00:00.000Z',
    verifier: 'codex@example.com',
    verdict: 'pass',
    branch: 'feat/utv2-491-p7a-01-add-awaiting-approval-lifecycle-state',
    startingSha: 'abc123',
    diffSummary: { files: [], stats: [], acknowledgedUntracked: [], warnings: [] },
    migrations: {
      detected: true,
      paths: [{ path: 'supabase/migrations/202604100003_utv2_491_test.sql', sha256: 'verify-hash' }],
    },
    gateResults: [],
    skippedGates: [],
  });
  writeJson(path.join(repoRoot, '.ut-state', 'UTV2-491', 'sql-review.json'), {
    timestamp: '2026-04-10T12:05:00.000Z',
    reviewer: 'chatgpt',
    reviewedAgainst: null,
    migrations: [{ path: 'supabase/migrations/202604100003_utv2_491_test.sql', sha256: 'verify-hash' }],
  });

  const shell = new FakeShell();
  shell.register('git', ['branch', '--show-current'], {
    status: 0,
    stdout: 'feat/utv2-491-p7a-01-add-awaiting-approval-lifecycle-state\n',
    stderr: '',
  });
  shell.register('git', ['diff', '--name-only', 'abc123..HEAD'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--cached', '--name-only'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--name-only'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['ls-files', '--others', '--exclude-standard'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['diff', '--numstat', 'abc123..HEAD'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['log', '--format=%H%x1f%s%x1f%b%x1e', 'abc123..HEAD'], {
    status: 0,
    stdout: 'def456\x1fbad subject\x1f\x1e',
    stderr: '',
  });

  const code = await runPhasePr(buildContext(repoRoot, shell), 'UTV2-491', {
    dryRun: true,
    title: null,
    bodyFrom: null,
    draft: false,
    json: false,
  });

  assert.strictEqual(code, 1);
});

test('phase:close blocks when live-apply marker is missing', async () => {
  const repoRoot = createFixtureRepo();
  writeJson(path.join(repoRoot, '.ut-state', 'UTV2-491', 'verify-20260410T120000.json'), {
    timestamp: '2026-04-10T12:00:00.000Z',
    verifier: 'codex@example.com',
    verdict: 'pass',
    branch: 'feat/utv2-491-p7a-01-add-awaiting-approval-lifecycle-state',
    startingSha: 'abc123',
    diffSummary: { files: [], stats: [], acknowledgedUntracked: [], warnings: [] },
    migrations: {
      detected: true,
      paths: [{ path: 'supabase/migrations/202604100003_utv2_491_test.sql', sha256: 'verify-hash' }],
    },
    gateResults: [],
    skippedGates: [],
  });
  writeJson(path.join(repoRoot, '.ut-state', 'UTV2-491', 'sql-review.json'), {
    timestamp: '2026-04-10T12:05:00.000Z',
    reviewer: 'chatgpt',
    reviewedAgainst: null,
    migrations: [{ path: 'supabase/migrations/202604100003_utv2_491_test.sql', sha256: 'verify-hash' }],
  });
  writeJson(path.join(repoRoot, '.ut-state', 'UTV2-491', 'pr.json'), {
    timestamp: '2026-04-10T12:10:00.000Z',
    number: 217,
    url: 'https://example.test/pull/217',
    branch: 'feat/utv2-491-p7a-01-add-awaiting-approval-lifecycle-state',
  });

  const shell = new FakeShell();
  shell.register('gh', ['pr', 'view', '217', '--json', 'state,mergeCommit'], {
    status: 0,
    stdout: JSON.stringify({ state: 'MERGED', mergeCommit: { oid: 'deadbeef' } }),
    stderr: '',
  });

  const code = await runPhaseClose(buildContext(repoRoot, shell), 'UTV2-491', {
    dryRun: false,
    recordLiveApply: false,
    appliedBy: null,
    proofQueryResult: null,
    json: false,
  });

  assert.strictEqual(code, 1);
});

test('phase:start returns tool error when fetch fails', async () => {
  const repoRoot = createFixtureRepo();
  fs.rmSync(path.join(repoRoot, '.ut-state', 'UTV2-491', 'started.json'));
  const shell = new FakeShell();
  shell.register('git', ['branch', '--show-current'], { status: 0, stdout: 'main\n', stderr: '' });
  shell.register('git', ['status', '--porcelain'], { status: 0, stdout: '', stderr: '' });
  shell.register('git', ['fetch', 'origin'], { status: 1, stdout: '', stderr: 'fetch failed' });

  const code = await runPhaseStart(buildContext(repoRoot, shell), 'UTV2-491', {
    dryRun: true,
    resume: false,
    json: false,
  });

  assert.strictEqual(code, 2);
});
