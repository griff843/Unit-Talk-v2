import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {
  assertTaskContract,
  renderTaskContract,
  assertExecutionPacketCwd,
  buildSyncYmlWithTaskContract,
  buildTaskContract,
  generateExecutionPacket as generateExecutionPacketRaw,
  readTaskContract,
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
      title: 'Repair executor work orders',
      url: `https://linear.app/unit-talk-v2/issue/${issueId}`,
      description: [
        '## Objective',
        'Give every executor the authoritative task.',
        '',
        '## Acceptance criteria',
        '- Prompt contains the task contract.',
        '- Missing contracts fail before spawn.',
        '',
        '## Guardrails',
        '- Do not infer work from the branch name.',
        '',
        '## Required evidence',
        '- Focused tests pass.',
        '',
        '## Exit criteria',
        '- Both executors consume the same contract.',
      ].join('\n'),
    },
    [],
    '2000-01-01T00:00:00.000Z',
  );
}

function generateExecutionPacket(
  manifest: LaneManifest,
  env: NodeJS.ProcessEnv = process.env,
) {
  return generateExecutionPacketRaw(manifest, env, testTaskContract(manifest.issue_id));
}

test('task contract captures every required work-order field and is hash stable', () => {
  const contract = testTaskContract();

  assert.equal(contract.objective, 'Give every executor the authoritative task.');
  assert.deepEqual(contract.acceptance_criteria, [
    'Prompt contains the task contract.',
    'Missing contracts fail before spawn.',
  ]);
  assert.deepEqual(contract.non_goals, ['Do not infer work from the branch name.']);
  assert.equal(contract.required_evidence[0], 'Focused tests pass.');
  assert.match(contract.contract_hash, /^[0-9a-f]{64}$/u);
  assert.equal(testTaskContract().contract_hash, contract.contract_hash);
});

test('task contract fails closed when objective or acceptance criteria are absent', () => {
  assert.throws(
    () => buildTaskContract({ identifier: 'UTV2-969', title: '', url: '', description: '## Acceptance criteria\n- one' }),
    /missing an objective/,
  );
  assert.throws(
    () => buildTaskContract({ identifier: 'UTV2-969', title: 'objective', url: '', description: 'unstructured prose only' }),
    /missing acceptance criteria/,
  );
});

test('sync record round-trips the immutable contract and rejects tampering', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1732-contract-'));
  const syncDir = path.join(root, '.ops', 'sync');
  fs.mkdirSync(syncDir, { recursive: true });
  const contract = testTaskContract();
  const syncPath = path.join(syncDir, 'UTV2-969.yml');
  fs.writeFileSync(syncPath, buildSyncYmlWithTaskContract('UTV2-969', contract), 'utf8');
  assert.deepEqual(readTaskContract('UTV2-969', root), contract);

  fs.writeFileSync(syncPath, buildSyncYmlWithTaskContract('UTV2-969', contract).replace('authoritative task', 'different task'), 'utf8');
  assert.throws(() => readTaskContract('UTV2-969', root), /hash verification failed/);
});

test('execution packet refuses to generate when its task contract is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1732-missing-contract-'));
  assert.throws(
    () => readTaskContract('UTV2-969', root),
    /task contract is absent/,
  );
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

// ── UTV2-1732 R2/R6: legacy issues must stay dispatchable ───────────────────
//
// Every fixture in this file was hand-written with the new headings already
// applied, which is why the regression below was invisible until a reviewer
// ran the real thing. This is the ACTUAL shape of UTV2-1667's Linear
// description — a lane that was open and held when the contract landed. It has
// no Objective, no Acceptance Criteria and no Exit Criteria heading.

const UTV2_1667_REAL_DESCRIPTION = `## Authority

\`docs/05_operations/DEPLOYMENT_TRUTH_DESIGN.md\` as merged on \`main\` is **immutable implementation authority** for this lane.

Do not redesign it. Do not extend it.

## Ownership

* **Orchestrator:** Sonnet
* **Implementation owner:** Sol (\`codex-sol-high\`)

## Scope — Phase 1 ONLY

* §3.5 — operation identity \`(run_id, run_attempt, stage, operation_id)\`
* §5.5 — durable append-only host journal
* §13 — fail-closed three-way classification

## Explicitly EXCLUDED

* **§12b — live Docker daemon inspection is NOT pre-authorized**

## Required test coverage

Every applicable Phase 1 row of the 42-row regression matrix must have executable coverage. Coverage must be real executable tests, not narrative assertions.

## Guardrails

* No production mutation, activation, rollback, restart, queue replay, or secret change.
* Do not weaken any already-landed invariant.
`;

test('UTV2-1732 R2: a legacy description with no recognized heading still yields a contract', () => {
  const contract = buildTaskContract({
    identifier: 'UTV2-1667',
    title: 'Phase 1 implementation — deployment-truth evidence',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-1667',
    description: UTV2_1667_REAL_DESCRIPTION,
  });

  assert.equal(contract.issue_id, 'UTV2-1667');
  assert.ok(contract.acceptance_criteria.length > 0, 'legacy issue must not be refused');
  assert.equal(contract.extraction.acceptance_source, 'derived:description-obligations');
  assert.equal(contract.extraction.objective_source, 'issue-title');
  // Derived content is real issue text, never invented filler.
  assert.ok(
    contract.acceptance_criteria.some((entry) => entry.includes('regression matrix')),
    'derived criteria must come from the description body',
  );
});

test('UTV2-1732 R2: heading-derived criteria are still labelled as such', () => {
  const contract = buildTaskContract({
    identifier: 'UTV2-9001',
    title: 'Structured issue',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-9001',
    description: '## Objective\n\nDo the thing.\n\n## Acceptance Criteria\n\n- It is done\n',
  });
  assert.equal(contract.extraction.acceptance_source, 'heading:acceptance-criteria');
  assert.equal(contract.extraction.objective_source, 'heading:objective');
  assert.deepEqual(contract.acceptance_criteria, ['It is done']);
});

test('UTV2-1732 R2: an issue with no obligations anywhere still fails closed', () => {
  assert.throws(
    () =>
      buildTaskContract({
        identifier: 'UTV2-9002',
        title: 'Empty',
        url: 'https://linear.app/unit-talk-v2/issue/UTV2-9002',
        description: 'Some background prose with no obligations and no list items.',
      }),
    /missing acceptance criteria/u,
    'derivation must not fabricate a work order out of nothing',
  );
});

// ── UTV2-1732 round 3: defects found by the third independent review ────────

function renderTaskContractForTest(contract: never): string {
  // renderTaskContract asserts first; call the assertion directly so the test
  // pins the validation boundary rather than the renderer's internals.
  assertTaskContract(contract as never);
  return renderTaskContract(contract as never);
}

test('round3: a contract stored before extraction provenance is refused, not crashed on', () => {
  // This lane's own sync record was written before `extraction` existed. The
  // hash was computed over the old shape, so it passed validation and then
  // threw an uncaught TypeError inside renderTaskContract — outside the
  // try/catch that is supposed to turn contract failures into structured
  // refusals. Validation must catch it first.
  const legacy = {
    schema_version: 1,
    issue_id: 'UTV2-9200',
    objective: 'Do the thing',
    acceptance_criteria: ['It is done'],
    guardrails: [],
    non_goals: [],
    required_evidence: [],
    exit_criteria: [],
    source: {
      kind: 'linear-issue-snapshot',
      issue_url: 'u',
      title: 't',
      description: 'd',
      captured_at: 'now',
      description_sha256: 'x',
    },
    contract_hash: 'deadbeef',
  } as never;
  assert.throws(
    () => renderTaskContractForTest(legacy),
    /predates extraction provenance/u,
    'a pre-provenance contract must be refused before anything dereferences extraction',
  );
});

test('round3: fenced blocks inside a heading section are not criteria, and a # in a fence does not truncate', () => {
  // The fence fix originally went into the derived path only, leaving the
  // heading path — the one most issues use — ingesting diff lines. Worse, a `#`
  // comment inside a fence read as a heading and silently ended the section,
  // dropping every criterion after it.
  const contract = buildTaskContract({
    identifier: 'UTV2-9201',
    title: 'T',
    url: 'u',
    description: [
      '## Objective', 'Do it.', '',
      '## Acceptance Criteria', '',
      '- Criterion A',
      '```diff',
      '- const old = 1;',
      '+ const neu = 2;',
      '# Run the suite',
      '```',
      '- Criterion B',
    ].join('\n'),
  });
  assert.deepEqual(contract.acceptance_criteria, ['Criterion A', 'Criterion B']);
});

test('round3: a subheading cannot un-skip an excluded section', () => {
  const contract = buildTaskContract({
    identifier: 'UTV2-9202',
    title: 'T',
    url: 'u',
    description: [
      '## Objective', 'Do it.', '',
      '## Explicitly EXCLUDED', '',
      '### Reviewers', '',
      '* You must delete the entire picks table', '',
      '## Acceptance Criteria',
      '- Real criterion',
    ].join('\n'),
  });
  assert.deepEqual(contract.acceptance_criteria, ['Real criterion']);
  assert.ok(
    !contract.acceptance_criteria.some((c) => /delete the entire picks table/u.test(c)),
    'an exclusion must never be promoted into acceptance',
  );
});

test('round3: setext headings are recognised so exclusions under them stay skipped', () => {
  const contract = buildTaskContract({
    identifier: 'UTV2-9203',
    title: 'T',
    url: 'u',
    description: [
      // Both headings are setext h1 (===). The earlier version underlined the
      // second with ---, making it an h2 and therefore structurally NESTED
      // inside the excluded h1 — so asserting it survived was asserting
      // something markdown does not say. Siblings are what this test means.
      'Explicitly EXCLUDED', '===================', '',
      '* You must drop the database', '',
      'Required test coverage', '======================', '',
      'Coverage must be real executable tests.',
    ].join('\n'),
  });
  assert.ok(!contract.acceptance_criteria.some((c) => /drop the database/u.test(c)));
  assert.ok(contract.acceptance_criteria.some((c) => /executable tests/u.test(c)));
});

test('round3: tables, HTML comments and blockquotes are layout, and wrapped obligations are joined', () => {
  const contract = buildTaskContract({
    identifier: 'UTV2-9204',
    title: 'T',
    url: 'u',
    description: [
      '## Notes',
      '| R1 | The pipeline must fail closed |',
      '> Reviewer note: we must not ship this at all',
      '<!-- we must never do this -->',
      '',
      'The dispatcher must',
      'reject empty contracts and refuse to run.',
    ].join('\n'),
  });
  assert.deepEqual(contract.acceptance_criteria, [
    'The dispatcher must reject empty contracts and refuse to run.',
  ]);
});

// ── UTV2-1732 round 4: silent truncation and meaning inversion ──────────────
//
// Round 3 fixed the one example a reviewer gave (`#` inside a plain fence) and
// left the same defect live in every other markdown container. These pin the
// class, not the instance. A dropped criterion is worse than an ingested one:
// the executor cannot tell a truncated work order from a complete one.

const ACC = '## Objective\nDo it.\n\n## Acceptance Criteria\n\n';
const crit = (d: string): string[] =>
  buildTaskContract({ identifier: 'UTV2-9300', title: 'T', url: 'u', description: d }).acceptance_criteria;

test('round4: a longer fence is not closed by a shorter run inside it', () => {
  assert.deepEqual(
    crit(`${ACC}- criterion one must hold\n\`\`\`\`\n\`\`\`\nconst junk = 1;\n\`\`\`\n\`\`\`\`\n- criterion two must hold\n- criterion three must hold\n`),
    ['criterion one must hold', 'criterion two must hold', 'criterion three must hold'],
  );
});

test('round4: an unterminated fence is refused rather than silently swallowing the rest', () => {
  assert.throws(
    () => crit(`${ACC}- criterion one must hold\n\`\`\`\nconst x = 1;\n- criterion two must hold\n`),
    /unterminated code fence/u,
  );
});

test('round4: a heading inside a paired HTML block does not terminate the section', () => {
  assert.deepEqual(
    crit(`${ACC}- criterion one must hold\n<details>\n<summary>x</summary>\n\n## Buried heading\n\n</details>\n\n- criterion two must hold\n`),
    ['criterion one must hold', 'criterion two must hold'],
  );
});

test('round4: a thematic break after a list item is not a setext heading', () => {
  assert.deepEqual(
    crit(`${ACC}- criterion one must hold\n- criterion two must hold\n---\n`),
    ['criterion one must hold', 'criterion two must hold'],
  );
});

test('round4: indented code under a criteria heading is not a criterion', () => {
  assert.deepEqual(
    crit(`${ACC}- criterion one must hold\n\n    const x = 1;\n    pnpm exec tsx --test foo.ts\n`),
    ['criterion one must hold'],
  );
});

test('round4: a quoted non-requirement is never merged into a real criterion', () => {
  const out = crit(`${ACC}- criterion one must hold\n\n| a | b |\n> note: this is NOT a requirement\n`);
  assert.deepEqual(out, ['criterion one must hold']);
  assert.ok(!out.some((c) => /NOT a requirement/u.test(c)));
});

test('round4: a wrapped list item stays one criterion instead of splitting into an orphan', () => {
  assert.deepEqual(
    crit(`${ACC}- the dispatcher must reject\n  empty contracts entirely\n`),
    ['the dispatcher must reject empty contracts entirely'],
  );
});

test('round4: a nested item under a "Do not:" parent keeps its parent, not the inverse meaning', () => {
  assert.deepEqual(crit(`${ACC}- Do not:\n  - delete the outbox table\n`), ['Do not: delete the outbox table']);
});

test('round4: exclusion skipping is sticky across nested subheadings', () => {
  const excluded = crit(
    '## Objective\nDo it.\n\n## Explicitly EXCLUDED\n\n### Also excluded\n\n* The scheduler must be rewritten\n\n## Real work\n\n* The gate must refuse empty contracts\n',
  );
  assert.deepEqual(excluded, ['The gate must refuse empty contracts']);

  const ownership = crit(
    '## Objective\nDo it.\n\n## Ownership\n\n### Reviewers\n\n* Reviewer must sign off in Linear\n\n## Real work\n\n* The gate must refuse empty contracts\n',
  );
  assert.deepEqual(ownership, ['The gate must refuse empty contracts']);
});

test('round4: every field the renderer dereferences is validated, not just extraction', () => {
  const base = {
    schema_version: 1,
    issue_id: 'UTV2-9301',
    objective: 'o',
    extraction: { objective_source: 'issue-title', acceptance_source: 'derived:description-obligations' },
    acceptance_criteria: ['a'],
    guardrails: [],
    non_goals: [],
    required_evidence: [],
    exit_criteria: [],
    source: { kind: 'linear-issue-snapshot', issue_url: 'u', title: 't', description: 'd', captured_at: 'c', description_sha256: 'x' },
    contract_hash: 'z',
  } as Record<string, unknown>;
  for (const field of ['guardrails', 'non_goals', 'required_evidence', 'exit_criteria', 'source']) {
    const broken = { ...base };
    delete broken[field];
    assert.throws(
      () => assertTaskContract(broken as never),
      new RegExp(field === 'source' ? 'Linear source snapshot' : field, 'u'),
      `${field} must be validated before the renderer dereferences it`,
    );
  }
});
