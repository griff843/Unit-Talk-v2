import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
  readConfiguredEnvValue,
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

export type ExecutionPacketResult =
  | { ok: true; packet: ExecutionPacket }
  | {
      ok: false;
      code: 'EXECUTION_PACKET_INVALID';
      issue_id: string;
      branch: string;
      message: string;
    };

type LinearFetchRunner = typeof spawnSync;

export interface DispatchPacketOptions {
  root?: string;
  linearToken?: string;
  runner?: LinearFetchRunner;
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
  root: string = ROOT,
): ExecutionPacket {
  const issueId = manifest.issue_id;
  const tier = manifest.tier ?? 'unknown';
  const expectedProofPaths = manifest.expected_proof_paths ?? [];
  const verificationPlan = buildVerificationPlan(manifest, env);
  const taskContract = suppliedTaskContract ?? readTaskContract(issueId, root);
  assertTaskContract(taskContract, issueId);

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

export function generateExecutionPacketResult(
  manifest: LaneManifest,
  env: NodeJS.ProcessEnv = process.env,
  suppliedTaskContract?: TaskContract,
  root: string = ROOT,
): ExecutionPacketResult {
  try {
    return {
      ok: true,
      packet: generateExecutionPacket(
        manifest,
        env,
        suppliedTaskContract,
        root,
      ),
    };
  } catch (error) {
    return {
      ok: false,
      code: 'EXECUTION_PACKET_INVALID',
      issue_id: manifest.issue_id,
      branch: manifest.branch,
      message: `Execution packet refused: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function executionPacketFailure(
  manifest: LaneManifest,
  error: unknown,
): ExecutionPacketResult {
  return {
    ok: false,
    code: 'EXECUTION_PACKET_INVALID',
    issue_id: manifest.issue_id,
    branch: manifest.branch,
    message: `Execution packet refused: ${error instanceof Error ? error.message : String(error)}`,
  };
}

function normalizeHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseSections(markdown: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const rawLine of markdown.split(/\r?\n/u)) {
    const heading = /^#{1,6}\s+(.+?)\s*$/u.exec(rawLine.trim());
    if (heading) {
      current = normalizeHeading(heading[1] ?? '');
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current)!.push(rawLine);
  }
  return sections;
}

function sectionLines(
  sections: Map<string, string[]>,
  headings: string[],
  prefix = false,
): string[] {
  const wanted = headings.map(normalizeHeading);
  for (const [heading, lines] of sections) {
    if (
      wanted.some(
        (value) => heading === value || (prefix && heading.startsWith(value)),
      )
    ) {
      return lines;
    }
  }
  return [];
}

function sectionItems(lines: string[]): string[] {
  const items: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = (): void => {
    const value = paragraph.join(' ').replace(/\s+/gu, ' ').trim();
    if (value) items.push(value);
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const listItem = /^(?:[-*+] |\d+[.)]\s+)(?:\[[ xX]\]\s*)?(.*)$/u.exec(line);
    if (listItem) {
      flushParagraph();
      const value = (listItem[1] ?? '').trim();
      if (value) items.push(value);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return items;
}

function taskContractHash(
  contract: Omit<TaskContract, 'contract_hash'>,
): string {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

export function buildTaskContract(
  source: LinearTaskSource,
  capturedAt = packetTimestamp(),
): TaskContract {
  const issueId = source.identifier.trim().toUpperCase();
  const title = source.title.trim();
  const description = source.description.trim();
  const sections = parseSections(description);
  const objectiveItems = sectionItems(
    sectionLines(sections, ['objective', 'required outcome']),
  );
  const objective = objectiveItems.join('\n') || title;
  const explicitAcceptance = sectionItems(
    sectionLines(sections, ['acceptance criteria', 'acceptance criterion']),
  );
  const hasAcceptanceHeading = [...sections.keys()].some((heading) =>
    ['acceptance criteria', 'acceptance criterion'].includes(heading),
  );
  const exitCriteria = sectionItems(sectionLines(sections, ['exit criteria']));

  // Existing issues predate the heading convention. Preserve their complete
  // work order verbatim instead of inventing criteria or bulk-migrating state.
  const acceptanceCriteria =
    explicitAcceptance.length > 0
      ? explicitAcceptance
      : !hasAcceptanceHeading && description
        ? [description]
        : [];

  if (!/^UTV2-\d+$/u.test(issueId)) {
    throw new Error(
      `task contract has an invalid issue identity: ${source.identifier}`,
    );
  }
  if (!objective) {
    throw new Error(`task contract for ${issueId} is missing an objective`);
  }
  if (acceptanceCriteria.length === 0) {
    throw new Error(
      `task contract for ${issueId} is missing acceptance criteria`,
    );
  }

  const content: Omit<TaskContract, 'contract_hash'> = {
    schema_version: 1,
    issue_id: issueId,
    objective,
    acceptance_criteria: acceptanceCriteria,
    guardrails: sectionItems(sectionLines(sections, ['guardrails'])),
    non_goals: sectionItems(
      sectionLines(
        sections,
        ['non goals', 'non-goals', 'out of scope', 'explicitly out of scope'],
        true,
      ),
    ),
    required_evidence: sectionItems(
      sectionLines(sections, ['required evidence', 'evidence']),
    ),
    exit_criteria: exitCriteria,
    source: {
      kind: 'linear-issue-snapshot',
      issue_url: source.url.trim(),
      title,
      description,
      captured_at: capturedAt,
      description_sha256: createHash('sha256')
        .update(description)
        .digest('hex'),
    },
  };
  return { ...content, contract_hash: taskContractHash(content) };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

export function assertTaskContract(
  contract: unknown,
  expectedIssueId?: string,
): asserts contract is TaskContract {
  if (!contract || typeof contract !== 'object') {
    throw new Error('task contract is missing or not an object');
  }
  const value = contract as Partial<TaskContract>;
  const issueId = expectedIssueId ?? value.issue_id ?? '(unknown issue)';
  if (value.schema_version !== 1 || value.issue_id !== issueId) {
    throw new Error(`task contract identity mismatch for ${issueId}`);
  }
  if (typeof value.objective !== 'string' || !value.objective.trim()) {
    throw new Error(`task contract for ${issueId} is missing an objective`);
  }
  if (
    !isStringArray(value.acceptance_criteria) ||
    value.acceptance_criteria.length === 0
  ) {
    throw new Error(
      `task contract for ${issueId} is missing acceptance criteria`,
    );
  }
  for (const field of [
    'guardrails',
    'non_goals',
    'required_evidence',
    'exit_criteria',
  ] as const) {
    if (!isStringArray(value[field])) {
      throw new Error(
        `task contract for ${issueId} is missing the ${field} array`,
      );
    }
  }
  if (
    !value.source ||
    value.source.kind !== 'linear-issue-snapshot' ||
    typeof value.source.issue_url !== 'string' ||
    typeof value.source.title !== 'string' ||
    typeof value.source.description !== 'string' ||
    typeof value.source.captured_at !== 'string' ||
    typeof value.source.description_sha256 !== 'string'
  ) {
    throw new Error(
      `task contract for ${issueId} is missing its Linear source snapshot`,
    );
  }
  if (
    createHash('sha256').update(value.source.description).digest('hex') !==
    value.source.description_sha256
  ) {
    throw new Error(
      `task contract source hash verification failed for ${issueId}`,
    );
  }
  const contractHash = value.contract_hash;
  const { contract_hash: _contractHash, ...content } = value as TaskContract;
  if (
    typeof contractHash !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(contractHash) ||
    taskContractHash(content) !== contractHash
  ) {
    throw new Error(`task contract hash verification failed for ${issueId}`);
  }
}

export function buildSyncYmlWithTaskContract(
  issueId: string,
  contract: TaskContract,
  existingContent?: string,
): string {
  assertTaskContract(contract, issueId);
  const parsed = existingContent?.trim()
    ? parseYaml(existingContent)
    : {
        version: 1,
        approval: { allow_multiple_issues: false, skip_sync_required: false },
        entities: { issues: [issueId], findings: [], controls: [], proofs: [] },
      };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`sync record for ${issueId} is malformed`);
  }
  return stringifyYaml({
    ...(parsed as Record<string, unknown>),
    task_contract: contract,
  });
}

function curlConfigValue(value: string): string {
  if (/\r|\n/u.test(value)) {
    throw new Error('Linear API token contains an invalid newline');
  }
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function fetchLinearTaskSource(
  issueId: string,
  token: string,
  runner: LinearFetchRunner = spawnSync,
): LinearTaskSource {
  if (!token.trim()) {
    throw new Error(
      `LINEAR_API_TOKEN or LINEAR_API_KEY is required to capture the task contract for ${issueId}`,
    );
  }
  const query = `
    query LaneTaskContract($id: String!) {
      issue(id: $id) { identifier title url description }
    }
  `;
  const result = runner(
    'curl',
    [
      '--config',
      '-',
      '--fail-with-body',
      '--silent',
      '--show-error',
      '--request',
      'POST',
      'https://api.linear.app/graphql',
      '--header',
      'Content-Type: application/json',
      '--data-binary',
      JSON.stringify({ query, variables: { id: issueId } }),
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 15_000,
      input: `header = "Authorization: ${curlConfigValue(token)}"\n`,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `failed to capture Linear task contract for ${issueId}: ${result.error?.message ?? result.stderr ?? `curl exit ${result.status}`}`,
    );
  }
  const payload = JSON.parse(String(result.stdout ?? '{}')) as {
    data?: { issue?: LinearTaskSource | null };
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(
      `failed to capture Linear task contract for ${issueId}: ${payload.errors.map((entry) => entry.message ?? 'unknown Linear error').join('; ')}`,
    );
  }
  const issue = payload.data?.issue;
  if (!issue || issue.identifier.toUpperCase() !== issueId) {
    throw new Error(
      `failed to capture Linear task contract for ${issueId}: issue identity mismatch or missing issue`,
    );
  }
  return {
    identifier: issue.identifier.toUpperCase(),
    title: issue.title ?? '',
    url: issue.url ?? '',
    description: issue.description ?? '',
  };
}

export function captureOrReadTaskContract(
  issueId: string,
  token: string,
  root: string = ROOT,
  runner: LinearFetchRunner = spawnSync,
): TaskContract {
  const syncPath = path.join(root, '.ops', 'sync', `${issueId}.yml`);
  if (fs.existsSync(syncPath)) {
    const existing = fs.readFileSync(syncPath, 'utf8');
    if (/(?:^|\n)task_contract:\s*(?:\n|\{)/u.test(existing)) {
      return readTaskContract(issueId, root);
    }
  }
  return buildTaskContract(fetchLinearTaskSource(issueId, token, runner));
}

function persistTaskContract(
  issueId: string,
  contract: TaskContract,
  root: string,
): void {
  const syncDir = path.join(root, '.ops', 'sync');
  const syncPath = path.join(syncDir, `${issueId}.yml`);
  const existing = fs.existsSync(syncPath)
    ? fs.readFileSync(syncPath, 'utf8')
    : undefined;
  fs.mkdirSync(syncDir, { recursive: true });
  fs.writeFileSync(
    syncPath,
    buildSyncYmlWithTaskContract(issueId, contract, existing),
    'utf8',
  );
}

/**
 * Executor-facing compatibility path. A pre-contract lane captures exactly one
 * authoritative snapshot at dispatch time, persists it in the control checkout
 * and lane worktree, and then goes through the same strict packet validator as
 * every newly started lane.
 */
export function generateDispatchExecutionPacketResult(
  manifest: LaneManifest,
  env: NodeJS.ProcessEnv = process.env,
  options: DispatchPacketOptions = {},
): ExecutionPacketResult {
  const root = options.root ?? ROOT;
  try {
    const token =
      options.linearToken ??
      env['LINEAR_API_TOKEN'] ??
      env['LINEAR_API_KEY'] ??
      readConfiguredEnvValue('LINEAR_API_TOKEN') ??
      readConfiguredEnvValue('LINEAR_API_KEY') ??
      '';
    const contract = captureOrReadTaskContract(
      manifest.issue_id,
      token,
      root,
      options.runner ?? spawnSync,
    );
    persistTaskContract(manifest.issue_id, contract, root);

    const laneCwd = manifest.execution_location?.cwd ?? manifest.worktree_path;
    const laneRoot = path.isAbsolute(laneCwd)
      ? laneCwd
      : path.resolve(root, laneCwd);
    if (laneRoot !== root && fs.existsSync(laneRoot)) {
      persistTaskContract(manifest.issue_id, contract, laneRoot);
    }

    return generateExecutionPacketResult(manifest, env, contract, root);
  } catch (error) {
    return executionPacketFailure(manifest, error);
  }
}

export function readTaskContract(
  issueId: string,
  root: string = ROOT,
): TaskContract {
  const syncPath = path.join(root, '.ops', 'sync', `${issueId}.yml`);
  if (!fs.existsSync(syncPath)) {
    throw new Error(
      `task contract is absent: sync record not found at ${syncPath}`,
    );
  }
  const parsed = parseYaml(fs.readFileSync(syncPath, 'utf8')) as {
    task_contract?: unknown;
  } | null;
  if (!parsed?.task_contract) {
    throw new Error(
      `task contract is absent from ${syncPath}; refusing to dispatch without a work order`,
    );
  }
  assertTaskContract(parsed.task_contract, issueId);
  return parsed.task_contract;
}

export function renderTaskContract(contract: TaskContract): string {
  assertTaskContract(contract);
  const render = (values: string[]): string =>
    values.length > 0
      ? values.map((value) => `- ${value}`).join('\n')
      : '- (none declared)';
  return [
    `## Authoritative task contract (integrity hash ${contract.contract_hash})`,
    '',
    'This is the captured work order. Do not infer a replacement task from the branch name, file scope, an existing PR, or the repo brief.',
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
