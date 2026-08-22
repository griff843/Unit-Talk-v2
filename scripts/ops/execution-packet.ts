import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
} from '@unit-talk/db/target-identity';
import { assertStagingTarget } from '../ci/assert-staging-target.js';
import { validateExecutionCwd } from './lane-execution.js';
import {
  ROOT,
  emitJson,
  parseArgs,
  readManifest,
  type LaneManifest,
} from './shared.js';

export interface ExecutionPacket {
  issue_id: string;
  title: string;
  project: string;
  tier: string;
  lane_type: string;
  branch: string;
  execution_location: string;
  cwd: string;
  cwd_guard_command: string;
  worktree_entrypoint: string;
  dependency_setup: {
    package_install: string;
    setup_command: string | null;
    main_checkout_control_only: boolean;
  };
  allowed_file_scope: string[];
  tier_c_warnings: string[];
  blockers: string[];
  task_contract: TaskContract;
  required_verification: string[];
  verification_plan?: VerificationPlan;
  expected_proof_paths: string[];
  closeout_instructions: string[];
  repo_brief: string;
  source_of_truth: {
    linear_url: string;
    branch: string;
    manifest_path: string;
  };
  generated_at: string;
}

export interface LinearTaskSource {
  identifier: string;
  title: string;
  url: string;
  description: string;
}

export interface TaskContract {
  schema_version: 1;
  issue_id: string;
  objective: string;
  acceptance_criteria: string[];
  guardrails: string[];
  non_goals: string[];
  required_evidence: string[];
  exit_criteria: string[];
  source: {
    kind: 'linear-issue-snapshot';
    issue_url: string;
    title: string;
    description: string;
    captured_at: string;
    description_sha256: string;
  };
  contract_hash: string;
}

export interface VerificationPlan {
  mode: 'static-only' | 'writable-isolated' | 'production-read-only';
  static_command: 'pnpm verify:static';
  focused_test_command: string;
  live_db_status: 'authorized-isolated' | 'blocked-deferred' | 'read-only-only';
  writable_live_db_command: string | null;
  production_read_only_guard_command: string | null;
  reason: string;
}

const TEST_TIMESTAMP = '2000-01-01T00:00:00.000Z';

const EXECUTION_LOCATION_MAP: Record<string, string> = {
  claude: 'Claude Code (interactive)',
  'codex-cli': 'Codex CLI (autonomous)',
  'codex-cloud': 'Codex Cloud (autonomous)',
};

const TIER_VERIFICATION_MAP: Record<string, string[]> = {
  T1: ['type-check', 'test', 'test:db', 'runtime-proof', 'evidence-bundle'],
  T2: ['type-check', 'test', 'issue-specific verification'],
  T3: ['type-check', 'test'],
};

export function generateExecutionPacket(
  manifest: LaneManifest,
  env: NodeJS.ProcessEnv = process.env,
  suppliedTaskContract?: TaskContract,
): ExecutionPacket {
  const issueId = manifest.issue_id;
  const tier = manifest.tier ?? 'unknown';
  const expectedProofPaths = manifest.expected_proof_paths ?? [];
  const verificationPlan = buildVerificationPlan(manifest, env);
  const taskContract = suppliedTaskContract ?? readTaskContract(issueId);
  assertTaskContract(taskContract, issueId);
  if (manifest.task_packet_hash && manifest.task_packet_hash !== taskContract.contract_hash) {
    throw new Error(
      `task contract hash does not match manifest task_packet_hash for ${issueId}; refusing mutable work-order drift`,
    );
  }

  return {
    issue_id: issueId,
    title: issueId,
    project: 'Unit Talk V2',
    tier,
    lane_type: manifest.lane_type ?? 'unknown',
    branch: manifest.branch,
    execution_location: deriveExecutionLocation(manifest.executor),
    cwd: manifest.execution_location?.cwd ?? manifest.worktree_path,
    cwd_guard_command: `cd "${manifest.execution_location?.cwd ?? manifest.worktree_path}"`,
    worktree_entrypoint: `cd "${manifest.execution_location?.cwd ?? manifest.worktree_path}" && pnpm install --frozen-lockfile`,
    dependency_setup: {
      package_install:
        manifest.execution_location?.package_install ?? 'required',
      setup_command:
        manifest.execution_location?.setup_command ??
        'pnpm install --frozen-lockfile',
      main_checkout_control_only:
        manifest.execution_location?.main_checkout_control_only ?? true,
    },
    allowed_file_scope: [...(manifest.file_scope_lock ?? [])],
    tier_c_warnings: collectTierCWarnings(manifest.file_scope_lock ?? []),
    blockers: [...(manifest.blocked_by ?? [])],
    task_contract: taskContract,
    required_verification: buildRequiredVerification(tier, expectedProofPaths),
    verification_plan: verificationPlan,
    expected_proof_paths: [...expectedProofPaths],
    closeout_instructions: buildCloseoutInstructions(
      issueId,
      tier,
      verificationPlan,
    ),
    repo_brief: loadRepoBrief(),
    source_of_truth: {
      linear_url: `https://linear.app/unit-talk-v2/issue/${issueId}`,
      branch: manifest.branch,
      manifest_path: `docs/06_status/lanes/${issueId}.json`,
    },
    generated_at: packetTimestamp(),
  };
}

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ').trim();
}

function sectionBody(markdown: string, headings: string[]): string {
  const wanted = new Set(headings.map(normalizeHeading));
  const lines = markdown.split(/\r?\n/);
  let collecting = false;
  const body: string[] = [];
  for (const line of lines) {
    const heading = /^#{1,6}\s+(.+?)\s*$/u.exec(line);
    if (heading) {
      if (collecting) break;
      collecting = wanted.has(normalizeHeading(heading[1] ?? ''));
      continue;
    }
    if (collecting) body.push(line);
  }
  return body.join('\n').trim();
}

function sectionItems(markdown: string, headings: string[]): string[] {
  const body = sectionBody(markdown, headings);
  if (!body) return [];
  const items: string[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    const value = paragraph.join(' ').trim();
    if (value) items.push(value);
    paragraph = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const listItem = /^\s*(?:[-*+] |\d+[.)]\s+)(.*)$/u.exec(line);
    if (listItem) {
      flush();
      if (listItem[1]?.trim()) items.push(listItem[1].trim());
    } else if (!line.trim()) {
      flush();
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return items;
}

function taskContractHash(contract: Omit<TaskContract, 'contract_hash'>): string {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

export function buildTaskContract(
  source: LinearTaskSource,
  expectedProofPaths: string[] = [],
  capturedAt = packetTimestamp(),
): TaskContract {
  const issueId = source.identifier.trim().toUpperCase();
  const description = source.description.trim();
  const objectiveSection = sectionBody(description, ['objective', 'required outcome']);
  const objective = objectiveSection || source.title.trim();
  const acceptanceCriteria = sectionItems(description, ['acceptance criteria', 'acceptance criterion']);
  const exitCriteria = sectionItems(description, ['exit criteria']);
  const requiredOutcome = sectionItems(description, ['required outcome']);
  const effectiveAcceptance = acceptanceCriteria.length > 0
    ? acceptanceCriteria
    : exitCriteria.length > 0
      ? exitCriteria
      : requiredOutcome;

  if (!objective) {
    throw new Error(`task contract for ${issueId || '(unknown issue)'} is missing an objective`);
  }
  if (effectiveAcceptance.length === 0) {
    throw new Error(`task contract for ${issueId || '(unknown issue)'} is missing acceptance criteria`);
  }

  const guardrails = sectionItems(description, ['guardrails']);
  const explicitNonGoals = sectionItems(description, ['non goals', 'non-goals', 'out of scope']);
  const nonGoals = explicitNonGoals.length > 0
    ? explicitNonGoals
    : guardrails.filter((entry) => /\b(?:do not|must not|never|no direct)\b/iu.test(entry));
  const explicitEvidence = sectionItems(description, ['required evidence', 'evidence']);
  const requiredEvidence = [
    ...explicitEvidence,
    ...expectedProofPaths.map((proofPath) => `Produce and validate ${proofPath}`),
  ];
  if (requiredEvidence.length === 0) {
    requiredEvidence.push(...effectiveAcceptance.filter((entry) => /\b(?:proof|evidence|test|review|verify|verification)\b/iu.test(entry)));
  }

  const content: Omit<TaskContract, 'contract_hash'> = {
    schema_version: 1,
    issue_id: issueId,
    objective,
    acceptance_criteria: effectiveAcceptance,
    guardrails,
    non_goals: nonGoals,
    required_evidence: requiredEvidence,
    exit_criteria: exitCriteria.length > 0 ? exitCriteria : effectiveAcceptance,
    source: {
      kind: 'linear-issue-snapshot',
      issue_url: source.url,
      title: source.title.trim(),
      description,
      captured_at: capturedAt,
      description_sha256: createHash('sha256').update(description).digest('hex'),
    },
  };
  return { ...content, contract_hash: taskContractHash(content) };
}

export function assertTaskContract(contract: TaskContract, issueId = contract.issue_id): void {
  if (contract.schema_version !== 1 || contract.issue_id !== issueId) {
    throw new Error(`task contract identity mismatch for ${issueId}`);
  }
  if (!contract.objective.trim()) {
    throw new Error(`task contract for ${issueId} is missing an objective`);
  }
  if (!Array.isArray(contract.acceptance_criteria) || contract.acceptance_criteria.length === 0) {
    throw new Error(`task contract for ${issueId} is missing acceptance criteria`);
  }
  const { contract_hash: contractHash, ...content } = contract;
  if (!/^[0-9a-f]{64}$/iu.test(contractHash) || taskContractHash(content) !== contractHash) {
    throw new Error(`task contract hash verification failed for ${issueId}`);
  }
}

export function buildSyncYmlWithTaskContract(issueId: string, contract: TaskContract): string {
  assertTaskContract(contract, issueId);
  return stringifyYaml({
    version: 1,
    approval: {
      allow_multiple_issues: false,
      skip_sync_required: false,
    },
    entities: {
      issues: [issueId],
      findings: [],
      controls: [],
      proofs: [],
    },
    task_contract: contract,
  });
}

export function readTaskContract(issueId: string, root: string = ROOT): TaskContract {
  const syncPath = path.join(root, '.ops', 'sync', `${issueId}.yml`);
  if (!fs.existsSync(syncPath)) {
    throw new Error(`task contract is absent: sync record not found at ${syncPath}`);
  }
  const parsed = parseYaml(fs.readFileSync(syncPath, 'utf8')) as { task_contract?: TaskContract } | null;
  if (!parsed?.task_contract) {
    throw new Error(`task contract is absent from ${syncPath}; refusing to dispatch an executor without a work order`);
  }
  assertTaskContract(parsed.task_contract, issueId);
  return parsed.task_contract;
}

export function renderTaskContract(contract: TaskContract): string {
  assertTaskContract(contract);
  const render = (values: string[]): string =>
    values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '- (none declared)';
  return [
    `## Authoritative task contract (immutable; hash ${contract.contract_hash})`,
    '',
    '### Objective',
    contract.objective,
    '',
    '### Acceptance criteria',
    render(contract.acceptance_criteria),
    '',
    '### Guardrails',
    render(contract.guardrails),
    '',
    '### Non-goals',
    render(contract.non_goals),
    '',
    '### Required evidence',
    render(contract.required_evidence),
    '',
    '### Exit criteria',
    render(contract.exit_criteria),
    '',
    'The contract above was captured before execution. Do not replace it by inferring from the branch, file scope, PR body, repo brief, or a later Linear query.',
  ].join('\n');
}

function buildVerificationPlan(
  manifest: LaneManifest,
  env: NodeJS.ProcessEnv,
): VerificationPlan {
  const fileScopeLock = manifest.file_scope_lock ?? [];
  const staging = assertStagingTarget(env);

  if (staging.ok) {
    return {
      mode: 'writable-isolated',
      static_command: 'pnpm verify:static',
      focused_test_command: buildFocusedTestCommand(fileScopeLock, true),
      live_db_status: 'authorized-isolated',
      writable_live_db_command:
        'pnpm ci:assert-staging && pnpm test:live-db',
      production_read_only_guard_command: null,
      reason:
        'The configured target passed the non-production identity guard and is authorized for writable live-DB verification.',
    };
  }

  const production = extractProjectRefFromUrl(env['SUPABASE_URL']);
  const productionReadOnly =
    env['UNIT_TALK_DB_ACCESS_MODE'] === 'production-read-only' &&
    production.projectRef === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF &&
    Boolean(env['SUPABASE_ANON_KEY']) &&
    !env['SUPABASE_SERVICE_ROLE_KEY'];

  if (productionReadOnly) {
    return {
        mode: 'production-read-only',
        static_command: 'pnpm verify:static',
        focused_test_command: buildFocusedTestCommand(fileScopeLock, false),
        live_db_status: 'read-only-only',
        writable_live_db_command: null,
        production_read_only_guard_command:
          'test -n "$SUPABASE_ANON_KEY" && test -z "${SUPABASE_SERVICE_ROLE_KEY:-}"',
        reason:
          'The configured target is canonical production and is authorized only for mechanically classified read-only observation.',
    };
  }

  return {
        mode: 'static-only',
        static_command: 'pnpm verify:static',
        focused_test_command: buildFocusedTestCommand(fileScopeLock, false),
        live_db_status: 'blocked-deferred',
        writable_live_db_command: null,
        production_read_only_guard_command: null,
    reason: `Writable live-DB proof is blocked/deferred: ${staging.reason}`,
  };
}

function buildFocusedTestCommand(
  fileScopeLock: string[],
  includeCredentialedDatabaseTests: boolean,
): string {
  const credentialedDatabaseTests = loadCredentialedDatabaseTests();
  const testPaths = fileScopeLock
    .filter((filePath) => /\.test\.[cm]?[jt]sx?$/u.test(filePath))
    .filter(
      (filePath) =>
        includeCredentialedDatabaseTests ||
        !credentialedDatabaseTests.has(filePath),
    )
    .sort();
  if (testPaths.length === 0) {
    return 'Run the issue-specific focused test command declared by the lane';
  }
  return `pnpm exec tsx --test ${testPaths.map(shellQuote).join(' ')}`;
}

function loadCredentialedDatabaseTests(): Set<string> {
  const inventoryPath = path.join(
    ROOT,
    'docs',
    '05_operations',
    'db-writer-classification.json',
  );
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')) as {
    credentialed_tests?: Array<{ path?: string }>;
  };
  if (!Array.isArray(inventory.credentialed_tests)) {
    throw new Error(
      'DB writer classification is missing credentialed_tests; refusing to generate an unsafe focused-test command',
    );
  }
  return new Set(
    inventory.credentialed_tests
      .map((entry) => entry.path)
      .filter((entry): entry is string => Boolean(entry)),
  );
}

function buildCloseoutInstructions(
  issueId: string,
  tier: string,
  verificationPlan: VerificationPlan,
): string[] {
  const instructions = [
    `Run static verification: ${verificationPlan.static_command}`,
    `Run focused issue tests: ${verificationPlan.focused_test_command}`,
  ];

  if (verificationPlan.mode === 'writable-isolated') {
    instructions.push(
      `Run guarded isolated writable verification: ${verificationPlan.writable_live_db_command}`,
    );
  } else if (verificationPlan.mode === 'production-read-only') {
    instructions.push(
      `Run the production read-only identity preflight: ${verificationPlan.production_read_only_guard_command}`,
      'Run only explicitly classified production-read-only observations; writable live-DB proof remains blocked/deferred.',
    );
  } else {
    instructions.push(
      `Record writable live-DB proof as blocked/deferred: ${verificationPlan.reason}`,
    );
  }

  instructions.push(
    'Run npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD',
    `Open PR with title matching feat(ops): ${issueId} description`,
    `Apply tier label: gh pr edit <PR-number> --add-label tier:${tier}`,
    `After merge, run pnpm ops:lane-finalize -- --issue ${issueId} --pr <PR-number-or-url> --json`,
    'Run pnpm ops:orchestration-reconcile --current --json after closeout',
  );

  return instructions;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function printExecutionPacket(manifest: LaneManifest): void {
  emitJson(generateExecutionPacket(manifest));
}

export function assertExecutionPacketCwd(
  packet: Pick<ExecutionPacket, 'cwd'>,
  actualCwd = process.cwd(),
): void {
  const errors = validateExecutionCwd(packet.cwd, actualCwd);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
}

function deriveExecutionLocation(executor: LaneManifest['executor']): string {
  if (!executor) {
    return 'Unknown';
  }

  return EXECUTION_LOCATION_MAP[executor] ?? 'Unknown';
}

function collectTierCWarnings(fileScopeLock: string[]): string[] {
  const warnings: string[] = [];

  for (const filePath of fileScopeLock) {
    if (filePath.startsWith('apps/worker/')) {
      warnings.push(
        `Tier C path requires PM approval before editing: ${filePath} (apps/worker/)`,
      );
      continue;
    }
    if (filePath === '.github/workflows/proof-coverage-guard.yml') {
      warnings.push(
        `Tier C self-amendment path requires PM approval before editing: ${filePath}`,
      );
      continue;
    }
    if (filePath.startsWith('packages/domain/')) {
      warnings.push(
        `Tier C path requires PM approval before editing: ${filePath} (packages/domain/)`,
      );
      continue;
    }
    if (filePath.startsWith('packages/config/')) {
      warnings.push(
        `Tier C path requires PM approval before editing: ${filePath} (packages/config/)`,
      );
      continue;
    }
    if (/^supabase\/migrations\/[^/]+\.sql$/u.test(filePath)) {
      warnings.push(
        `Tier C migration path requires PM approval before editing: ${filePath}`,
      );
      continue;
    }
    if (
      [
        'apps/api/src/auth.ts',
        'apps/api/src/distribution-service.ts',
        'packages/db/src/database.types.ts',
        'packages/db/src/lifecycle.ts',
        'packages/db/src/repositories.ts',
        'packages/db/src/runtime-repositories.ts',
      ].includes(filePath)
    ) {
      warnings.push(
        `Tier C path requires PM approval before editing: ${filePath}`,
      );
    }
  }

  return warnings;
}

function buildRequiredVerification(
  tier: string,
  expectedProofPaths: string[],
): string[] {
  const values = [...(TIER_VERIFICATION_MAP[tier] ?? ['type-check', 'test'])];

  for (const proofPath of expectedProofPaths) {
    if (!values.includes(proofPath)) {
      values.push(proofPath);
    }
  }

  return values;
}

function loadRepoBrief(): string {
  if (
    process.env.UNIT_TALK_TEST_MODE === '1' ||
    process.env.NODE_ENV === 'test'
  ) {
    return '[test-brief-stub]';
  }
  try {
    const briefPath = path.join(ROOT, '.claude', 'agent-brief.md');
    return fs.readFileSync(briefPath, 'utf8');
  } catch {
    return '[agent-brief.md not found — check .claude/agent-brief.md exists in repo root]';
  }
}

function packetTimestamp(): string {
  if (
    process.env.UNIT_TALK_TEST_MODE === '1' ||
    process.env.NODE_ENV === 'test'
  ) {
    return TEST_TIMESTAMP;
  }

  return new Date().toISOString();
}

function main(): void {
  const { positionals, bools } = parseArgs(process.argv.slice(2));
  const issueId = positionals[0];
  if (!issueId) {
    throw new Error(
      'Usage: npx tsx scripts/ops/execution-packet.ts <ISSUE-ID> [--enforce-cwd]',
    );
  }

  const packet = generateExecutionPacket(readManifest(issueId));
  if (bools.has('enforce-cwd')) {
    assertExecutionPacketCwd(packet);
  }
  emitJson(packet);
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitJson({
      ok: false,
      code: 'execution_packet_error',
      message,
      cwd: ROOT,
    });
    process.exit(1);
  }
}
