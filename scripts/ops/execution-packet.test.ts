import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {
  assertExecutionPacketCwd,
  buildSyncYmlWithTaskContract,
  buildTaskContract,
  generateExecutionPacket as generateExecutionPacketRaw,
  generateExecutionPacketResult,
  readTaskContract,
  renderTaskContract,
} from './execution-packet.js';
import { type LaneManifest } from './shared.js';

function createTestManifest(
  overrides: Partial<LaneManifest> = {},
): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-969',
    lane_type: 'runtime',
    executor: 'claude',
    tier: 'T2',
    worktree_path: 'C:/Dev/Unit-Talk-v2-main',
    branch: 'codex/utv2-969-generate-standardized-execution-packets',
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/execution-packet.ts'],
    expected_proof_paths: ['docs/06_status/proof/UTV2-969/diff-summary.md'],
    status: 'started',
    started_at: '2026-05-15T12:00:00.000Z',
    heartbeat_at: '2026-05-15T12:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token:
      '.out/ops/preflight/codex/utv2-969-generate-standardized-execution-packets.json',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

function testTaskContract(issueId = 'UTV2-969') {
  return buildTaskContract(
    {
      identifier: issueId,
      title: 'Deliver executor work orders',
      url: `https://linear.app/unit-talk-v2/issue/${issueId}`,
      description: [
        '## Objective',
        'Give every executor the authoritative task.',
        '',
        '## Acceptance criteria',
        '1. Prompt contains the task contract.',
        '2. Missing contracts fail before spawn.',
        '',
        '## Guardrails',
        '- Do not infer work from the branch name.',
        '',
        '## Explicitly out of scope — follow-ups',
        '- Bulk migration of old sync records.',
        '',
        '## Required evidence',
        'Focused tests pass.',
        '',
        '## Exit criteria',
        '1. Both executors consume one shared renderer.',
      ].join('\n'),
    },
    '2000-01-01T00:00:00.000Z',
  );
}

function generateExecutionPacket(
  manifest: LaneManifest,
  env: NodeJS.ProcessEnv = process.env,
) {
  return generateExecutionPacketRaw(manifest, env, testTaskContract(manifest.issue_id));
}

test('task contract captures and renders every required work-order field', () => {
  const contract = testTaskContract();
  const rendered = renderTaskContract(contract);

  assert.equal(contract.objective, 'Give every executor the authoritative task.');
  assert.deepEqual(contract.acceptance_criteria, [
    'Prompt contains the task contract.',
    'Missing contracts fail before spawn.',
  ]);
  assert.deepEqual(contract.guardrails, ['Do not infer work from the branch name.']);
  assert.deepEqual(contract.non_goals, ['Bulk migration of old sync records.']);
  assert.deepEqual(contract.required_evidence, ['Focused tests pass.']);
  assert.deepEqual(contract.exit_criteria, ['Both executors consume one shared renderer.']);
  for (const expected of [
    'Give every executor the authoritative task.',
    'Prompt contains the task contract.',
    'Do not infer work from the branch name.',
    'Bulk migration of old sync records.',
    'Focused tests pass.',
    'Both executors consume one shared renderer.',
  ]) {
    assert.match(rendered, new RegExp(expected.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  }
  assert.match(contract.contract_hash, /^[0-9a-f]{64}$/u);
});

test('legacy issue descriptions remain dispatchable without a bulk migration', () => {
  const description = '## Scope\n- Preserve this complete legacy work order.\n\nNo modern acceptance heading exists.';
  const contract = buildTaskContract({
    identifier: 'UTV2-1667',
    title: 'Legacy lane objective',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-1667',
    description,
  }, '2000-01-01T00:00:00.000Z');

  assert.equal(contract.objective, 'Legacy lane objective');
  assert.deepEqual(contract.acceptance_criteria, [description]);
});

test('a present but empty acceptance section fails closed instead of using the legacy fallback', () => {
  assert.throws(
    () => buildTaskContract({
      identifier: 'UTV2-1668',
      title: 'Malformed modern issue',
      url: 'https://linear.app/unit-talk-v2/issue/UTV2-1668',
      description: 'Background text.\n\n## Acceptance criteria\n\n## Guardrails\n- Keep scope narrow.',
    }),
    /missing acceptance criteria/u,
  );
});

test('sync record preserves existing entities and rejects contract tampering', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-contract-'));
  const syncDir = path.join(root, '.ops', 'sync');
  fs.mkdirSync(syncDir, { recursive: true });
  const contract = testTaskContract();
  const existing = [
    'version: 1',
    'entities:',
    '  issues:',
    '    - UTV2-969',
    '  findings:',
    '    - F-1',
    '',
  ].join('\n');
  const syncPath = path.join(syncDir, 'UTV2-969.yml');
  const content = buildSyncYmlWithTaskContract('UTV2-969', contract, existing);
  fs.writeFileSync(syncPath, content, 'utf8');

  assert.match(content, /F-1/u);
  assert.deepEqual(readTaskContract('UTV2-969', root), contract);
  fs.writeFileSync(syncPath, content.replace('authoritative task', 'different task'), 'utf8');
  assert.throws(() => readTaskContract('UTV2-969', root), /hash verification failed/u);
});

test('missing and invalid contracts return parseable structured executor failures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-contract-failure-'));
  const manifest = createTestManifest();
  const missing = generateExecutionPacketResult(manifest, {}, undefined, root);
  assert.deepEqual(JSON.parse(JSON.stringify(missing)), missing);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.code, 'EXECUTION_PACKET_INVALID');
    assert.match(missing.message, /task contract is absent/u);
  }

  const syncDir = path.join(root, '.ops', 'sync');
  fs.mkdirSync(syncDir, { recursive: true });
  fs.writeFileSync(
    path.join(syncDir, 'UTV2-969.yml'),
    'version: 1\ntask_contract:\n  schema_version: 1\n  issue_id: UTV2-969\n',
    'utf8',
  );
  const invalid = generateExecutionPacketResult(manifest, {}, undefined, root);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.message, /missing an objective/u);
});

test('generateExecutionPacket is deterministic in test mode', () => {
  process.env.UNIT_TALK_TEST_MODE = '1';
  const manifest = createTestManifest();

  const first = JSON.stringify(generateExecutionPacket(manifest));
  const second = JSON.stringify(generateExecutionPacket(manifest));

  assert.strictEqual(first, second);
  delete process.env.UNIT_TALK_TEST_MODE;
});

test('allowed_file_scope matches manifest.file_scope_lock', () => {
  const manifest = createTestManifest({
    file_scope_lock: [
      'scripts/ops/execution-packet.ts',
      'scripts/ops/execution-packet.test.ts',
    ],
  });

  const packet = generateExecutionPacket(manifest);
  assert.deepStrictEqual(packet.allowed_file_scope, manifest.file_scope_lock);
});

test('tier_c_warnings flags packages/domain paths', () => {
  const packet = generateExecutionPacket(
    createTestManifest({
      file_scope_lock: ['packages/domain/src/pick.ts'],
    }),
  );

  assert.match(packet.tier_c_warnings[0] ?? '', /packages\/domain\//);
});

test('tier_c_warnings flags supabase migration files', () => {
  const packet = generateExecutionPacket(
    createTestManifest({
      file_scope_lock: ['supabase/migrations/001_init.sql'],
    }),
  );

  assert.match(packet.tier_c_warnings[0] ?? '', /migration/i);
});

test('tier_c_warnings flags worker and proof-coverage self-amendment paths', () => {
  const packet = generateExecutionPacket(
    createTestManifest({
      file_scope_lock: [
        'apps/worker/src/worker-runtime.ts',
        '.github/workflows/proof-coverage-guard.yml',
      ],
    }),
  );

  assert.equal(packet.tier_c_warnings.length, 2);
  assert.match(packet.tier_c_warnings[0] ?? '', /apps\/worker\//);
  assert.match(packet.tier_c_warnings[1] ?? '', /self-amendment/);
});

test('tier_c_warnings is empty when no Tier C paths are present', () => {
  const packet = generateExecutionPacket(
    createTestManifest({
      file_scope_lock: ['scripts/ops/execution-packet.ts'],
    }),
  );

  assert.deepStrictEqual(packet.tier_c_warnings, []);
});

test('T1 proof artifacts include runtime-proof and evidence-bundle', () => {
  const packet = generateExecutionPacket(
    createTestManifest({
      tier: 'T1',
    }),
  );

  assert.ok(packet.required_verification.includes('runtime-proof'));
  assert.ok(packet.required_verification.includes('evidence-bundle'));
});

test('T2 proof artifacts include issue-specific verification but not evidence-bundle', () => {
  const packet = generateExecutionPacket(createTestManifest({ tier: 'T2' }));

  assert.ok(
    packet.required_verification.includes('issue-specific verification'),
  );
  assert.ok(!packet.required_verification.includes('evidence-bundle'));
});

test('T3 proof artifacts omit runtime-proof', () => {
  const packet = generateExecutionPacket(createTestManifest({ tier: 'T3' }));

  assert.ok(!packet.required_verification.includes('runtime-proof'));
});

test('execution_location maps codex-cli executor', () => {
  const packet = generateExecutionPacket(
    createTestManifest({
      executor: 'codex-cli',
    }),
  );

  assert.strictEqual(packet.execution_location, 'Codex CLI (autonomous)');
});

test('packet includes exact cwd from manifest execution location', () => {
  const packet = generateExecutionPacket(
    createTestManifest({
      execution_location: {
        mode: 'worktree',
        cwd: 'C:/Dev/Unit-Talk-v2-main/.out/worktrees/codex__utv2-969-lane',
        package_install: 'not_required',
        setup_command: null,
        main_checkout_control_only: true,
      },
    }),
  );

  assert.strictEqual(
    packet.cwd,
    'C:/Dev/Unit-Talk-v2-main/.out/worktrees/codex__utv2-969-lane',
  );
  assert.match(packet.cwd_guard_command, /cd "/);
  assert.match(packet.worktree_entrypoint, /pnpm install --frozen-lockfile/);
  assert.equal(packet.dependency_setup.package_install, 'not_required');
  assert.equal(packet.dependency_setup.main_checkout_control_only, true);
});

test('packet cwd guard rejects execution from wrong cwd', () => {
  const packet = generateExecutionPacket(
    createTestManifest({
      execution_location: {
        mode: 'worktree',
        cwd: 'C:/Dev/Unit-Talk-v2-main/.out/worktrees/codex__utv2-969-lane',
        package_install: 'not_required',
        setup_command: null,
        main_checkout_control_only: true,
      },
    }),
  );

  assert.throws(
    () => assertExecutionPacketCwd(packet, 'C:/Dev/Unit-Talk-v2-main'),
    /wrong cwd/,
  );
});

test('repo_brief is present and returns test stub in test mode', () => {
  process.env.UNIT_TALK_TEST_MODE = '1';
  const packet = generateExecutionPacket(createTestManifest());
  assert.strictEqual(packet.repo_brief, '[test-brief-stub]');
  delete process.env.UNIT_TALK_TEST_MODE;
});

test('missing expected_proof_paths does not prevent packet generation', () => {
  const packet = generateExecutionPacket(
    createTestManifest({
      expected_proof_paths: undefined as unknown as string[],
    }),
  );

  assert.deepStrictEqual(packet.expected_proof_paths, []);
  assert.ok(
    packet.required_verification.includes('issue-specific verification'),
  );
});

test('closeout instructions include lane-finalize and current reconcile', () => {
  const packet = generateExecutionPacket(createTestManifest(), {});

  assert.equal(
    packet.closeout_instructions.some((entry) =>
      entry.includes('pnpm ops:lane-finalize'),
    ),
    true,
  );
  assert.equal(
    packet.closeout_instructions.some((entry) =>
      entry.includes('pnpm ops:orchestration-reconcile --current'),
    ),
    true,
  );
});

test('packet defaults to static-only and never restores the unsafe universal verify instruction', () => {
  const packet = generateExecutionPacket(
    createTestManifest({
      file_scope_lock: [
        'apps/worker/src/t1-proof-utv2-1497-outbox-concurrent-claim.test.ts',
        'scripts/ops/execution-packet.ts',
        'scripts/ops/execution-packet.test.ts',
      ],
    }),
    {},
  );

  assert.equal(packet.verification_plan?.mode, 'static-only');
  assert.equal(packet.verification_plan?.live_db_status, 'blocked-deferred');
  assert.equal(packet.verification_plan?.writable_live_db_command, null);
  assert.match(
    packet.verification_plan?.focused_test_command ?? '',
    /execution-packet\.test\.ts/,
  );
  assert.doesNotMatch(
    packet.verification_plan?.focused_test_command ?? '',
    /t1-proof-utv2-1497-outbox-concurrent-claim\.test\.ts/,
  );
  assert.equal(
    packet.closeout_instructions.includes(
      'Run pnpm verify and ensure it passes',
    ),
    false,
  );
  assert.equal(
    packet.closeout_instructions.some((entry) =>
      entry.includes('pnpm test:live-db'),
    ),
    false,
  );
  assert.equal(
    packet.closeout_instructions.some((entry) =>
      entry.includes('pnpm verify:static'),
    ),
    true,
  );
});

test('packet authorizes writable live-DB verification only after isolated identity proof', () => {
  const isolatedRef = 'xskgrzbteyqdufktjrjx';
  const packet = generateExecutionPacket(
    createTestManifest({
      tier: 'T1',
      file_scope_lock: [
        'apps/worker/src/t1-proof-utv2-1497-outbox-concurrent-claim.test.ts',
      ],
    }),
    {
      UNIT_TALK_DB_ACCESS_MODE: 'writable-isolated',
      CI_SUPABASE_PROJECT_REF: isolatedRef,
      SUPABASE_URL: `https://${isolatedRef}.supabase.co`,
    },
  );

  assert.equal(packet.verification_plan?.mode, 'writable-isolated');
  assert.equal(packet.verification_plan?.live_db_status, 'authorized-isolated');
  assert.match(
    packet.verification_plan?.writable_live_db_command ?? '',
    /ci:assert-staging && pnpm test:live-db/,
  );
  assert.match(
    packet.verification_plan?.focused_test_command ?? '',
    /t1-proof-utv2-1497-outbox-concurrent-claim\.test\.ts/,
  );
  assert.equal(
    packet.closeout_instructions.some((entry) =>
      entry.includes('guarded isolated writable verification'),
    ),
    true,
  );
});

test('packet rejects canonical production hidden behind writable variable names', () => {
  const packet = generateExecutionPacket(createTestManifest({ tier: 'T1' }), {
    UNIT_TALK_DB_ACCESS_MODE: 'writable-isolated',
    CI_SUPABASE_PROJECT_REF: 'wgfgqfxnnwjmrbubqhcj',
    DATABASE_URL:
      'postgresql://postgres.example@db.zfzdnfwdarxucxtaojxm.supabase.co:5432/postgres',
  });

  assert.equal(packet.verification_plan?.mode, 'static-only');
  assert.equal(packet.verification_plan?.live_db_status, 'blocked-deferred');
  assert.equal(packet.verification_plan?.writable_live_db_command, null);
  assert.match(
    packet.verification_plan?.reason ?? '',
    /target identity could not be resolved|CANONICAL PRODUCTION/,
  );
});

test('packet permits canonical production only as guarded read-only observation', () => {
  const productionRef = 'zfzdnfwdarxucxtaojxm';
  const packet = generateExecutionPacket(createTestManifest({ tier: 'T1' }), {
    UNIT_TALK_DB_ACCESS_MODE: 'production-read-only',
    SUPABASE_PROJECT_REF: productionRef,
    SUPABASE_URL: `https://${productionRef}.supabase.co`,
    SUPABASE_ANON_KEY: 'anon-fixture',
  });

  assert.equal(packet.verification_plan?.mode, 'production-read-only');
  assert.equal(packet.verification_plan?.live_db_status, 'read-only-only');
  assert.equal(packet.verification_plan?.writable_live_db_command, null);
  assert.match(
    packet.verification_plan?.production_read_only_guard_command ?? '',
    /SUPABASE_ANON_KEY/,
  );
  assert.equal(
    packet.closeout_instructions.some((entry) =>
      entry.includes('pnpm test:live-db'),
    ),
    false,
  );
});
