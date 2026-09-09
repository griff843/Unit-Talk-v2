import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertExecutionPacketCwd,
  assertSufficientTaskContract,
  assertTaskContract,
  buildSyncYmlWithTaskContract,
  buildTaskContract,
  captureOrReadTaskContract,
  localTaskSourcePath,
  readLocalTaskSource,
  deriveSkillRouting,
  fetchLinearTaskSource,
  generateExecutionPacket as generateExecutionPacketRaw,
  generateExecutionPacketResult,
  generateDispatchExecutionPacketResult,
  InsufficientTaskContractError,
  packetContractFieldSpecs,
  packetParseSectionsForTest as parseSectionsForTest,
  packetSectionLinesForTest as sectionLinesForTest,
  PREAMBLE_KEY,
  readTaskContract,
  renderTaskContract,
  skillRoutingSpecsForTest,
  taskContractFullText,
  TaskContractError,
  type TaskContract,
} from './execution-packet.js';
import { ROOT, type LaneManifest } from './shared.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

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
        '## Where to look',
        '- scripts/ops/execution-packet.ts',
        '- scripts/ops/execution-packet.test.ts',
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

// ── UTV2-1734 review finding B1: nothing from the issue may be discarded ────
//
// Once a description carried an exact `## Acceptance criteria` heading, only
// six whitelisted headings survived and the remainder was dropped silently,
// while the prompt rendered "(none declared)" — an affirmative false claim —
// and told the executor not to go read the issue. Measured on the live board,
// 14 of 18 sectioned descriptions lost over a fifth of their content.

const SECTIONED = [
  '## Objective', 'Repair the rows.', '',
  '## Acceptance criteria', '- Rows are repaired', '',
  '## Production gate',
  'No production write is authorized. Do not run a blanket UPDATE picks SET stake_units = 1.', '',
  '## Rollback', 'Restore from the pre-change snapshot.',
].join('\n');

test('B1: sections outside the whitelist survive into the contract', () => {
  const c = buildTaskContract({
    identifier: 'UTV2-9400', title: 'T', url: 'u', description: SECTIONED,
  });
  assert.ok(c.unmapped_sections.length >= 2, 'unrecognised sections must be captured');
  assert.ok(
    c.unmapped_sections.some((s) => /blanket UPDATE/u.test(s)),
    'a production-mutation guardrail must never be dropped',
  );
});

test('B1: the rendered prompt contains the unmapped content verbatim', () => {
  const rendered = renderTaskContract(
    buildTaskContract({ identifier: 'UTV2-9401', title: 'T', url: 'u', description: SECTIONED }),
  );
  assert.match(rendered, /Additional issue content/u);
  assert.match(rendered, /blanket UPDATE/u);
  assert.match(rendered, /Restore from the pre-change snapshot/u);
});

test('B1: an empty field never claims "none declared" while content went unmapped', () => {
  const rendered = renderTaskContract(
    buildTaskContract({ identifier: 'UTV2-9402', title: 'T', url: 'u', description: SECTIONED }),
  );
  // The description declares no Guardrails heading, but it does carry unmapped
  // sections — so the honest statement is "not extracted", never "none declared".
  assert.doesNotMatch(rendered, /none declared/u);
  assert.match(rendered, /not extracted — see "Additional issue content" below/u);
});

test('B1: a fully-mapped description still says "none declared" truthfully', () => {
  const rendered = renderTaskContract(
    buildTaskContract({
      identifier: 'UTV2-9403', title: 'T', url: 'u',
      description: '## Objective\nDo it.\n\n## Acceptance criteria\n- It is done\n',
    }),
  );
  assert.match(rendered, /none declared/u, 'with nothing unmapped, the claim is true');
});

test('B1: no vocabulary is lost between description and rendered prompt', () => {
  const c = buildTaskContract({ identifier: 'UTV2-9404', title: 'T', url: 'u', description: SECTIONED });
  const rendered = renderTaskContract(c);
  const words = (t: string): Set<string> => new Set(t.toLowerCase().match(/[a-z0-9_]{4,}/gu) ?? []);
  const missing = [...words(SECTIONED)].filter((w) => !words(rendered).has(w));
  assert.deepEqual(missing, [], `these words were dropped from the work order: ${missing.join(', ')}`);
});

// ── UTV2-1737 authored corrections: regression guards ────────────────────────
// Both corrections previously had no test. Removing either left the suite green,
// which is exactly how a safety control rots. Each of these fails if its
// correction is reverted.

test('preamble before the first heading survives into the rendered prompt', () => {
  const contract = buildTaskContract({
    identifier: 'UTV2-9999',
    title: 'preamble guard',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-9999',
    description:
      'Do not run a blanket UPDATE against production.\n\n## Objective\nx\n\n## Acceptance criteria\n- y\n',
  });
  const rendered = renderTaskContract(contract);
  assert.ok(
    rendered.includes('Do not run a blanket UPDATE against production.'),
    'a prohibition stated before the first heading must reach the executor',
  );
});

// Shared by the two tests below. Declared once so the fixture check and the
// output check cannot drift apart.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

test('PREAMBLE_KEY is safe to pass as a process argument', () => {
  // The rendered prompt becomes an argv element. Node rejects an argument
  // containing a NUL byte with a bare TypeError, crashing dispatch rather than
  // dropping a line -- strictly worse than the content loss this module exists
  // to prevent. An earlier revision used a NUL-prefixed sentinel and did exactly
  // that. Asserted on the constant itself, so the guarantee does not depend on
  // stripControlChars still being applied somewhere downstream: with only the
  // rendered-output test below, reverting this constant went undetected.
  assert.doesNotMatch(PREAMBLE_KEY, CONTROL_CHARS,
    'PREAMBLE_KEY must not contain a control character');
  const probe = spawnSync(process.execPath, ['-e', 'process.exit(0)', PREAMBLE_KEY], {
    encoding: 'utf8',
  });
  assert.equal(probe.error, undefined,
    `PREAMBLE_KEY must survive as an argv element: ${String(probe.error)}`);
});

test('control characters in the issue description never reach the rendered prompt', () => {
  // The fixture must actually CONTAIN control characters. The previous version
  // of this test used a clean description, so its assertion held whether or not
  // any stripping was applied -- deleting stripControlChars left it green.
  const hostile = [
    'Preamble\u0007line.',
    '',
    '## Objective',
    'Ship it\u0000 now.',
    '',
    '## Acceptance criteria',
    '- keep \u001B[31mcolour\u001B[0m codes out',
  ].join('\n');
  assert.match(hostile, CONTROL_CHARS,
    'the fixture itself must carry control characters, or this test proves nothing');

  const contract = buildTaskContract({
    identifier: 'UTV2-9999',
    title: 'control char guard',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-9999',
    description: hostile,
  });
  const rendered = renderTaskContract(contract);
  assert.doesNotMatch(rendered, CONTROL_CHARS,
    'control characters from the issue body must be stripped before the prompt is built');

  // The surviving text must be spawn-safe as a real argv element, which is the
  // exact failure this strip exists to prevent.
  const probe = spawnSync(process.execPath, ['-e', 'process.exit(0)', rendered], {
    encoding: 'utf8',
  });
  assert.equal(probe.error, undefined,
    `the rendered prompt must survive as an argv element: ${String(probe.error)}`);
});

test('a section heading with an empty body is still carried as residue', () => {
  // The fixture must leave the prohibition heading genuinely EMPTY -- no body and
  // no nested subsection. An earlier fixture put a `### Details` subsection under
  // it; once nested content began flowing to its parent, the heading was no
  // longer empty and this test stopped exercising the empty-body branch at all,
  // silently going vacuous. Its sibling below covers the nested-subsection case.
  const contract = buildTaskContract({
    identifier: 'UTV2-9999',
    title: 'empty section guard',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-9999',
    description:
      '## Objective\nx\n\n## Acceptance criteria\n- y\n\n## DO NOT TOUCH PRODUCTION\n\n## Details\n- ok\n',
  });
  const bare = contract.unmapped_sections.find((entry) =>
    entry.toLowerCase().startsWith('do not touch production'));
  assert.ok(bare, 'an empty-bodied heading must survive as residue, carrying its own vocabulary');
  const rendered = renderTaskContract(contract).toLowerCase();
  for (const token of ['touch', 'production'])
    assert.ok(rendered.includes(token), `heading vocabulary "${token}" must not be dropped`);
});

test('a heading whose only content is a subsection keeps that subsection with it', () => {
  // The companion case: content nested under a prohibition heading must travel
  // with the prohibition, not replace it.
  const contract = buildTaskContract({
    identifier: 'UTV2-9999',
    title: 'nested prohibition',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-9999',
    description:
      '## Objective\nx\n\n## Acceptance criteria\n- y\n\n## DO NOT TOUCH PRODUCTION\n\n### Details\n- no DDL\n',
  });
  const rendered = renderTaskContract(contract);
  assert.match(rendered, /do not touch production/iu);
  assert.match(rendered, /no DDL/u,
    'the nested detail must travel with the heading it qualifies');
});

test('a contract predating unmapped_sections refuses structurally, not with a TypeError', () => {
  const stale = JSON.parse(
    JSON.stringify(
      buildTaskContract({
        identifier: 'UTV2-9999',
        title: 'stale guard',
        url: 'https://linear.app/unit-talk-v2/issue/UTV2-9999',
        description: '## Objective\nx\n\n## Acceptance criteria\n- y\n',
      }),
    ),
  ) as Record<string, unknown>;
  delete stale['unmapped_sections'];
  let caught: unknown;
  try {
    assertTaskContract(stale, 'UTV2-9999');
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof TaskContractError, 'must be a structured TaskContractError');
  assert.equal((caught as TaskContractError).code, 'stale_contract_missing_unmapped_sections');
  assert.notEqual((caught as Error).constructor.name, 'TypeError');
});

test('the rendered prompt carries source provenance so staleness is visible', () => {
  const contract = buildTaskContract({
    identifier: 'UTV2-9999',
    title: 'provenance guard',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-9999',
    description: '## Objective\nx\n\n## Acceptance criteria\n- y\n',
  });
  const rendered = renderTaskContract(contract);
  assert.match(rendered, /Source issue: /u);
  assert.match(rendered, /Captured at: /u);
});

// ---------------------------------------------------------------------------
// PM review findings, UTV2-1747 (bounce 1)
// ---------------------------------------------------------------------------

test('the standalone packet CLI produces a packet for a newly admitted pre-contract lane', () => {
  // Finding 1. The policy-required standalone command called the strict packet
  // gate directly, so a lane whose sync record had no task_contract -- every
  // freshly admitted lane -- was refused by exactly the command meant to
  // preview it. Executed as a child process so the real CLI path is measured,
  // with curl stubbed so the one capture happens offline.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1747-cli-'));
  const root = path.join(dir, 'repo');
  const wt = path.join(root, 'wt');
  const issueId = 'UTV2-999820';
  fs.mkdirSync(path.join(root, 'docs', '06_status', 'lanes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', '05_operations'), { recursive: true });
  fs.mkdirSync(wt, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'docs', '05_operations', 'db-writer-classification.json'),
    path.join(root, 'docs', '05_operations', 'db-writer-classification.json'),
  );
  fs.writeFileSync(path.join(root, 'docs', '06_status', 'lanes', `${issueId}.json`),
    `${JSON.stringify({
      schema_version: 2, issue_id: issueId, lane_type: 'governance', executor: 'claude',
      tier: 'T2', worktree_path: wt, branch: `claude/${issueId.toLowerCase()}-fixture`,
      base_branch: 'main', commit_sha: null, pr_url: null, files_changed: [],
      file_scope_lock: ['scripts/ops/fixture.ts'], expected_proof_paths: [], status: 'started',
      started_at: '2026-08-24T00:00:00.000Z', heartbeat_at: '2026-08-24T00:00:00.000Z',
      closed_at: null, blocked_by: [], preflight_token: '.out/ops/preflight/fixture.json',
      created_by: 'claude', truth_check_history: [], reopen_history: [],
      execution_location: { mode: 'worktree', cwd: wt, package_install: 'verified',
        setup_command: null, main_checkout_control_only: true },
    }, null, 2)}\n`);
  fs.writeFileSync(path.join(wt, 'README.md'), 'seed\n');
  for (const args of [['init', '-q', '-b', 'main', '.'], ['config', 'user.email', 't@e.com'],
    ['config', 'user.name', 'T'], ['add', '-A'], ['commit', '-qm', 'seed']]) {
    spawnSync('git', args, { cwd: root, stdio: 'pipe' });
  }

  // Offline Linear. The CLI's single capture reads this instead of the network.
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const objective = 'Preview a pre-contract lane without refusing.';
  const payload = JSON.stringify({ data: { issue: {
    identifier: issueId, title: 'CLI fixture',
    url: `https://linear.app/unit-talk/issue/${issueId}`,
    description: `## Objective\n${objective}\n\n## Acceptance criteria\n- the CLI emits a packet\n\n## Where to look\n- scripts/ops/fixture.ts\n\n## Required evidence\n- tests pass\n\n## Exit criteria\n- the CLI emits a packet`,
  } } });
  fs.writeFileSync(path.join(bin, 'curl'),
    `#!/bin/sh\ncat >/dev/null 2>&1\ncat <<'JSON'\n${payload}\nJSON\nexit 0\n`, { mode: 0o755 });

  const run = spawnSync(
    path.join(ROOT, 'node_modules', '.bin', 'tsx'),
    [path.join(ROOT, 'scripts', 'ops', 'execution-packet.ts'), issueId],
    { cwd: root, encoding: 'utf8', timeout: 180_000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
             LINEAR_API_TOKEN: 'stub-token' } },
  );

  assert.equal(run.status, 0,
    `the standalone CLI must produce a packet for a pre-contract lane; stderr: ${run.stderr}\n${run.stdout}`);
  const packet = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)) as
    { task_contract?: { objective?: string } };
  assert.equal(packet.task_contract?.objective, objective,
    'the emitted packet must carry the captured objective');
  // The capture is persisted, so the next read is not another network call.
  assert.equal(readTaskContract(issueId, root).objective, objective,
    'the CLI must persist the contract it captured');
});

test('acceptance criteria under a nested subheading are not lost', () => {
  // Finding 2. Any heading at any level replaced the current section, so an
  // `## Acceptance criteria` parent whose items lived under `### Functional`
  // ended up empty -- and because the parent heading existed, the fallback was
  // disabled and the contract was refused for "missing acceptance criteria"
  // while the criteria sat one level below.
  const description = [
    '## Objective', 'Ship the nested-heading fix.', '',
    '## Acceptance criteria',
    '### Functional',
    '- the nested item survives',
    '### Non-functional',
    '- the second nested item survives too',
    '',
    '## Guardrails',
    '- do not widen the parser whitelist',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999821', title: 'nested acceptance',
    url: 'https://linear.app/unit-talk/issue/UTV2-999821', description,
  }, '2026-08-24T00:00:00.000Z');

  const joined = contract.acceptance_criteria.join('\n');
  assert.match(joined, /the nested item survives/u,
    'a criterion under a subheading must reach acceptance_criteria');
  assert.match(joined, /the second nested item survives too/u,
    'every nested subsection must be associated with its parent');
  // Consuming the parent consumes its children, so the same text is not also
  // repeated in the residue.
  const residue = contract.unmapped_sections.join('\n');
  assert.doesNotMatch(residue, /the nested item survives/u,
    'nested content consumed by a parent must not be duplicated into residue');
});

test('unclassified content keeps its line and formatting semantics', () => {
  // Finding 3. Residue was flattened with join(' ') plus whitespace collapse,
  // which silently rewrote multiline commands, fenced code, tables and
  // paragraph boundaries -- while the bundle claimed it travelled verbatim.
  const description = [
    '## Objective', 'Carry residue intact.', '',
    '## Acceptance criteria', '- residue is preserved', '',
    '## Rollback runbook',
    '```sql',
    'BEGIN;',
    '  ALTER TABLE provider_offer_history DETACH PARTITION p20260901;',
    'COMMIT;',
    '```',
    '',
    '| step | owner |',
    '| --- | --- |',
    '| detach | dba |',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999822', title: 'residue fidelity',
    url: 'https://linear.app/unit-talk/issue/UTV2-999822', description,
  }, '2026-08-24T00:00:00.000Z');

  const residue = contract.unmapped_sections.join('\n');
  assert.match(residue, /\n/u, 'residue must not be flattened onto one line');
  for (const line of [
    'BEGIN;',
    '  ALTER TABLE provider_offer_history DETACH PARTITION p20260901;',
    'COMMIT;',
    '| step | owner |',
    '| --- | --- |',
  ]) {
    assert.ok(residue.includes(line),
      `residue must carry this line exactly as authored: ${JSON.stringify(line)}`);
  }
  // The indented statement must keep its indentation: whitespace collapse
  // rewrote it, and an executor pasting the block would run different SQL.
  assert.ok(residue.includes('\n  ALTER TABLE'),
    'leading indentation inside a fenced block must survive');

  const rendered = renderTaskContract(contract);
  assert.ok(rendered.includes('  ALTER TABLE provider_offer_history DETACH PARTITION p20260901;'),
    'the rendered prompt must carry the multiline block intact');
  assert.ok(rendered.includes('| --- | --- |'),
    'the rendered prompt must carry table rows intact');
});

// ---------------------------------------------------------------------------
// UTV2-1747 exact-head review findings (PR #1446). One regression test per
// finding; each asserts its own precondition first so it cannot pass vacuously.
// ---------------------------------------------------------------------------

/** A repo root + lane worktree with a manifest, and no network anywhere. */
function seedDispatchRoots(): { root: string; wt: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1747-rf-'));
  const root = path.join(dir, 'repo');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(path.join(root, 'docs', '06_status', 'lanes'), { recursive: true });
  fs.mkdirSync(path.join(root, '.ops', 'sync'), { recursive: true });
  fs.mkdirSync(path.join(wt, '.ops', 'sync'), { recursive: true });
  return { root, wt };
}

function dispatchManifest(issueId: string, wt: string): LaneManifest {
  return createTestManifest({
    issue_id: issueId,
    worktree_path: wt,
    branch: `claude/${issueId.toLowerCase()}-fixture`,
    execution_location: {
      mode: 'worktree',
      cwd: wt,
      package_install: 'verified',
      setup_command: null,
      main_checkout_control_only: true,
    },
  });
}

function linearRunner(description: string, title = 'Fixture'): typeof spawnSync {
  return ((_cmd: string, _args: string[], _opts: unknown) => ({
    status: 0,
    error: undefined,
    stderr: '',
    stdout: JSON.stringify({
      data: {
        issue: {
          identifier: 'PLACEHOLDER_ID',
          title,
          url: 'https://linear.app/unit-talk/issue/x',
          description,
        },
      },
    }),
  })) as unknown as typeof spawnSync;
}

test('F1: divergent valid contracts in control and lane roots refuse instead of overwriting', () => {
  const issueId = 'UTV2-999901';
  const { root, wt } = seedDispatchRoots();

  const controlContract = buildTaskContract({
    identifier: issueId,
    title: 'Control copy',
    url: 'https://linear.app/unit-talk/issue/x',
    description: '## Objective\ncontrol objective\n\n## Acceptance criteria\n- control',
  });
  const laneContract = buildTaskContract({
    identifier: issueId,
    title: 'Lane copy',
    url: 'https://linear.app/unit-talk/issue/x',
    description: '## Objective\nlane objective\n\n## Acceptance criteria\n- lane',
  });

  // Precondition: the two contracts genuinely differ. Without this the test
  // would pass against an implementation that never compares anything.
  assert.notEqual(
    controlContract.contract_hash,
    laneContract.contract_hash,
    'fixture contracts are identical — this test would be vacuous',
  );

  fs.writeFileSync(
    path.join(root, '.ops', 'sync', `${issueId}.yml`),
    buildSyncYmlWithTaskContract(issueId, controlContract, undefined),
    'utf8',
  );
  fs.writeFileSync(
    path.join(wt, '.ops', 'sync', `${issueId}.yml`),
    buildSyncYmlWithTaskContract(issueId, laneContract, undefined),
    'utf8',
  );
  const laneBytesBefore = fs.readFileSync(
    path.join(wt, '.ops', 'sync', `${issueId}.yml`),
  );

  const result = generateDispatchExecutionPacketResult(
    dispatchManifest(issueId, wt),
    { LINEAR_API_TOKEN: 'stub' },
    { root, runner: linearRunner('unused') },
  );

  assert.equal(result.ok, false, 'a divergent pair must refuse, not produce a packet');
  assert.equal(
    result.ok === false ? result.code : null,
    'LANE_CONTRACT_CONFLICT',
    `refusal must be structurally identifiable; got ${JSON.stringify(result)}`,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(wt, '.ops', 'sync', `${issueId}.yml`)),
    laneBytesBefore,
    'the lane worktree contract must be left byte-identical, never overwritten',
  );
});

test('F2: an empty configured LINEAR_API_TOKEN does not mask LINEAR_API_KEY', () => {
  const issueId = 'UTV2-999902';
  const { root, wt } = seedDispatchRoots();
  const env = { LINEAR_API_TOKEN: '', LINEAR_API_KEY: 'real-key' };

  // Precondition: the masking value really is an empty string, not undefined.
  // `??` skips undefined, so an undefined fixture would test nothing.
  assert.equal(env.LINEAR_API_TOKEN, '', 'fixture must use an EMPTY token');
  assert.ok(env.LINEAR_API_KEY.length > 0, 'fixture must supply a real key');

  let sawToken: string | null = null;
  const runner = ((_cmd: string, _args: string[], opts: { input?: string }) => {
    sawToken = opts?.input ?? '';
    return {
      status: 0,
      error: undefined,
      stderr: '',
      stdout: JSON.stringify({
        data: {
          issue: {
            identifier: issueId,
            title: 'Fixture',
            url: 'https://linear.app/unit-talk/issue/x',
            description: '## Objective\ncapture must proceed\n\n## Acceptance criteria\n- captured\n\n## Where to look\n- fixture.ts\n\n## Required evidence\n- tests pass\n\n## Exit criteria\n- fixture is captured',
          },
        },
      }),
    };
  }) as unknown as typeof spawnSync;

  const result = generateDispatchExecutionPacketResult(
    dispatchManifest(issueId, wt),
    env,
    { root, runner },
  );

  assert.equal(
    result.ok,
    true,
    `capture must fall through to LINEAR_API_KEY; got ${result.ok === false ? result.message : ''}`,
  );
  assert.match(
    String(sawToken ?? ''),
    /real-key/u,
    'the configured key must actually reach the fetch, not just avoid the refusal',
  );
});

test('F3: a repeated normalized heading keeps both occurrences as distinct sections', () => {
  const description = [
    '## Objective',
    'ship it',
    '',
    '## Acceptance criteria',
    '- done',
    '',
    '## Notes',
    'parent body',
    '',
    '### Details',
    'nested detail body',
    '',
    '## Details',
    'independent top-level detail body',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999903',
    title: 'Repeated headings',
    url: 'https://linear.app/unit-talk/issue/x',
    description,
  });

  // Precondition: the description really does repeat a normalizing heading.
  assert.equal(
    (description.match(/^#{2,3} Details$/gmu) ?? []).length,
    2,
    'fixture must contain two headings that normalize alike',
  );

  const residue = contract.unmapped_sections.join('\n');
  assert.match(
    residue,
    /independent top-level detail body/u,
    'the later independent section must survive; it was being swallowed by the nested occurrence',
  );
  assert.match(residue, /nested detail body/u, 'the nested body must also survive');
  assert.match(
    renderTaskContract(contract),
    /independent top-level detail body/u,
    'the rendered prompt must carry the independent section too',
  );
});

test('F4: an unmapped heading keeps its authored case, punctuation and flag prefix', () => {
  const description = [
    '## Objective',
    'ship it',
    '',
    '## Acceptance criteria',
    '- done',
    '',
    '## Never run `--force` against production!',
    'this prohibition is load-bearing',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999904',
    title: 'Verbatim headings',
    url: 'https://linear.app/unit-talk/issue/x',
    description,
  });

  // Precondition: the heading contains exactly the characters normalization
  // destroys — uppercase, backticks, a flag prefix and punctuation.
  assert.match(description, /## Never run `--force` against production!/u,
    'fixture heading must carry case, backticks, a flag prefix and punctuation');

  const residue = contract.unmapped_sections.join('\n');
  assert.match(
    residue,
    /Never run `--force` against production!/u,
    `the authored heading must be preserved verbatim; got: ${residue}`,
  );
  assert.doesNotMatch(
    residue,
    /never run force:/u,
    'the normalized lookup key must never be rendered as the heading',
  );
  assert.match(
    renderTaskContract(contract),
    /Never run `--force` against production!/u,
    'the rendered prompt must carry the authored heading',
  );
});

test('F6: a whitespace-only LINEAR_API_TOKEN does not mask LINEAR_API_KEY', () => {
  const issueId = 'UTV2-999905';
  const { root, wt } = seedDispatchRoots();
  const env = { LINEAR_API_TOKEN: '   \t\n ', LINEAR_API_KEY: 'real-key' };

  // Precondition: the masking value is non-empty as a STRING but empty once
  // trimmed. F2's exact-'' fixture cannot reach this branch, so without this
  // assertion the test could silently degrade into a duplicate of F2.
  assert.notEqual(env.LINEAR_API_TOKEN, '', 'fixture token must not be exactly empty');
  assert.equal(env.LINEAR_API_TOKEN.trim(), '', 'fixture token must be whitespace-only');

  let sawToken: string | null = null;
  const runner = ((_cmd: string, _args: string[], opts: { input?: string }) => {
    sawToken = opts?.input ?? '';
    return {
      status: 0,
      error: undefined,
      stderr: '',
      stdout: JSON.stringify({
        data: {
          issue: {
            identifier: issueId,
            title: 'Fixture',
            url: 'https://linear.app/unit-talk/issue/x',
            description: '## Objective\ncapture must proceed\n\n## Acceptance criteria\n- captured\n\n## Where to look\n- fixture.ts\n\n## Required evidence\n- tests pass\n\n## Exit criteria\n- fixture is captured',
          },
        },
      }),
    };
  }) as unknown as typeof spawnSync;

  const result = generateDispatchExecutionPacketResult(
    dispatchManifest(issueId, wt),
    env,
    { root, runner },
  );

  assert.equal(
    result.ok,
    true,
    `a whitespace-only token must fall through to LINEAR_API_KEY; got ${result.ok === false ? result.message : ''}`,
  );
  assert.match(
    String(sawToken ?? ''),
    /real-key/u,
    'the configured key must actually reach the fetch, not merely avoid the refusal',
  );
});

test('F7: a repeated recognized heading aggregates instead of yielding only the first', () => {
  const description = [
    '## Objective',
    'ship it',
    '',
    '## Acceptance criteria',
    '',
    '## Acceptance criteria',
    '- the real criterion',
  ].join('\n');

  // Precondition: the heading really is repeated and the FIRST occurrence is
  // empty. If the fixture put content in the first occurrence the test would
  // pass against the first-occurrence-only implementation and prove nothing.
  const occurrences = description
    .split('\n')
    .filter((line) => line.trim() === '## Acceptance criteria');
  assert.equal(occurrences.length, 2, 'fixture must repeat the recognized heading');
  assert.equal(
    description.indexOf('## Acceptance criteria\n\n'),
    description.indexOf('## Acceptance criteria'),
    'the FIRST occurrence must be empty for this test to be non-vacuous',
  );

  const contract = buildTaskContract({
    identifier: 'UTV2-999906',
    title: 'Repeated recognized heading',
    url: 'https://linear.app/unit-talk/issue/x',
    description,
  });

  assert.ok(
    contract.acceptance_criteria.length > 0,
    'the populated later occurrence must supply the criteria, not be discarded',
  );
  assert.ok(
    contract.acceptance_criteria.some((item) => /the real criterion/u.test(item)),
    `the later occurrence's content must survive; got ${JSON.stringify(contract.acceptance_criteria)}`,
  );
  // The aggregated occurrences are consumed, so the criteria must NOT also be
  // re-emitted as unmapped residue.
  assert.doesNotMatch(
    contract.unmapped_sections.join('\n'),
    /the real criterion/u,
    'aggregated content must not be duplicated into residue',
  );
});

test('F8: an unmapped heading is rendered as an exact line with no invented punctuation', () => {
  const authored = 'Never run command --force!';
  const description = [
    '## Objective',
    'ship it',
    '',
    '## Acceptance criteria',
    '- done',
    '',
    `## ${authored}`,
    'this prohibition is load-bearing',
  ].join('\n');

  // Precondition: the authored heading already ends in punctuation, so an
  // appended ':' is detectable. A substring match (F4) cannot see it, which is
  // exactly why this test compares the COMPLETE line.
  assert.ok(authored.endsWith('!'), 'fixture heading must end in punctuation');

  const contract = buildTaskContract({
    identifier: 'UTV2-999907',
    title: 'Exact residue heading',
    url: 'https://linear.app/unit-talk/issue/x',
    description,
  });

  const entry = contract.unmapped_sections.find((section) =>
    section.includes(authored),
  );
  assert.ok(entry, `residue must carry the authored heading; got ${JSON.stringify(contract.unmapped_sections)}`);

  const firstLine = String(entry).split('\n')[0];
  assert.strictEqual(
    firstLine,
    authored,
    `the rendered heading line must equal the authored heading EXACTLY; got ${JSON.stringify(firstLine)}`,
  );
  assert.doesNotMatch(
    String(entry),
    /--force!:/u,
    'no colon may be appended to an authored heading',
  );
});

// UTV2-1752 finding 3 (P2): consumption must be tracked ACROSS contract-field
// extraction. A recognized section nested under another recognized section was
// emitted twice -- once inside the ancestor's field, whose `lines` carry the
// whole subtree, and again by the field that actually owns the key, whose
// per-call consumed-set could not see the earlier pass. The child must appear
// exactly once, in its own field, and nowhere else.
test('G1: a recognized section nested under another recognized section lands in exactly one field', () => {
  const description = [
    '## Objective',
    'ship the transport',
    '',
    '### Acceptance criteria',
    '- nested criterion alpha',
    '',
    '## Notes',
    'unrelated note body',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999952',
    title: 'Nested recognized section',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999952',
    description,
  });

  const objective = contract.objective;
  const acceptance = contract.acceptance_criteria.join('\n');

  // It reaches the field that owns the key...
  assert.match(
    acceptance,
    /nested criterion alpha/u,
    'the nested criterion must reach acceptance_criteria',
  );
  // ...and it is NOT also swallowed by the enclosing objective.
  assert.doesNotMatch(
    objective,
    /nested criterion alpha/u,
    'the ancestor field must not also carry the nested recognized child',
  );
  assert.match(objective, /ship the transport/u, 'the objective keeps its own body');

  // The unrelated sibling is untouched by the subtraction.
  const rendered = renderTaskContract(contract);
  assert.match(rendered, /unrelated note body/u, 'unrelated residue must survive');

  // Exactly once across the WHOLE rendered packet -- not in a field and again
  // in "additional issue content".
  const occurrences = rendered.split('nested criterion alpha').length - 1;
  assert.equal(
    occurrences,
    1,
    `nested criterion must appear exactly once in the packet, saw ${occurrences}`,
  );
});

// UTV2-1752 finding 3, residue half. G1 covers the case where the ENCLOSING
// section is itself a contract field. The other half is an UNRECOGNIZED
// ancestor that survives into "additional issue content" while carrying a
// recognized child: its `lines` hold the whole subtree, so without the same
// per-line subtraction the claimed child is rendered twice -- once in its
// field and once inside the residue block.
test('G5: a claimed child is subtracted from an UNRECOGNIZED ancestor that survives as residue', () => {
  const description = [
    '## Objective',
    'ship the transport',
    '',
    '## Notes',
    'ancestor note body',
    '',
    '### Acceptance criteria',
    '- claimed criterion beta',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999955',
    title: 'Recognized child under unrecognized ancestor',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999955',
    description,
  });

  assert.match(
    contract.acceptance_criteria.join('\n'),
    /claimed criterion beta/u,
    'the nested criterion must still reach acceptance_criteria',
  );

  const rendered = renderTaskContract(contract);
  // The unrecognized ancestor still travels -- nothing is dropped.
  assert.match(rendered, /ancestor note body/u, 'the residue ancestor must survive');

  const occurrences = rendered.split('claimed criterion beta').length - 1;
  assert.equal(
    occurrences,
    1,
    `the claimed child must appear exactly once, saw ${occurrences}`,
  );
});

test('G6: a non-goal nested under acceptance criteria is NOT also an acceptance criterion', () => {
  // Review thread PRRT_kwDORr3vD86cHGhZ. The first version of the reservation
  // fix hardcoded its own list of reserved headings and omitted `non goals`,
  // `guardrails` and `required evidence`. A nested non-goal therefore stayed
  // inside the acceptance ancestor AND was extracted by the non-goals pass, so
  // the same sentence became both a thing to do and a thing NOT to do.
  const description = [
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- claimed criterion alpha',
    '',
    '### Non-goals',
    '- do not touch the scheduler',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999960',
    title: 'Nested non-goal under acceptance criteria',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999960',
    description,
  });

  assert.match(
    contract.non_goals.join('\n'),
    /do not touch the scheduler/u,
    'the nested non-goal must reach non_goals',
  );
  assert.doesNotMatch(
    contract.acceptance_criteria.join('\n'),
    /do not touch the scheduler/u,
    'a non-goal must NEVER appear as an acceptance criterion',
  );
  assert.match(
    contract.acceptance_criteria.join('\n'),
    /claimed criterion alpha/u,
    'the real criterion must survive',
  );

  const rendered = renderTaskContract(contract);
  const occurrences = rendered.split('do not touch the scheduler').length - 1;
  assert.equal(
    occurrences,
    1,
    `the non-goal must appear exactly once, saw ${occurrences}`,
  );
});

test('G7: guardrails and required evidence nested under a contract field are not swallowed by it', () => {
  // Same defect class as G6, on the other two omitted heading families.
  const description = [
    '## Objective',
    'ship the transport',
    '',
    '### Guardrails',
    '- never write to production',
    '',
    '### Required evidence',
    '- staging receipt',
    '',
    '## Acceptance criteria',
    '- claimed criterion gamma',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999961',
    title: 'Nested guardrails and evidence under objective',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999961',
    description,
  });

  assert.match(
    contract.guardrails.join('\n'),
    /never write to production/u,
    'the nested guardrail must reach guardrails',
  );
  assert.match(
    contract.required_evidence.join('\n'),
    /staging receipt/u,
    'the nested evidence item must reach required_evidence',
  );
  assert.doesNotMatch(
    contract.objective,
    /never write to production/u,
    'a guardrail must not be absorbed into the objective',
  );

  const rendered = renderTaskContract(contract);
  for (const needle of ['never write to production', 'staging receipt']) {
    const occurrences = rendered.split(needle).length - 1;
    assert.equal(
      occurrences,
      1,
      `"${needle}" must appear exactly once, saw ${occurrences}`,
    );
  }
});

test('G8: EVERY extraction heading is reserved -- proven behaviourally, per heading', () => {
  // The drift guard. An earlier version of this test grepped the source for
  // `sectionLines(parsed, ['`. That was theatre: it asserted a lexical shape,
  // not the property. An independent review evaded it twice -- once by giving
  // the reservation predicate its own hardcoded list (reintroducing the exact
  // defect this test is named for) and once by hoisting the headings to a
  // `const` that added an unreserved heading -- and the suite stayed green.
  //
  // So assert the BEHAVIOUR instead, for every heading of every field: nest
  // that heading under a different contract field and require that (a) its
  // content reaches its own field and (b) it does NOT bleed into the ancestor.
  // A heading extraction knows and reservation does not fails (b). This cannot
  // be evaded by moving, renaming, or restating a literal, because it never
  // reads the source text at all.
  const specs = packetContractFieldSpecs();
  assert.ok(specs.length >= 6, 'the field table must not be empty');

  const fieldKey: Record<string, keyof TaskContract> = {
    objective: 'objective',
    'acceptance criteria': 'acceptance_criteria',
    'exit criteria': 'exit_criteria',
    guardrails: 'guardrails',
    'non goals': 'non_goals',
    'required evidence': 'required_evidence',
  };

  const asText = (value: unknown): string =>
    Array.isArray(value) ? value.join('\n') : String(value ?? '');

  let checked = 0;
  for (const spec of specs) {
    assert.ok(spec.headings.length > 0, 'each field must declare a heading');
    const own = fieldKey[spec.headings[0]!];
    assert.ok(
      own,
      `no TaskContract key mapped for "${spec.headings[0]}" -- a field was ` +
        `added to the table without extending this guard`,
    );

    for (const heading of spec.headings) {
      const ancestorSpec = specs.find(
        (candidate) => candidate.headings[0] !== spec.headings[0],
      )!;
      const ancestorHeading = ancestorSpec.headings[0]!;
      const ancestorKey = fieldKey[ancestorHeading]!;
      const marker = `sentinel for ${heading} under ${ancestorHeading}`;

      const description = [
        `## ${ancestorHeading}`,
        '- ancestor content that must stay put',
        '',
        `### ${heading}`,
        `- ${marker}`,
      ].join('\n');

      const contract = buildTaskContract({
        identifier: 'UTV2-999965',
        title: `reservation coverage for ${heading}`,
        url: 'https://linear.app/unit-talk-v2/issue/UTV2-999965',
        description,
      });

      assert.match(
        asText(contract[own!]),
        new RegExp(escapeRegExp(marker), 'u'),
        `"${heading}" must be extracted into ${String(own)}`,
      );
      assert.doesNotMatch(
        asText(contract[ancestorKey]),
        new RegExp(escapeRegExp(marker), 'u'),
        `"${heading}" is an extraction heading, so it MUST also be reserved; ` +
          `it bled into the enclosing "${ancestorHeading}" field`,
      );
      checked += 1;
    }
  }
  assert.ok(checked >= 12, `expected every heading covered, checked ${checked}`);
});

test('G12: sectionLines fails closed on an extraction heading that is not reserved', () => {
  // G8 enumerates the table, so it structurally CANNOT see a heading that
  // extraction accepts but that was never added to the table -- an independent
  // review evaded the previous guard exactly that way, by hoisting the
  // headings to a const and appending one. The property therefore has to be
  // enforced on the extraction path itself. This test proves that guard fires,
  // and it is the reason `sectionLines` throws rather than silently coping.
  const parsed = parseSectionsForTest(
    ['## Goal', '- some content'].join('\n'),
  );
  assert.throws(
    () => sectionLinesForTest(parsed, ['goal']),
    /is used for extraction but is not reserved/u,
    'an unreserved extraction heading must be refused, not silently accepted',
  );
  // A reserved heading on the same path must still work, so the guard is not
  // simply rejecting everything.
  assert.doesNotThrow(() =>
    sectionLinesForTest(
      parseSectionsForTest(['## Objective', '- ship it'].join('\n')),
      ['objective'],
    ),
  );
});

test('G9: a "#" line inside a fenced code block is not parsed as a heading', () => {
  // Review thread PRRT_kwDORr3vD86cHGhc. The heading regex ran against the
  // TRIMMED line and tracked no fence state, so a shell comment opened a
  // section, ate the rest of the fence as its body, and split the fence.
  const description = [
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- run the documented command',
    '',
    '```bash',
    '# do not run this against production',
    'pnpm test:db',
    '```',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999962',
    title: 'Fenced hash line',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999962',
    description,
  });

  const rendered = renderTaskContract(contract);
  // parseSections' concern: no phantom section was opened by the `#` line.
  // unmapped_sections is string[] (`heading\nbody`), NOT objects. Reading a
  // `.heading` property off a string yields undefined, which made the previous
  // form of this assertion unconditionally true. Take the heading line itself.
  const phantom = contract.unmapped_sections.some((entry) =>
    /do not run this against production/u.test(entry.split('\n')[0] ?? ''),
  );
  assert.equal(
    phantom,
    false,
    'the shell comment must not have opened a section of its own',
  );
  assert.match(
    rendered,
    /# do not run this against production/u,
    'the shell comment must survive verbatim, with its # intact',
  );
  assert.match(
    contract.acceptance_criteria.join('\n'),
    /run the documented command/u,
    'the real criterion must not have been orphaned by a phantom heading',
  );
});

test('G18: the empty-acceptance fallback guard reads the SHARED table, for every alias', () => {
  // A THIRD mirror of the acceptance headings lived beside the table, matching
  // with `.includes` instead of the shared rule. An alias present in the table
  // was therefore invisible to this guard, silently re-enabling the legacy
  // whole-description fallback for a section that WAS explicitly headed --
  // handing the executor the entire issue text as its acceptance criteria
  // instead of failing closed on an empty one.
  //
  // Parameterized over the table, so a reinstated mirror fails on whichever
  // alias it omits rather than passing until someone notices.
  const spec = packetContractFieldSpecs().find(
    (candidate) => candidate.headings[0] === 'acceptance criteria',
  )!;
  assert.ok(spec.headings.length >= 2, 'the acceptance field must carry aliases');

  for (const heading of spec.headings) {
    const description = [
      '## Objective',
      'ship the transport',
      '',
      `## ${heading}`,
    ].join('\n');

    assert.throws(
      () =>
        buildTaskContract({
          identifier: 'UTV2-999970',
          title: `empty acceptance under "${heading}"`,
          url: 'https://linear.app/unit-talk-v2/issue/UTV2-999970',
          description,
        }),
      /missing acceptance criteria/u,
      `"${heading}" is an acceptance heading, so an EMPTY body must fail ` +
        'closed. If this guard cannot see the alias it falls back to the whole ' +
        'description, and the executor receives the entire issue as its ' +
        'acceptance criteria instead of an error',
    );
  }

  // The fallback itself still exists for genuinely unheaded legacy issues.
  const legacy = buildTaskContract({
    identifier: 'UTV2-999971',
    title: 'legacy issue with no acceptance heading',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999971',
    description: '## Objective\nship the transport\n\nsome legacy prose body',
  });
  assert.match(
    legacy.acceptance_criteria.join('\n'),
    /legacy prose body/u,
    'an issue with NO acceptance heading must still preserve its work order',
  );
});

test('G16: TAB-indented code is preserved, not collapsed', () => {
  // Found by an independent review AFTER this lane declared the indented-code
  // class closed. `^ {4,}` matched spaces only, so a tab-indented block -- and
  // a tab-indented fence, which is not a fence by the three-space rule -- fell
  // through to the paragraph collapse and produced output byte-identical to
  // what the mutation that kills G13 produces.
  const description = [
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- run the tab-indented block:',
    '',
    '\t# do not run in prod',
    '\tpnpm destroy',
    '',
    '- and the tab-indented fence:',
    '',
    '\t```bash',
    '\t# also do not run this',
    '\tpnpm wipe',
    '\t```',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999968',
    title: 'Tab-indented code under a contract field',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999968',
    description,
  });

  const criteria = contract.acceptance_criteria;
  assert.ok(
    criteria.some((item) => item.includes('# do not run in prod\n')),
    'the tab-indented block must keep its newline; got ' + JSON.stringify(criteria),
  );
  assert.ok(
    criteria.some((item) => item.includes('# also do not run this\n')),
    'the tab-indented fence must keep its newline; got ' + JSON.stringify(criteria),
  );
  assert.doesNotMatch(
    criteria.join('\n'),
    /# do not run in prod pnpm destroy/u,
    'a tab-indented comment must NEVER be collapsed onto its command',
  );
  assert.doesNotMatch(
    criteria.join('\n'),
    /# also do not run this pnpm wipe/u,
    'a tab-indented fence must NEVER be collapsed onto its command',
  );
});

test('G17: a blank line does not end an indented block', () => {
  // The deliberate rule at the top of the indented-run branch had no test: an
  // independent review removed it and the suite stayed green. A blank line
  // inside indented code is part of that code; ending the run there splits one
  // block into two items and reflows the remainder.
  const description = [
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- run the block:',
    '',
    '    # first stanza',
    '    pnpm one',
    '',
    '    # second stanza',
    '    pnpm two',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999969',
    title: 'Blank line inside an indented block',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999969',
    description,
  });

  const blocks = contract.acceptance_criteria.filter((item) =>
    item.includes('# first stanza'),
  );
  assert.equal(
    blocks.length,
    1,
    'the indented block must survive as ONE item; got ' +
      JSON.stringify(contract.acceptance_criteria),
  );
  assert.ok(
    blocks[0]!.includes('# second stanza'),
    'the blank line must not have split the block in two',
  );
  assert.doesNotMatch(
    contract.acceptance_criteria.join('\n'),
    /# second stanza pnpm two/u,
    'the tail of a split block must not be reflowed into a paragraph',
  );
});

test('G14: prefix heading matching stops at a word boundary', () => {
  // `non goals` matches by prefix, and the match was a bare startsWith, so
  // `## Non goalsetting framework` -- an unrelated section -- was captured as
  // non-goals and its content became things NOT to do. The rule had three
  // copies; this covers the single one that remains.
  const description = [
    '## Objective',
    'ship the transport',
    '',
    '## Non goalsetting framework',
    '- adopt the goalsetting framework in Q3',
    '',
    '## Non-goals',
    '- do not touch the scheduler',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999967',
    title: 'Prefix boundary',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999967',
    description,
  });

  assert.match(
    contract.non_goals.join('\n'),
    /do not touch the scheduler/u,
    'the real non-goal must still be captured by the prefix rule',
  );
  assert.doesNotMatch(
    contract.non_goals.join('\n'),
    /adopt the goalsetting framework/u,
    'a heading that merely starts with "non goal" is NOT a non-goals section',
  );
});

test('G13: an indented code block survives as ONE item with its newlines', () => {
  // Four-space indentation is an indented code block, and a fence indented
  // that far -- the ordinary way to nest code under a list item -- is not a
  // fence by the three-space rule, so both used to fall through to the
  // paragraph collapse. That produced `# do not run in prod pnpm destroy`:
  // the comment swallowing the command, the exact harm G11 exists to prevent,
  // surviving at a different indentation.
  const description = [
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- run the nested block:',
    '',
    '    ```bash',
    '    # do not run in prod',
    '    pnpm destroy',
    '    ```',
    '',
    '- and the bare indented block:',
    '',
    '    # bare indented comment',
    '    pnpm verify',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999966',
    title: 'Indented code under a contract field',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999966',
    description,
  });

  const criteria = contract.acceptance_criteria;
  assert.ok(
    criteria.some((item) => item.includes('# do not run in prod\n')),
    'the indented fence must keep the newline after its comment; got ' +
      JSON.stringify(criteria),
  );
  assert.ok(
    criteria.some((item) => item.includes('# bare indented comment\n')),
    'the bare indented block must keep its newline; got ' +
      JSON.stringify(criteria),
  );
  assert.doesNotMatch(
    criteria.join('\n'),
    /# do not run in prod pnpm destroy/u,
    'a comment must NEVER be collapsed onto the command it warns about',
  );
  assert.doesNotMatch(
    criteria.join('\n'),
    /# bare indented comment pnpm verify/u,
    'a comment must NEVER be collapsed onto the command that follows it',
  );
});

test('G11: a fenced block inside a contract field survives as ONE item with newlines', () => {
  // sectionItems' concern, distinct from G9's. Preserving the `#` in the
  // parser is not enough if the block is then flattened: collapsing
  // `# do not run this against production` onto the same line as
  // `pnpm test:db` makes the comment swallow the command.
  const description = [
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- run the documented command',
    '',
    '```bash',
    '# do not run this against production',
    'pnpm test:db',
    '```',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999964',
    title: 'Fenced block preserved as one item',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999964',
    description,
  });

  const fencedItem = contract.acceptance_criteria.find((item) =>
    item.startsWith('```bash'),
  );
  assert.ok(fencedItem, 'the fenced block must survive as its own item');
  assert.equal(
    fencedItem,
    '```bash\n# do not run this against production\npnpm test:db\n```',
    'the fenced block must keep its newlines verbatim',
  );
  assert.doesNotMatch(
    contract.acceptance_criteria.join('\n'),
    /do not run this against production pnpm test:db/u,
    'the comment must never end up on the same line as the command',
  );
});

test('G10: an indented code line beginning with "#" is not parsed as a heading', () => {
  const description = [
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- keep the indented block verbatim',
    '',
    '    # indented shell comment',
    '    pnpm verify',
  ].join('\n');

  const contract = buildTaskContract({
    identifier: 'UTV2-999963',
    title: 'Indented hash line',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-999963',
    description,
  });

  const rendered = renderTaskContract(contract);
  // The defect strips the `#` (it is consumed as heading syntax) and opens a
  // section named for the comment text. Asserting a mere occurrence count does
  // NOT detect that -- the text appears once either way -- which is exactly how
  // the first version of this test managed to be vacuous.
  // See G9: entries are `heading\nbody` strings, so `.heading` is undefined and
  // the assertion could never fail. Compare against the first line.
  const openedSection = contract.unmapped_sections.some((entry) =>
    /^indented shell comment$/u.test((entry.split('\n')[0] ?? '').trim()),
  );
  assert.equal(
    openedSection,
    false,
    'an indented code line must not open a section of its own',
  );
  assert.match(
    rendered,
    /# indented shell comment/u,
    'the leading # must survive; consuming it as heading syntax is the defect',
  );
  // An independent review found this fixture exhibited the OTHER half of the
  // harm while asserting nothing about it: the criterion read
  // `# indented shell comment pnpm verify`, the comment swallowing the command.
  // Surviving the heading parser is worthless if the item collapse then undoes
  // it, so assert the command is still on its own line.
  assert.doesNotMatch(
    contract.acceptance_criteria.join('\n'),
    /# indented shell comment pnpm verify/u,
    'the indented comment must not be collapsed onto the command it precedes',
  );
});

test('G22: a nested list item indented to four columns is held verbatim -- tabs and spaces alike', () => {
  // Disclosed by a third independent review as an undisclosed behaviour change:
  // making indentation column-aware means `\t- nested` now measures four
  // columns and is classed as indented code, where the space-only rule left it
  // to be flattened into the parent list item.
  //
  // This is NOT a tab-specific quirk, and that is the point of asserting both
  // halves below: a four-SPACE nested item already behaved this way before this
  // lane touched anything. Tab handling extended an existing rule consistently
  // rather than introducing a new class. `sectionItems` carries no
  // list-continuation context, so it cannot tell a nested bullet from a code
  // line -- and for a module whose contract is "verbatim", erring toward
  // preservation is the safe direction: the text survives intact, it is simply
  // not re-flowed. Narrowing it would require real list-nesting state, which is
  // a change of scope, not a fix. This test pins the behaviour so it is
  // specified rather than accidental.
  const build = (indent: string): string[] => {
    const description = [
      '## Objective',
      'ship the transport',
      '',
      '## Acceptance criteria',
      '- parent item',
      `${indent}- nested bullet`,
    ].join('\n');
    return buildTaskContract({
      identifier: 'UTV2-999969',
      title: 'Nested list item indentation',
      url: 'https://linear.app/unit-talk-v2/issue/UTV2-999969',
      description,
    }).acceptance_criteria;
  };

  const tabbed = build('\t');
  const spaced = build('    ');

  assert.ok(
    tabbed.includes('\t- nested bullet'),
    `a tab-indented nested item is held verbatim; got ${JSON.stringify(tabbed)}`,
  );
  assert.ok(
    spaced.includes('    - nested bullet'),
    `a four-space nested item is held verbatim; got ${JSON.stringify(spaced)}`,
  );
  assert.deepEqual(
    tabbed.map((item) => item.replace(/^\t/u, '')),
    spaced.map((item) => item.replace(/^ {4}/u, '')),
    'a tab and four spaces must classify identically -- if they diverge, the ' +
      'column rule has become a tab-specific special case',
  );
  // The content must survive either way. Loss, not re-flow, would be the defect.
  assert.ok(tabbed.join('\n').includes('nested bullet'));
});

/** Build a contract from a description and return one field, for guard tests. */
function contractFrom(description: string, issueId = 'UTV2-999970'): TaskContract {
  return buildTaskContract({
    identifier: issueId,
    title: 'Guard fixture',
    url: `https://linear.app/unit-talk-v2/issue/${issueId}`,
    description,
  }, '2026-08-25T00:00:00.000Z');
}

test('G29: an UNTERMINATED fenced block travels verbatim instead of being dropped', () => {
  // A fifth independent review found this line -- introduced by this lane, and
  // stated as a guarantee in both the code comment and this bundle -- covered by
  // nothing: deleting the terminal flush left every test green while the
  // unterminated block vanished from the work order entirely.
  //
  // The harm is the exact content-loss class this lane exists to close: the
  // review's measured case lost BOTH a guardrail comment and the destructive
  // command it forbade.
  const contract = contractFrom([
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- keep this',
    '```bash',
    '# NEVER run against production',
    'pnpm db:reset --force',
  ].join('\n'));

  const fenced = contract.acceptance_criteria.filter((item) => item.includes('```'));
  assert.equal(fenced.length, 1,
    'the unterminated fence must survive as its own item, not be dropped');
  assert.match(fenced[0]!, /# NEVER run against production/u,
    'the guardrail line inside an unterminated fence must reach the executor');
  assert.match(fenced[0]!, /pnpm db:reset --force/u,
    'and so must the command it forbids -- losing either is the defect this lane closes');
});

test('G30: a fence-looking line CARRYING AN INFO STRING does not close an open fence', () => {
  // CommonMark: a closing fence may not carry an info string. Without the rule
  // a ```sh line inside a block ends it, splitting one verbatim block into
  // three items and changing what the executor is told.
  const contract = contractFrom([
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '```',
    '# do not run in prod',
    '```sh',
    'pnpm destroy',
    '```',
  ].join('\n'));

  const fenced = contract.acceptance_criteria.filter((item) => item.includes('```'));
  assert.equal(fenced.length, 1,
    'an info-string line must not close the fence -- the block stays whole');
  assert.match(fenced[0]!, /# do not run in prod[\s\S]*pnpm destroy/u,
    'the guardrail and the command it guards must stay in the SAME block');
});

test('G31: a backtick fence whose info string contains a backtick does not open a fence', () => {
  // CommonMark forbids a backtick in a backtick fence's info string. Dropping
  // the guard makes an ordinary inline-code line open a block that then
  // swallows everything after it.
  //
  // The fence line must start at column 0 (FENCE_RE allows at most three
  // leading spaces). An earlier version of this test put the backticks inside a
  // list item, where FENCE_RE never matches at all -- so deleting the guard
  // produced byte-identical output and the test proved nothing.
  const contract = contractFrom([
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- first criterion',
    '``` `inline`',
    '- second criterion',
  ].join('\n'));

  assert.deepEqual(
    contract.acceptance_criteria,
    ['first criterion', '``` `inline`', 'second criterion'],
    'a line whose info string contains a backtick must not open a fence and swallow the rest',
  );
});

test('G32: a token containing a newline is REFUSED, not written into the curl config', () => {
  // Security control, introduced by this lane and previously covered by nothing.
  // curl --config reads directives line by line, so an unrefused newline in a
  // token value injects arbitrary curl directives -- an SSRF/exfiltration
  // primitive, not a formatting bug.
  let calls = 0;
  const runner = (() => {
    calls += 1;
    return { status: 0, stdout: '{}', stderr: '', error: undefined };
  }) as typeof spawnSync;

  assert.throws(
    () => fetchLinearTaskSource('UTV2-999971', 'good-token\n--output /tmp/pwned', runner),
    /invalid newline/u,
    'a newline in the token must fail closed',
  );
  assert.equal(calls, 0, 'and must refuse BEFORE curl is invoked at all');

  for (const bad of ['tok\ren', 'tok\r\nen', '\ntok']) {
    assert.throws(() => fetchLinearTaskSource('UTV2-999971', bad, runner), /invalid newline/u,
      `CR and LF alike must be refused (${JSON.stringify(bad)})`);
  }
  assert.equal(calls, 0);
});

test('G33: an invalid contract is REFUSED before it can be persisted to a sync record', () => {
  // buildSyncYmlWithTaskContract is the only writer of .ops/sync/<ID>.yml.
  // Without its assertTaskContract call an unvalidated object is written to
  // disk and every later reader inherits it -- a silent-corruption path, where
  // invariant 10 requires failing closed.
  const good = contractFrom('## Objective\nvalid\n\n## Acceptance criteria\n- ok', 'UTV2-999972');
  assert.doesNotThrow(() => buildSyncYmlWithTaskContract('UTV2-999972', good));

  const wrongIssue = { ...good, issue_id: 'UTV2-000000' } as TaskContract;
  assert.throws(() => buildSyncYmlWithTaskContract('UTV2-999972', wrongIssue),
    /identity mismatch/u,
    'a contract for a DIFFERENT issue must never be written into this issue record');

  const noHash = { ...good, contract_hash: '' } as TaskContract;
  assert.throws(() => buildSyncYmlWithTaskContract('UTV2-999972', noHash),
    /hash verification failed/u,
    'a contract with no integrity hash must be refused');

  // Tampering with the CONTENT while keeping a well-formed hash must also fail:
  // the hash is recomputed, not merely shape-checked.
  const tampered = { ...good, objective: 'do something else entirely' } as TaskContract;
  assert.throws(() => buildSyncYmlWithTaskContract('UTV2-999972', tampered),
    /hash verification failed/u,
    'a contract whose content no longer matches its hash must be refused');
});

test('G34: a sync record that parses to a non-object FAILS CLOSED instead of being corrupted', () => {
  // Without the guard a record parsing to a string or an array is spread into a
  // character-indexed object and written back, silently destroying the record
  // rather than refusing.
  const good = contractFrom('## Objective\nvalid\n\n## Acceptance criteria\n- ok', 'UTV2-999973');
  for (const malformed of ['just a bare string\n', '- one\n- two\n', '42\n']) {
    assert.throws(
      () => buildSyncYmlWithTaskContract('UTV2-999973', good, malformed),
      /malformed/u,
      `a record parsing to a non-object must be refused (${JSON.stringify(malformed)})`,
    );
  }
});

test('G35: an UNRECOGNIZED nested section renders once, inside its ancestor -- not twice', () => {
  // The third of three sibling suppressions. `sectionLines` (M1) and the
  // claimed-child subtraction (M2) each had a control; this one -- the
  // unrecognized-under-unrecognized case -- had none, so removing it repeated
  // the nested section verbatim in the prompt with every test green.
  const contract = contractFrom([
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- ok',
    '',
    '## Operator notes',
    'Read this first.',
    '',
    '### Production safety',
    'NEVER run a blanket UPDATE against production.',
  ].join('\n'), 'UTV2-999974');

  const occurrences = contract.unmapped_sections.filter((section) =>
    section.includes('NEVER run a blanket UPDATE against production.'));
  assert.equal(occurrences.length, 1,
    'the nested section must appear exactly once -- a surviving ancestor already carries it');
  assert.match(occurrences[0]!, /Operator notes/u,
    'and it must appear INSIDE that ancestor, not as a section of its own');
});

test('G38: a token containing a quote or backslash is ESCAPED into the curl config, not passed raw', () => {
  // The sixth review found the newline half of `curlConfigValue` covered by G32
  // and the ESCAPING half covered by nothing: replacing the body with
  // `return value` left both suites green. The token is interpolated into a
  // quoted curl directive (`header = "Authorization: ..."`), so an unescaped
  // quote terminates that value and everything after it is read by curl as
  // further directives -- the same injection primitive G32 refuses newlines for.
  let seen: string | undefined;
  const runner = ((_cmd: string, _args: string[], opts: { input?: string }) => {
    seen = opts.input;
    return { status: 0, stdout: '{"data":{"issue":null}}', stderr: '', error: undefined };
  }) as unknown as typeof spawnSync;

  try {
    fetchLinearTaskSource('UTV2-999982', 'tok"en\\with', runner);
  } catch {
    // The stub returns a null issue, so the call throws AFTER curl is invoked.
    // The assertion below is about what was handed to curl, not the outcome.
  }

  assert.ok(seen, 'curl must have been invoked with a config on stdin');
  assert.equal(
    seen,
    'header = "Authorization: tok\\"en\\\\with"\n',
    'both the quote and the backslash must arrive escaped',
  );
  // An earlier draft added a regex assertion for "no unescaped quote", which
  // matched the directive's own CLOSING quote and failed on correct output. The
  // byte-equality above is strictly stronger than any such regex, so it stands
  // alone rather than being propped up by a weaker, wronger companion.
});

test('G39: a shorter fence does not close a longer one', () => {
  // `fenceClosedBy` requires the closing marker to be at least as long as the
  // opener. Relaxing that to `>= 1` was uncovered: a ``` line inside a `````
  // block ended it early, splitting one criterion into three, with both suites
  // green.
  const contract = contractFrom([
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- first criterion',
    '`````',
    'inner',
    '```',
    'still inside',
    '`````',
    '- last criterion',
  ].join('\n'));

  assert.deepEqual(
    contract.acceptance_criteria,
    ['first criterion', '`````\ninner\n```\nstill inside\n`````', 'last criterion'],
    'the three-backtick line is fence CONTENT; only the five-backtick line closes',
  );
});

test('G40: a fence marker indented four columns is code, not a fence', () => {
  // CommonMark: four or more leading spaces is indented code, so FENCE_RE is
  // bounded at three. The bound is dead on the acceptance-criteria path (an
  // indented line is consumed before `fenceOpenedBy` is ever reached) and LIVE
  // in `parseSections`, which tests for a fence before it tests for a heading.
  // A first attempt at this control used a criteria-path fixture, where
  // widening the bound produces byte-identical output -- it would have proved
  // nothing. This fixture puts the indented marker in a section BODY, where
  // widening the bound swallows the heading that follows it.
  const contract = contractFrom([
    '## Objective',
    'run the thing',
    '',
    '    ```',
    '    indented code block',
    '',
    '## Acceptance criteria',
    '- first criterion',
    '- second criterion',
  ].join('\n'));

  assert.equal(
    contract.objective,
    'run the thing\n    ```\n    indented code block',
    'the indented block stays inside Objective and does not open a fence',
  );
  assert.deepEqual(
    contract.acceptance_criteria,
    ['first criterion', 'second criterion'],
    'the heading after the indented block must still be recognized as a heading',
  );
});

test('G42: a fence is closed only by its OWN character, not by the other fence char', () => {
  // The seventh review found G39 pinned only the LENGTH half of fenceClosedBy's
  // rule. The character half (`marker[0] === fence.char`) was killed by nothing:
  // replacing it with `true` let a ~~~ line close a ``` block, splitting one
  // criterion into three and swallowing the last one -- byte-for-byte the same
  // harm class G39 exists for.
  const contract = contractFrom([
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- first criterion',
    '```',
    'inner code',
    '~~~',
    'still inside',
    '```',
    '- last criterion',
  ].join('\n'));

  assert.deepEqual(
    contract.acceptance_criteria,
    ['first criterion', '```\ninner code\n~~~\nstill inside\n```', 'last criterion'],
    'the ~~~ line is fence CONTENT; only a ``` line closes a ``` fence',
  );
});

test('G43: a fence indented one to three columns is still a fence', () => {
  // G40 pins only the WIDENING direction of FENCE_RE's indentation bound.
  // NARROWING it to /^(...)/ survived the whole battery, and its harm is worse
  // than widening's: an indented fenced block -- the ordinary shape under a list
  // item -- stops being recognized, and its contents are DELETED from the work
  // order rather than merely re-grouped.
  const contract = contractFrom([
    '## Objective',
    'run the thing',
    '',
    '## Acceptance criteria',
    '- first criterion',
    '   ```',
    '   # do not run in prod',
    '   pnpm destroy',
    '   ```',
    '- last criterion',
  ].join('\n'));

  assert.deepEqual(
    contract.acceptance_criteria,
    [
      'first criterion',
      '   ```\n   # do not run in prod\n   pnpm destroy\n   ```',
      'last criterion',
    ],
    'a three-space-indented fence must be recognized, and nothing inside it may be dropped',
  );
  assert.ok(
    contract.acceptance_criteria.some((item) => item.includes('pnpm destroy')),
    'the fenced command must survive; narrowing the bound deletes it outright',
  );
});

test('G44: tilde fences are honoured, not only backtick fences', () => {
  // FENCE_RE's `~{3,}` alternation was dead as far as the battery could see:
  // removing it left both suites green. A tilde fence is the CommonMark escape
  // for a block that itself contains backticks, so a work order that uses one
  // is exactly the case where mis-parsing is most likely.
  const contract = contractFrom([
    '## Objective',
    'ship the transport',
    '',
    '## Acceptance criteria',
    '- first criterion',
    '~~~',
    'a fenced block containing ``` backticks',
    '~~~',
    '- last criterion',
  ].join('\n'));

  assert.deepEqual(
    contract.acceptance_criteria,
    [
      'first criterion',
      '~~~\na fenced block containing ``` backticks\n~~~',
      'last criterion',
    ],
    'a tilde fence must open and close like a backtick fence',
  );
});

test('G45/G46: readTaskContract refuses a wrong schema_version and an empty criteria list, each with ITS OWN refusal', () => {
  // Both guards were killed by nothing. They are reachable through the exported
  // `readTaskContract`, so under the second mutation a sync record with
  // `acceptance_criteria: []` dispatches as a valid work order with nothing to
  // satisfy.
  //
  // The assertions pin the SPECIFIC refusal message, not merely "it threw".
  // That is deliberate: tampering with the YAML also invalidates the contract
  // hash, so a mutant that drops one of these guards still throws -- from the
  // LATER hash check, with a different message. Asserting only `assert.throws`
  // would pass against both mutants and prove nothing.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1752-readcontract-'));
  const syncDir = path.join(root, '.ops', 'sync');
  fs.mkdirSync(syncDir, { recursive: true });
  const issueId = 'UTV2-999984';
  const contract = buildTaskContract({
    identifier: issueId,
    title: 'Guarded',
    url: 'https://linear.app/unit-talk/issue/x',
    description: '## Objective\nguard\n\n## Acceptance criteria\n- one',
  });
  const good = buildSyncYmlWithTaskContract(issueId, contract, null);
  const syncPath = path.join(syncDir, `${issueId}.yml`);

  // Baseline: the record as written is accepted, so neither refusal below can
  // be passing because the fixture is broken in some other way.
  fs.writeFileSync(syncPath, good, 'utf8');
  assert.deepEqual(readTaskContract(issueId, root), contract);

  fs.writeFileSync(syncPath, good.replace('schema_version: 1', 'schema_version: 2'), 'utf8');
  assert.throws(
    () => readTaskContract(issueId, root),
    /identity mismatch/u,
    'a wrong schema_version must be refused BY THE IDENTITY GUARD',
  );

  const emptied = good.replace(/ {2}acceptance_criteria:\n(?: {4}- .*\n)+/u, '  acceptance_criteria: []\n');
  assert.notEqual(emptied, good, 'fixture precondition: the criteria list must actually have been emptied');
  fs.writeFileSync(syncPath, emptied, 'utf8');
  assert.throws(
    () => readTaskContract(issueId, root),
    /is missing acceptance criteria/u,
    'an empty criteria list must be refused BY THE CRITERIA GUARD, not by a later hash check',
  );
});

// ---------------------------------------------------------------------------
// UTV2-1750: deterministic operational-skill routing + task-contract
// sufficiency. One positive AND one negative fixture per skill, an
// INSUFFICIENT_TASK_CONTRACT mutation battery (each sub-check proven to FAIL
// on the condition it names, not merely present), and a real production-lane
// fixture (UTV2-1736) proving nothing is lost or falsely routed.
// ---------------------------------------------------------------------------

/** A sufficient, otherwise-neutral contract: satisfies routing preconditions
 * without itself matching any of the four skill triggers. */
function skillFixtureContract(issueId: string, description: string): TaskContract {
  return buildTaskContract(
    {
      identifier: issueId,
      title: 'Fixture',
      url: `https://linear.app/unit-talk-v2/issue/${issueId}`,
      description,
    },
    '2000-01-01T00:00:00.000Z',
  );
}

const NEUTRAL_SUFFICIENT_TAIL = [
  '',
  '## Where to look',
  '- scripts/ops/execution-packet.ts',
  '',
  '## Exit criteria',
  '- the fixture is complete',
  '',
  '## Required evidence',
  '- focused tests pass',
].join('\n');

test('skill routing table stays the single source (four skills, stable slugs)', () => {
  const specs = skillRoutingSpecsForTest();
  assert.deepEqual(
    specs.map((s) => s.skill),
    ['/lane-recovery', '/pr-unblock', '/proof-authoring', '/mutation-test'],
    'skill routing must be driven from exactly this table -- a routing prose ' +
      'copy elsewhere (e.g. dispatch.md) that drifts from it is a defect in ' +
      'the copy, not in this table',
  );
});

test('DoD 6: an ordinary narrow implementation selects no operational skill', () => {
  // testTaskContract() is the default fixture used across this whole file --
  // an unremarkable, narrow implementation task. It must not accidentally
  // route to any of the four skills.
  const routing = deriveSkillRouting(testTaskContract());
  assert.deepEqual(routing.selected_skills, []);
  assert.match(routing.note, /No operational skill trigger matched/u);
});

test('positive: a ghost/stuck lane description routes to /lane-recovery', () => {
  const contract = skillFixtureContract(
    'UTV2-999830',
    [
      '## Objective',
      'Repair UTV2-888 -- the PR merged but the lane manifest is still in_progress.',
      '',
      '## Acceptance criteria',
      '- The ghost lane is reconciled to done.',
      '',
      '## Guardrails',
      'This is a merged-but-unclosed lane; do not re-run implementation.',
      NEUTRAL_SUFFICIENT_TAIL,
    ].join('\n'),
  );
  const routing = deriveSkillRouting(contract);
  assert.ok(
    routing.selected_skills.includes('/lane-recovery'),
    `expected /lane-recovery to be selected; got ${JSON.stringify(routing.selected_skills)}`,
  );
  assert.match(routing.reasons['/lane-recovery'] ?? '', /broken, ghosted, parked, or merged-but-unclosed/u);
});

test('negative: an ordinary bug fix does not route to /lane-recovery', () => {
  const contract = skillFixtureContract(
    'UTV2-999831',
    [
      '## Objective',
      'Fix an off-by-one error in the outbox retry counter.',
      '',
      '## Acceptance criteria',
      '- The retry counter increments correctly.',
      NEUTRAL_SUFFICIENT_TAIL,
    ].join('\n'),
  );
  const routing = deriveSkillRouting(contract);
  assert.ok(!routing.selected_skills.includes('/lane-recovery'));
});

test('positive: a merge-gate/head-binding mismatch routes to /pr-unblock', () => {
  const contract = skillFixtureContract(
    'UTV2-999832',
    [
      '## Objective',
      'The PR is BLOCKED: required-context Executor Result Validation is stuck pending on a stale head.',
      '',
      '## Acceptance criteria',
      '- The PR is unblocked and mergeable.',
      NEUTRAL_SUFFICIENT_TAIL,
    ].join('\n'),
  );
  const routing = deriveSkillRouting(contract);
  assert.ok(
    routing.selected_skills.includes('/pr-unblock'),
    `expected /pr-unblock to be selected; got ${JSON.stringify(routing.selected_skills)}`,
  );
});

test('negative: an ordinary bug fix does not route to /pr-unblock', () => {
  const contract = skillFixtureContract(
    'UTV2-999833',
    [
      '## Objective',
      'Add a missing null check in the CLV resolver.',
      '',
      '## Acceptance criteria',
      '- The resolver no longer throws on a null offer.',
      NEUTRAL_SUFFICIENT_TAIL,
    ].join('\n'),
  );
  const routing = deriveSkillRouting(contract);
  assert.ok(!routing.selected_skills.includes('/pr-unblock'));
});

test('positive: proof bundle creation/correction routes to /proof-authoring', () => {
  const contract = skillFixtureContract(
    'UTV2-999834',
    [
      '## Objective',
      'Correct the proof bundle for UTV2-1743: verification.md is missing the MERGE_SHA token.',
      '',
      '## Acceptance criteria',
      '- The proof bundle passes all three proof gates.',
      NEUTRAL_SUFFICIENT_TAIL,
    ].join('\n'),
  );
  const routing = deriveSkillRouting(contract);
  assert.ok(
    routing.selected_skills.includes('/proof-authoring'),
    `expected /proof-authoring to be selected; got ${JSON.stringify(routing.selected_skills)}`,
  );
});

test('negative: an ordinary bug fix does not route to /proof-authoring', () => {
  const contract = skillFixtureContract(
    'UTV2-999835',
    [
      '## Objective',
      'Rename an internal helper for clarity.',
      '',
      '## Acceptance criteria',
      '- The rename compiles and all call sites are updated.',
      NEUTRAL_SUFFICIENT_TAIL,
    ].join('\n'),
  );
  const routing = deriveSkillRouting(contract);
  assert.ok(!routing.selected_skills.includes('/proof-authoring'));
});

test('positive: a control claimed by tests routes to /mutation-test', () => {
  const contract = skillFixtureContract(
    'UTV2-999836',
    [
      '## Objective',
      'Prove the control in the substrate guard actually fails on the condition it names -- run a mutation test battery.',
      '',
      '## Acceptance criteria',
      '- Every claimed guard has a mutation that kills it.',
      NEUTRAL_SUFFICIENT_TAIL,
    ].join('\n'),
  );
  const routing = deriveSkillRouting(contract);
  assert.ok(
    routing.selected_skills.includes('/mutation-test'),
    `expected /mutation-test to be selected; got ${JSON.stringify(routing.selected_skills)}`,
  );
});

test('negative: an ordinary bug fix does not route to /mutation-test', () => {
  const contract = skillFixtureContract(
    'UTV2-999837',
    [
      '## Objective',
      'Add a new field to the daily digest output.',
      '',
      '## Acceptance criteria',
      '- The digest includes the new field.',
      NEUTRAL_SUFFICIENT_TAIL,
    ].join('\n'),
  );
  const routing = deriveSkillRouting(contract);
  assert.ok(!routing.selected_skills.includes('/mutation-test'));
});

test('DoD 7: multiple skills are selected when triggers genuinely overlap', () => {
  const contract = skillFixtureContract(
    'UTV2-999838',
    [
      '## Objective',
      'This ghost lane is merged-but-unclosed, and separately its PR is BLOCKED on a stale head-binding mismatch.',
      '',
      '## Acceptance criteria',
      '- The lane is reconciled and the PR unblocked.',
      NEUTRAL_SUFFICIENT_TAIL,
    ].join('\n'),
  );
  const routing = deriveSkillRouting(contract);
  assert.ok(routing.selected_skills.includes('/lane-recovery'));
  assert.ok(routing.selected_skills.includes('/pr-unblock'));
  assert.equal(routing.selected_skills.length, 2);
});

// --- INSUFFICIENT_TASK_CONTRACT: mutation battery ---------------------------
//
// Baseline first (per /mutation-test): a sufficient contract must pass. Each
// mutation below removes exactly one of the three required signals and
// asserts the refusal is the SPECIFIC missing key, not a generic failure --
// proving the check fails on the condition it names, not merely that it can
// fail.

const SUFFICIENT_DESCRIPTION = [
  '## Objective',
  'Implement the thing.',
  '',
  '## Acceptance criteria',
  '- The thing works.',
  '',
  '## Where to look',
  '- scripts/ops/fixture.ts',
  '',
  '## Exit criteria',
  '- The thing is merged.',
  '',
  '## Required evidence',
  '- Focused tests pass.',
].join('\n');

test('mutation baseline: a fully sufficient contract passes', () => {
  const contract = skillFixtureContract('UTV2-999840', SUFFICIENT_DESCRIPTION);
  assert.doesNotThrow(() => assertSufficientTaskContract(contract));
});

test('mutation 1: removing "Where to look" content fails closed on where_to_look only', () => {
  const description = [
    '## Objective', 'Implement the thing.', '',
    '## Acceptance criteria', '- The thing works.', '',
    '## Exit criteria', '- The thing is merged.', '',
    '## Required evidence', '- Focused tests pass.',
  ].join('\n');
  const contract = skillFixtureContract('UTV2-999841', description);
  let caught: unknown;
  try {
    assertSufficientTaskContract(contract);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof InsufficientTaskContractError, 'must throw InsufficientTaskContractError');
  assert.deepEqual((caught as InstanceType<typeof InsufficientTaskContractError>).missing, ['where_to_look']);
});

test('mutation 2: removing definition-of-done content fails closed on definition_of_done only', () => {
  const description = [
    '## Objective', 'Implement the thing.', '',
    '## Acceptance criteria', '- The thing works.', '',
    '## Where to look', '- scripts/ops/fixture.ts', '',
    '## Required evidence', '- Focused tests pass.',
  ].join('\n');
  const contract = skillFixtureContract('UTV2-999842', description);
  let caught: unknown;
  try {
    assertSufficientTaskContract(contract);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof InsufficientTaskContractError, 'must throw InsufficientTaskContractError');
  assert.deepEqual((caught as InstanceType<typeof InsufficientTaskContractError>).missing, ['definition_of_done']);
});

test('mutation 3: removing verification/self-check content fails closed on verification_self_check only', () => {
  const description = [
    '## Objective', 'Implement the thing.', '',
    '## Acceptance criteria', '- The thing works.', '',
    '## Where to look', '- scripts/ops/fixture.ts', '',
    '## Exit criteria', '- The thing is merged.',
  ].join('\n');
  const contract = skillFixtureContract('UTV2-999843', description);
  let caught: unknown;
  try {
    assertSufficientTaskContract(contract);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof InsufficientTaskContractError, 'must throw InsufficientTaskContractError');
  assert.deepEqual((caught as InstanceType<typeof InsufficientTaskContractError>).missing, ['verification_self_check']);
});

test('mutation 4: removing all three fails closed on all three, named together', () => {
  const description = [
    '## Objective', 'Implement the thing.', '',
    '## Acceptance criteria', '- The thing works.',
  ].join('\n');
  const contract = skillFixtureContract('UTV2-999844', description);
  let caught: unknown;
  try {
    assertSufficientTaskContract(contract);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof InsufficientTaskContractError, 'must throw InsufficientTaskContractError');
  assert.deepEqual((caught as InstanceType<typeof InsufficientTaskContractError>).missing, [
    'where_to_look',
    'definition_of_done',
    'verification_self_check',
  ]);
});

test('INSUFFICIENT_TASK_CONTRACT propagates through generateExecutionPacketResult with the missing list', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-insufficient-'));
  const syncDir = path.join(root, '.ops', 'sync');
  fs.mkdirSync(syncDir, { recursive: true });
  const issueId = 'UTV2-999845';
  const contract = skillFixtureContract(
    issueId,
    ['## Objective', 'Implement the thing.', '', '## Acceptance criteria', '- The thing works.'].join('\n'),
  );
  fs.writeFileSync(
    path.join(syncDir, `${issueId}.yml`),
    buildSyncYmlWithTaskContract(issueId, contract, undefined),
    'utf8',
  );
  const manifest = createTestManifest({ issue_id: issueId });
  const result = generateExecutionPacketResult(manifest, {}, undefined, root, {
    enforceSufficiency: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'INSUFFICIENT_TASK_CONTRACT');
    assert.deepEqual(result.missing, [
      'where_to_look',
      'definition_of_done',
      'verification_self_check',
    ]);
  }
});

test('sufficiency is opt-in: without enforceSufficiency the same insufficient contract still produces a packet', () => {
  // claude-exec.ts, codex-exec.ts, and lane-start.ts call these functions
  // directly against contracts predating this requirement and are out of this
  // lane's file scope -- enforcement defaults OFF so they are not broken by a
  // stricter default. Only the standalone CLI's main() turns it on, as the
  // preflight gate /dispatch's Phase 1.5 runs before any executor launches.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-insufficient-optin-'));
  const syncDir = path.join(root, '.ops', 'sync');
  fs.mkdirSync(syncDir, { recursive: true });
  const issueId = 'UTV2-999846';
  const contract = skillFixtureContract(
    issueId,
    ['## Objective', 'Implement the thing.', '', '## Acceptance criteria', '- The thing works.'].join('\n'),
  );
  fs.writeFileSync(
    path.join(syncDir, `${issueId}.yml`),
    buildSyncYmlWithTaskContract(issueId, contract, undefined),
    'utf8',
  );
  const manifest = createTestManifest({ issue_id: issueId });
  const result = generateExecutionPacketResult(manifest, {}, undefined, root);
  assert.equal(result.ok, true, `packet must still succeed with default options; got ${JSON.stringify(result)}`);
});

// --- UTV2-1736: a real, currently-active production migration lane ---------
//
// UTV2-1736 is a live Tier C migration lane (supabase/migrations/
// 20260824000000_x.sql) tracked elsewhere in this repo's merge-risk tests.
// This is a read-only fixture modeled on that lane's shape -- objective,
// constraints, an explicit mutation boundary, and proof requirements -- to
// prove the new sufficiency/routing logic does not truncate, corrupt, or
// falsely reroute a real production-tier work order. This lane's own branch,
// worktree, and manifest are never touched by this test.

const UTV2_1736_DESCRIPTION = [
  '## Objective',
  'Apply the pending schema migration 20260824000000_x.sql to add the settlement audit column.',
  '',
  '## Acceptance criteria',
  '- The migration applies cleanly against a staging clone.',
  '- No existing row is mutated by the migration itself.',
  '',
  '## Constraints',
  '- This is a Tier C migration lane and remains singleton for the duration of execution.',
  '- No other Tier C lane may execute concurrently against the same migration file.',
  '',
  '## Mutation boundary',
  'No production DDL beyond the single declared migration file. No backfill, no data mutation,',
  'no ingestion restart, no delivery activation. Any scope beyond the declared file requires a',
  'new lane, not an expansion of this one.',
  '',
  '## Where to look',
  '- supabase/migrations/20260824000000_x.sql',
  '- packages/db/src/database.types.ts',
  '',
  '## Exit criteria',
  '- Migration is applied and pnpm supabase:types is regenerated.',
  '',
  '## Required evidence',
  '- pnpm test:db pass',
  '- Migration dry-run diff attached to the proof bundle',
].join('\n');

test('UTV2-1736 fixture: objective, constraints, mutation boundary, and proof requirements all survive', () => {
  const contract = skillFixtureContract('UTV2-1736', UTV2_1736_DESCRIPTION);
  assert.doesNotThrow(() => assertSufficientTaskContract(contract));

  const fullText = taskContractFullText(contract);
  for (const mustSurvive of [
    'Apply the pending schema migration 20260824000000_x.sql',
    'remains singleton for the duration of execution',
    'No production DDL beyond the single declared migration file',
    'no ingestion restart, no delivery activation',
    'pnpm test:db pass',
    'Migration dry-run diff attached to the proof bundle',
  ]) {
    assert.ok(
      fullText.includes(mustSurvive),
      `production lane content must survive verbatim: ${JSON.stringify(mustSurvive)}`,
    );
  }

  const rendered = renderTaskContract(contract);
  assert.match(rendered, /No production DDL beyond the single declared migration file/u,
    'the mutation boundary must reach the rendered prompt, not only the structured contract');
});

test('UTV2-1736 fixture does not falsely trigger any of the four operational skills', () => {
  const contract = skillFixtureContract('UTV2-1736', UTV2_1736_DESCRIPTION);
  const routing = deriveSkillRouting(contract);
  assert.deepEqual(
    routing.selected_skills,
    [],
    `a routine (if high-stakes) migration lane must not falsely route; got ${JSON.stringify(routing.selected_skills)}`,
  );
  assert.match(routing.note, /No operational skill trigger matched/u);
});

// ---------------------------------------------------------------------------
// UTV2-1837 — tracker independence in delegation.
//
// The observed live failure this closes: `ops:lane-start UTV2-1833` aborted with
// `failed to capture Linear task contract: spawnSync curl ETIMEDOUT`. Nothing
// about that work needed the tracker; a timeout on a metadata fetch stopped it.
// A repo-authored work order is now a first-class source with the SAME required
// shape, so a first capture needs no API and no credential.
// ---------------------------------------------------------------------------

const workOrderFixture = `# Make the widget idempotent

## Objective
- Re-running the widget must not double-apply.

## Acceptance Criteria
- A second run is a no-op.
- The no-op is observable in the result payload.

## Guardrails
- Do not change the widget's public signature.

## Non-Goals
- Performance work.

## Required Evidence
- A test that fails before the change.

## Exit Criteria
- pnpm test green.
`;

test('UTV2-1837: readLocalTaskSource returns null when there is no local work order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1837-none-'));
  try {
    assert.equal(readLocalTaskSource('WORK-1', { root }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1837: a conventional .ops/work/<ID>.md is read as the task source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1837-conv-'));
  try {
    fs.mkdirSync(path.join(root, '.ops', 'work'), { recursive: true });
    fs.writeFileSync(localTaskSourcePath('WORK-1', root), workOrderFixture, 'utf8');
    const source = readLocalTaskSource('WORK-1', { root });
    assert.ok(source);
    assert.equal(source.identifier, 'WORK-1');
    assert.equal(source.title, 'Make the widget idempotent');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1837: an explicit --description outranks the conventional file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1837-prec-'));
  try {
    fs.mkdirSync(path.join(root, '.ops', 'work'), { recursive: true });
    fs.writeFileSync(localTaskSourcePath('WORK-1', root), workOrderFixture, 'utf8');
    const source = readLocalTaskSource('WORK-1', {
      root,
      description: '# Explicit wins\n\n## Objective\n- Explicit.\n',
    });
    assert.equal(source?.title, 'Explicit wins');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1837: a local contract parses into the SAME required shape as a captured one', () => {
  const source = readLocalTaskSource('WORK-1', {
    root: os.tmpdir(),
    description: workOrderFixture,
  });
  assert.ok(source);
  const contract = buildTaskContract(source, '2026-09-06T00:00:00.000Z', 'local-description');
  assert.equal(contract.source.kind, 'local-description');
  assert.equal(contract.objective, 'Re-running the widget must not double-apply.');
  assert.equal(contract.acceptance_criteria.length, 2);
  assert.equal(contract.guardrails.length, 1);
  assert.equal(contract.exit_criteria.length, 1);
});

test('UTV2-1837: assertTaskContract accepts local-description and still verifies the hash', () => {
  const source = readLocalTaskSource('WORK-1', {
    root: os.tmpdir(),
    description: workOrderFixture,
  });
  const contract = buildTaskContract(source!, '2026-09-06T00:00:00.000Z', 'local-description');
  assert.doesNotThrow(() => assertTaskContract(contract, 'WORK-1'));

  // The integrity bar is unchanged: tampering with the description without
  // re-hashing must still be refused for a local contract, exactly as for a
  // captured one.
  const tampered = {
    ...contract,
    source: { ...contract.source, description: `${contract.source.description}\nextra` },
  };
  assert.throws(() => assertTaskContract(tampered, 'WORK-1'), /source hash verification failed/u);
});

test('UTV2-1837 AC4 inversion: an unknown source kind is still refused', () => {
  const source = readLocalTaskSource('WORK-1', {
    root: os.tmpdir(),
    description: workOrderFixture,
  });
  const contract = buildTaskContract(source!, '2026-09-06T00:00:00.000Z', 'local-description');
  const bogus = { ...contract, source: { ...contract.source, kind: 'invented-kind' } };
  assert.throws(() => assertTaskContract(bogus, 'WORK-1'), /valid source snapshot/u);
});

test('UTV2-1837: captureOrReadTaskContract needs neither a credential nor the network', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1837-cap-'));
  try {
    fs.mkdirSync(path.join(root, '.ops', 'work'), { recursive: true });
    fs.writeFileSync(localTaskSourcePath('WORK-1', root), workOrderFixture, 'utf8');
    const runner = (): never => {
      throw new Error('the tracker must not be contacted when a local work order exists');
    };
    const contract = captureOrReadTaskContract('WORK-1', '', root, runner as never);
    assert.equal(contract.source.kind, 'local-description');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1837 AC4 inversion: with no local work order the tracker is still consulted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1837-fall-'));
  try {
    let contacted = false;
    const runner = ((): never => {
      contacted = true;
      throw new Error('contacted');
    }) as never;
    assert.throws(() => captureOrReadTaskContract('UTV2-1837', 'tok', root, runner));
    assert.equal(contacted, true, 'the local source must not silently replace the tracker');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
