import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertExecutionPacketCwd,
  assertTaskContract,
  buildSyncYmlWithTaskContract,
  buildTaskContract,
  generateExecutionPacket as generateExecutionPacketRaw,
  generateExecutionPacketResult,
  PREAMBLE_KEY,
  readTaskContract,
  renderTaskContract,
  TaskContractError,
} from './execution-packet.js';
import { ROOT, type LaneManifest } from './shared.js';

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
    description: `## Objective\n${objective}\n\n## Acceptance criteria\n- the CLI emits a packet`,
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
