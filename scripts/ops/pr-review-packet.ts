#!/usr/bin/env tsx
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import micromatch from 'micromatch';
import { parse as parseYaml } from 'yaml';
import {
  ROOT,
  emitJson,
  getFlag,
  parseArgs,
  readManifest,
  requireIssueId,
  type LaneExecutor,
  type LaneManifest,
} from './shared.js';

export interface ProofArtifactChecklistEntry {
  artifact: string;
  present: boolean;
  required: boolean;
}

export interface CiStatusSummaryEntry {
  name: string;
  status: 'pass' | 'fail' | 'pending';
}

export interface RLevelCompliance {
  status: 'PASS' | 'FAIL' | 'UNKNOWN';
  reason: string;
  report_path?: string;
}

export interface SyncMetadataResult {
  status: 'PASS' | 'FAIL';
  path: string | null;
  issue_id: string | null;
  reason: string;
}

export interface ScopeDiffResult {
  allowed_file_scope: string[];
  out_of_scope_files: string[];
}

export interface PackageTestDriftResult {
  package_json_changed: boolean;
  test_script_changed: boolean;
  newly_added_test_files: TestFileWiring[];
  missing_test_wiring: string[];
  dropped_tests: string[];
}

export interface TestFileWiring {
  file: string;
  wired: boolean;
  matched_scripts: string[];
}

export interface UntrackedArtifactScan {
  status: 'PASS' | 'WARN';
  files: string[];
  reason: string;
}

export interface ReturnReviewCheck {
  id: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

export interface PRRiskPacket {
  schema_version: 1;
  generated_at: string;
  issue_id: string;
  pr_number: number;
  status: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
  reasons: string[];
  signals: {
    tier: string;
    tier_label_present: boolean;
    scope_bleed_count: number;
    tier_c_path_count: number;
    missing_proof: boolean;
    r_level_status: RLevelCompliance['status'];
    sync_metadata_status: SyncMetadataResult['status'];
    missing_test_wiring_count: number;
    dropped_tests_count: number;
    untracked_artifact_status: UntrackedArtifactScan['status'];
    failed_ci_count: number;
    pending_ci_count: number;
  };
}

export interface PRReviewPacket {
  schema_version: 2;
  generated_at: string;
  issue_id: string;
  pr_number: number;
  pr_url: string;
  pr_head_sha: string;
  title: string;
  branch: string;
  expected_executor: LaneExecutor | null;
  tier: string;
  tier_label_present: boolean;
  changed_files: string[];
  file_scope_summary: string[];
  allowed_file_scope: string[];
  out_of_scope_files: string[];
  scope_bleed: string[];
  tier_c_paths: string[];
  package_test_drift: PackageTestDriftResult;
  untracked_artifact_scan: UntrackedArtifactScan;
  sync_metadata: SyncMetadataResult;
  r_level_compliance: RLevelCompliance;
  proof_artifact_checklist: ProofArtifactChecklistEntry[];
  proof_requirement: {
    required: boolean;
    present: boolean;
    missing: string[];
  };
  ci_status_summary: CiStatusSummaryEntry[];
  merge_order_notes: string;
  missing_tier_label: boolean;
  missing_proof: boolean;
  risk_packet: PRRiskPacket;
  checks: ReturnReviewCheck[];
  verdict: 'PASS' | 'FAIL' | 'SKIP';
}

interface GitHubLabel {
  name: string;
}

interface GitHubFile {
  path?: string;
  filename?: string;
  status?: string;
}

interface GitHubStatusCheck {
  __typename?: string | null;
  conclusion?: string | null;
  status?: string | null;
  name?: string | null;
  context?: string | null;
  workflowName?: string | null;
}

interface PullRequestSnapshot {
  number: number;
  url: string;
  title: string;
  headRefName: string;
  headRefOid?: string;
  labels: GitHubLabel[];
  files: GitHubFile[];
  statusCheckRollup?: GitHubStatusCheck[] | null;
}

interface GitDiffEntry {
  status: string;
  file: string;
  previousFile?: string;
}

export interface PacketInput {
  issue_id: string;
  pr_number?: number;
  base_ref?: string;
  head_ref?: string;
  output_path?: string;
  prebuilt?: {
    manifest: LaneManifest;
    pull_request: PullRequestSnapshot;
    present_proof_paths?: string[];
    r_level_compliance?: RLevelCompliance;
    sync_metadata?: SyncMetadataResult;
    diff_entries?: GitDiffEntry[];
    base_package_json?: PackageJsonSnapshot | null;
    head_package_json?: PackageJsonSnapshot | null;
    untracked_artifacts?: string[];
    generated_at?: string;
  };
}

interface PackageJsonSnapshot {
  scripts?: Record<string, string>;
}

const TIER_LABEL_PATTERN = /^tier:T[123]$/;
const RETURN_REVIEW_TIERS = new Set(['T1', 'T2']);
const PASS_STATES = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAIL_STATES = new Set([
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
]);
const PENDING_STATES = new Set([
  'PENDING',
  'IN_PROGRESS',
  'QUEUED',
  'EXPECTED',
  'REQUESTED',
  'WAITING',
]);
const TEST_FILE_PATTERN = /(?:^|\/)[^/]+\.test\.(?:ts|tsx|js|mjs|cjs)$/u;
const TIER_C_PATTERNS = [
  'supabase/migrations/**',
  'packages/contracts/src/**',
  'packages/domain/src/**',
  'packages/db/src/lifecycle.ts',
  'packages/db/src/repositories.ts',
  'packages/db/src/runtime-repositories.ts',
  'apps/api/src/distribution-service.ts',
  'apps/api/src/auth.ts',
  'apps/worker/**',
  'packages/db/src/database.types.ts',
];

export async function generatePRReviewPacket(input: PacketInput): Promise<PRReviewPacket> {
  const manifest = input.prebuilt?.manifest ?? readManifest(input.issue_id);
  const pullRequest = input.prebuilt?.pull_request ?? readPullRequest(input.pr_number, manifest);
  const baseRef = input.base_ref ?? `origin/${manifest.base_branch}`;
  const headRef = input.head_ref ?? 'HEAD';
  const changedFiles = normalizePaths(
    pullRequest.files.map((file) => file.path ?? file.filename ?? '').filter(Boolean),
  );
  const diffEntries = input.prebuilt?.diff_entries ?? readGitDiffEntries(baseRef, headRef);
  const tierLabel = pullRequest.labels
    .map((label) => label.name)
    .find((name) => TIER_LABEL_PATTERN.test(name));
  const tier = tierLabel?.replace('tier:', '') ?? manifest.tier;
  const proofArtifactChecklist = buildProofArtifactChecklist(
    manifest,
    tier,
    input.prebuilt?.present_proof_paths,
  );
  const rLevelCompliance = input.prebuilt?.r_level_compliance ?? readRLevelCompliance(baseRef, headRef);
  const syncMetadata = input.prebuilt?.sync_metadata ?? readSyncMetadata(manifest.issue_id);
  const scopeDiff = buildScopeDiff(
    changedFiles,
    manifest.file_scope_lock,
    manifest.issue_id,
    manifest.expected_proof_paths,
  );
  const packageTestDrift = buildPackageTestDrift({
    diffEntries,
    basePackageJson: input.prebuilt?.base_package_json ?? readPackageJsonAtRef(baseRef),
    headPackageJson: input.prebuilt?.head_package_json ?? readPackageJsonFromDisk(),
  });
  const untrackedArtifactScan = buildUntrackedArtifactScan(
    input.prebuilt?.untracked_artifacts ?? readUntrackedArtifacts(),
  );
  const missingProof = proofArtifactChecklist.filter((entry) => entry.required && !entry.present);
  const checks = buildChecks({
    tier,
    outOfScopeFiles: scopeDiff.out_of_scope_files,
    packageTestDrift,
    syncMetadata,
    rLevelCompliance,
    proofArtifactChecklist,
  });
  const generatedAt = input.prebuilt?.generated_at ?? new Date().toISOString();
  const ciStatusSummary = summarizeChecks(pullRequest.statusCheckRollup ?? []);
  const missingTierLabel = tierLabel === undefined;
  const riskPacket = buildRiskPacket({
    generatedAt,
    manifest,
    pullRequest,
    tier,
    tierLabelPresent: !missingTierLabel,
    scopeDiff,
    tierCPaths: changedFiles.filter(isTierCPath),
    packageTestDrift,
    untrackedArtifactScan,
    syncMetadata,
    rLevelCompliance,
    missingProof,
    ciStatusSummary,
  });
  const verdict = RETURN_REVIEW_TIERS.has(tier)
    ? checks.some((check) => check.status === 'FAIL') ? 'FAIL' : 'PASS'
    : 'SKIP';

  return {
    schema_version: 2,
    generated_at: generatedAt,
    issue_id: manifest.issue_id,
    pr_number: pullRequest.number,
    pr_url: pullRequest.url,
    pr_head_sha: pullRequest.headRefOid ?? headRef,
    title: pullRequest.title,
    branch: pullRequest.headRefName,
    expected_executor: manifest.executor ?? null,
    tier,
    tier_label_present: tierLabel !== undefined,
    changed_files: changedFiles,
    file_scope_summary: changedFiles,
    allowed_file_scope: scopeDiff.allowed_file_scope,
    out_of_scope_files: scopeDiff.out_of_scope_files,
    scope_bleed: scopeDiff.out_of_scope_files,
    tier_c_paths: changedFiles.filter(isTierCPath),
    package_test_drift: packageTestDrift,
    untracked_artifact_scan: untrackedArtifactScan,
    sync_metadata: syncMetadata,
    r_level_compliance: rLevelCompliance,
    proof_artifact_checklist: proofArtifactChecklist,
    proof_requirement: {
      required: RETURN_REVIEW_TIERS.has(tier),
      present: missingProof.length === 0,
      missing: missingProof.map((entry) => entry.artifact),
    },
    ci_status_summary: ciStatusSummary,
    merge_order_notes: manifest.notes ?? '',
    missing_tier_label: missingTierLabel,
    missing_proof: missingProof.length > 0,
    risk_packet: riskPacket,
    checks,
    verdict,
  };
}

function buildRiskPacket(input: {
  generatedAt: string;
  manifest: LaneManifest;
  pullRequest: PullRequestSnapshot;
  tier: string;
  tierLabelPresent: boolean;
  scopeDiff: ScopeDiffResult;
  tierCPaths: string[];
  packageTestDrift: PackageTestDriftResult;
  untrackedArtifactScan: UntrackedArtifactScan;
  syncMetadata: SyncMetadataResult;
  rLevelCompliance: RLevelCompliance;
  missingProof: ProofArtifactChecklistEntry[];
  ciStatusSummary: CiStatusSummaryEntry[];
}): PRRiskPacket {
  const failedCiCount = input.ciStatusSummary.filter((check) => check.status === 'fail').length;
  const pendingCiCount = input.ciStatusSummary.filter((check) => check.status === 'pending').length;
  const blockingReasons: string[] = [];
  const highReasons: string[] = [];
  const mediumReasons: string[] = [];

  if (RETURN_REVIEW_TIERS.has(input.tier) && !input.tierLabelPresent) {
    blockingReasons.push('missing tier label');
  }
  if (input.scopeDiff.out_of_scope_files.length > 0) {
    blockingReasons.push(`scope bleed: ${input.scopeDiff.out_of_scope_files.join(', ')}`);
  }
  if (input.tierCPaths.length > 0) {
    blockingReasons.push(`Tier C paths changed: ${input.tierCPaths.join(', ')}`);
  }
  if (input.missingProof.length > 0) {
    blockingReasons.push(`missing proof artifacts: ${input.missingProof.map((entry) => entry.artifact).join(', ')}`);
  }
  if (input.rLevelCompliance.status !== 'PASS') {
    blockingReasons.push(`R-level compliance ${input.rLevelCompliance.status}: ${input.rLevelCompliance.reason}`);
  }
  if (input.syncMetadata.status !== 'PASS') {
    blockingReasons.push(`sync metadata ${input.syncMetadata.status}: ${input.syncMetadata.reason}`);
  }
  if (input.packageTestDrift.missing_test_wiring.length > 0) {
    blockingReasons.push(`new tests missing package script wiring: ${input.packageTestDrift.missing_test_wiring.join(', ')}`);
  }
  if (input.packageTestDrift.dropped_tests.length > 0) {
    blockingReasons.push(`dropped tests: ${input.packageTestDrift.dropped_tests.join(', ')}`);
  }
  if (failedCiCount > 0) {
    highReasons.push(`${failedCiCount} failing CI check(s)`);
  }
  if (pendingCiCount > 0) {
    mediumReasons.push(`${pendingCiCount} pending CI check(s)`);
  }
  if (input.untrackedArtifactScan.status === 'WARN') {
    mediumReasons.push(input.untrackedArtifactScan.reason);
  }

  const status: PRRiskPacket['status'] = blockingReasons.length > 0
    ? 'BLOCKED'
    : highReasons.length > 0
      ? 'HIGH'
      : mediumReasons.length > 0
        ? 'MEDIUM'
        : 'LOW';

  return {
    schema_version: 1,
    generated_at: input.generatedAt,
    issue_id: input.manifest.issue_id,
    pr_number: input.pullRequest.number,
    status,
    reasons: [...blockingReasons, ...highReasons, ...mediumReasons],
    signals: {
      tier: input.tier,
      tier_label_present: input.tierLabelPresent,
      scope_bleed_count: input.scopeDiff.out_of_scope_files.length,
      tier_c_path_count: input.tierCPaths.length,
      missing_proof: input.missingProof.length > 0,
      r_level_status: input.rLevelCompliance.status,
      sync_metadata_status: input.syncMetadata.status,
      missing_test_wiring_count: input.packageTestDrift.missing_test_wiring.length,
      dropped_tests_count: input.packageTestDrift.dropped_tests.length,
      untracked_artifact_status: input.untrackedArtifactScan.status,
      failed_ci_count: failedCiCount,
      pending_ci_count: pendingCiCount,
    },
  };
}

function buildChecks(input: {
  tier: string;
  outOfScopeFiles: string[];
  packageTestDrift: PackageTestDriftResult;
  syncMetadata: SyncMetadataResult;
  rLevelCompliance: RLevelCompliance;
  proofArtifactChecklist: ProofArtifactChecklistEntry[];
}): ReturnReviewCheck[] {
  if (!RETURN_REVIEW_TIERS.has(input.tier)) {
    return [
      {
        id: 'tier',
        status: 'PASS',
        detail: `return review packet is advisory for ${input.tier}`,
      },
    ];
  }

  const missingProof = input.proofArtifactChecklist
    .filter((entry) => entry.required && !entry.present)
    .map((entry) => entry.artifact);
  const checks: ReturnReviewCheck[] = [
    {
      id: 'scope',
      status: input.outOfScopeFiles.length === 0 ? 'PASS' : 'FAIL',
      detail: input.outOfScopeFiles.length === 0
        ? 'all changed files are within the lane scope'
        : `out-of-scope files: ${input.outOfScopeFiles.join(', ')}`,
    },
    {
      id: 'test_wiring',
      status: input.packageTestDrift.missing_test_wiring.length === 0 ? 'PASS' : 'FAIL',
      detail: input.packageTestDrift.missing_test_wiring.length === 0
        ? 'all newly added test files are referenced by package scripts'
        : `new test files missing package script wiring: ${input.packageTestDrift.missing_test_wiring.join(', ')}`,
    },
    {
      id: 'dropped_tests',
      status: input.packageTestDrift.dropped_tests.length === 0 ? 'PASS' : 'FAIL',
      detail: input.packageTestDrift.dropped_tests.length === 0
        ? 'no dropped test files or package script references detected'
        : `dropped tests: ${input.packageTestDrift.dropped_tests.join(', ')}`,
    },
    {
      id: 'sync_metadata',
      status: input.syncMetadata.status,
      detail: input.syncMetadata.reason,
    },
    {
      id: 'r_level',
      status: input.rLevelCompliance.status === 'PASS' ? 'PASS' : 'FAIL',
      detail: input.rLevelCompliance.reason,
    },
    {
      id: 'proof',
      status: missingProof.length === 0 ? 'PASS' : 'FAIL',
      detail: missingProof.length === 0
        ? 'required proof artifacts are present'
        : `missing required proof artifacts: ${missingProof.join(', ')}`,
    },
  ];

  return checks;
}

function buildScopeDiff(
  changedFiles: string[],
  scopeLock: string[],
  issueId: string,
  expectedProofPaths: string[],
): ScopeDiffResult {
  const allowedFileScope = normalizePaths([
    ...scopeLock,
    ...sameIssueLaneMetadataPaths(issueId),
    ...expectedProofPaths,
  ]);
  return {
    allowed_file_scope: allowedFileScope,
    out_of_scope_files: changedFiles.filter((filePath) => !matchesAnyScopeLock(filePath, allowedFileScope)),
  };
}

function buildProofArtifactChecklist(
  manifest: LaneManifest,
  tier: string,
  presentProofPaths?: string[],
): ProofArtifactChecklistEntry[] {
  const presentSet = presentProofPaths
    ? new Set(normalizePaths(presentProofPaths))
    : null;
  const required = RETURN_REVIEW_TIERS.has(tier);

  return normalizePaths(manifest.expected_proof_paths).map((artifact) => ({
    artifact,
    required,
    present: presentSet
      ? presentSet.has(artifact)
      : fs.existsSync(path.join(ROOT, artifact)),
  }));
}

function buildPackageTestDrift(input: {
  diffEntries: GitDiffEntry[];
  basePackageJson: PackageJsonSnapshot | null;
  headPackageJson: PackageJsonSnapshot | null;
}): PackageTestDriftResult {
  const packageJsonChanged = input.diffEntries.some((entry) => entry.file === 'package.json');
  const baseScripts = input.basePackageJson?.scripts ?? {};
  const headScripts = input.headPackageJson?.scripts ?? {};
  const newlyAddedTestFiles = normalizePaths(
    input.diffEntries
      .filter((entry) => isAddedStatus(entry.status) && isTestFile(entry.file))
      .map((entry) => entry.file),
  ).map((file) => buildTestFileWiring(file, headScripts));
  const missingTestWiring = newlyAddedTestFiles
    .filter((entry) => !entry.wired)
    .map((entry) => entry.file);
  const deletedTestFiles = input.diffEntries
    .filter((entry) => isDeletedStatus(entry.status) && isTestFile(entry.file))
    .map((entry) => entry.file);
  const deletedFiles = new Set(
    input.diffEntries
      .filter((entry) => isDeletedStatus(entry.status))
      .map((entry) => normalizePath(entry.file)),
  );
  const removedWithImplementation = new Set(
    deletedTestFiles.filter((file) =>
      matchingImplementationPathsForTest(file).some((implementationPath) => deletedFiles.has(implementationPath)),
    ),
  );
  const baseScriptTestFiles = extractScriptTestFiles(baseScripts);
  const headScriptTestFiles = extractScriptTestFiles(headScripts);
  const droppedScriptReferences = baseScriptTestFiles.filter((file) =>
    !headScriptTestFiles.includes(file) && !removedWithImplementation.has(file),
  );
  const droppedTests = normalizePaths([
    ...deletedTestFiles.filter((file) => !removedWithImplementation.has(file)),
    ...droppedScriptReferences,
  ]);
  const testScriptChanged = packageJsonChanged && !sameJson(testScriptSubset(baseScripts), testScriptSubset(headScripts));

  return {
    package_json_changed: packageJsonChanged,
    test_script_changed: testScriptChanged,
    newly_added_test_files: newlyAddedTestFiles,
    missing_test_wiring: missingTestWiring,
    dropped_tests: droppedTests,
  };
}

function buildTestFileWiring(file: string, scripts: Record<string, string>): TestFileWiring {
  const rootMatchedScripts = Object.entries(scripts)
    .filter(([name, script]) =>
      isTestScript(name, script) &&
      (scriptReferencesFile(script, file) || scriptRunsDiscoverableTests(script)),
    )
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
  if (rootMatchedScripts.length > 0) {
    return { file, wired: true, matched_scripts: rootMatchedScripts };
  }
  // Monorepo fallback: check the owning package's package.json using package-relative path.
  // Root package.json scripts use repo-relative paths; per-package scripts use src-relative paths.
  const pkgDirMatch = /^((?:apps|packages)\/[^/]+)\//u.exec(file);
  if (pkgDirMatch) {
    const pkgDir = pkgDirMatch[1] as string;
    const pkgRelFile = file.slice(pkgDir.length + 1);
    try {
      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(ROOT, pkgDir, 'package.json'), 'utf8'),
      ) as PackageJsonSnapshot;
      const pkgScripts = pkgJson.scripts ?? {};
      const pkgMatchedScripts = Object.entries(pkgScripts)
        .filter(([name, script]) =>
          isTestScript(name, script) &&
          (
            scriptReferencesFile(script, pkgRelFile) ||
            scriptReferencesFile(script, file) ||
            scriptRunsDiscoverableTests(script)
          ),
        )
        .map(([name]) => `${pkgDir}#${name}`)
        .sort((left, right) => left.localeCompare(right));
      if (pkgMatchedScripts.length > 0) {
        return { file, wired: true, matched_scripts: pkgMatchedScripts };
      }
    } catch {
      // package.json not found or unreadable — fall through
    }
  }
  return { file, wired: false, matched_scripts: [] };
}

function buildUntrackedArtifactScan(files: string[]): UntrackedArtifactScan {
  const normalized = normalizePaths(files).filter((file) =>
    file.startsWith('artifacts/') ||
    file.startsWith('.out/') ||
    file.startsWith('docs/06_status/proof/'),
  );
  return {
    status: normalized.length === 0 ? 'PASS' : 'WARN',
    files: normalized,
    reason: normalized.length === 0
      ? 'no untracked artifact files detected'
      : 'untracked artifact files are present; include or clean them before closeout',
  };
}

function summarizeChecks(checks: GitHubStatusCheck[]): CiStatusSummaryEntry[] {
  return checks
    .map((check) => {
      const name = check.name ?? check.context ?? check.workflowName ?? check.__typename ?? 'unknown';
      const rawState = (check.conclusion ?? check.status ?? 'UNKNOWN').toUpperCase();
      return {
        name,
        status: normalizeCheckStatus(rawState),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeCheckStatus(state: string): 'pass' | 'fail' | 'pending' {
  if (PASS_STATES.has(state)) {
    return 'pass';
  }
  if (FAIL_STATES.has(state)) {
    return 'fail';
  }
  if (PENDING_STATES.has(state)) {
    return 'pending';
  }
  return 'pending';
}

function matchesAnyScopeLock(filePath: string, scopeLock: string[]): boolean {
  return scopeLock.some((pattern) => {
    const normalizedPattern = normalizePath(pattern);
    if (normalizedPattern.endsWith('/')) {
      return filePath.startsWith(normalizedPattern);
    }
    return micromatch.isMatch(filePath, normalizedPattern, { dot: true }) ||
      filePath === normalizedPattern ||
      filePath.startsWith(`${normalizedPattern}/`);
  });
}

function sameIssueLaneMetadataPaths(issueId: string): string[] {
  const normalizedIssueId = issueId.toUpperCase();
  return [
    `.ops/sync/${normalizedIssueId}.yml`,
    `docs/06_status/lanes/${normalizedIssueId}.json`,
  ];
}

function isTierCPath(filePath: string): boolean {
  return micromatch.isMatch(filePath, TIER_C_PATTERNS, { dot: true });
}

function readPullRequest(prNumber: number | undefined, manifest: LaneManifest): PullRequestSnapshot {
  const selector = prNumber ?? readPrNumberFromManifest(manifest);
  const fields = [
    'number',
    'url',
    'title',
    'headRefName',
    'headRefOid',
    'labels',
    'files',
    'statusCheckRollup',
  ].join(',');
  const stdout = execSync(
    `gh pr view ${quoteForShell(String(selector))} --json ${fields}`,
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(stdout) as PullRequestSnapshot;
}

function readPrNumberFromManifest(manifest: LaneManifest): number {
  const prUrl = manifest.pr_url;
  if (!prUrl) {
    throw new Error(`No pr_number provided and manifest ${manifest.issue_id} has no pr_url`);
  }

  const match = /\/pull\/(\d+)(?:\/|$)/.exec(prUrl);
  if (!match) {
    throw new Error(`Unable to parse PR number from manifest pr_url: ${prUrl}`);
  }

  return Number.parseInt(match[1] ?? '', 10);
}

function readRLevelCompliance(baseRef: string, headRef: string): RLevelCompliance {
  const outputPath = path.join('.out', 'ops', 'pr-review-packet', 'r-level-report.json');
  const command = [
    'tsx',
    'scripts/ci/r-level-check.ts',
    '--base',
    baseRef,
    '--head',
    headRef,
    '--output-json',
    outputPath,
  ];
  try {
    const commandArgs = ['exec', ...command];
    const stdout =
      process.platform === 'win32'
        ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...commandArgs], {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        : execFileSync('pnpm', commandArgs, {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
    return {
      status: stdout.includes('Verdict: PASS') ? 'PASS' : 'UNKNOWN',
      reason: firstNonEmptyLine(stdout) ?? 'r-level-check completed without a parseable verdict',
      report_path: outputPath,
    };
  } catch (error) {
    if (!hasRLevelCheckScript()) {
      return {
        status: 'UNKNOWN',
        reason: 'scripts/ci/r-level-check.ts is unavailable',
      };
    }

    const output = extractExecErrorOutput(error);
    if (output.includes('Verdict: FAIL')) {
      return {
        status: 'FAIL',
        reason: firstNonEmptyLine(output) ?? 'r-level-check reported FAIL',
        report_path: outputPath,
      };
    }

    return {
      status: 'UNKNOWN',
      reason: firstNonEmptyLine(output) ?? 'unable to determine r-level compliance',
      report_path: outputPath,
    };
  }
}

function readSyncMetadata(issueId: string): SyncMetadataResult {
  const perIssuePath = `.ops/sync/${issueId}.yml`;
  const legacyPath = '.ops/sync.yml';
  if (fs.existsSync(path.join(ROOT, perIssuePath))) {
    return parseSyncMetadata(perIssuePath, issueId);
  }
  if (fs.existsSync(path.join(ROOT, legacyPath))) {
    const result = parseSyncMetadata(legacyPath, issueId);
    if (result.status === 'PASS') {
      return result;
    }
  }
  return {
    status: 'FAIL',
    path: null,
    issue_id: null,
    reason: `missing sync metadata for ${issueId}`,
  };
}

function parseSyncMetadata(syncPath: string, expectedIssueId: string): SyncMetadataResult {
  const absolutePath = path.join(ROOT, syncPath);
  try {
    const parsed = parseYaml(fs.readFileSync(absolutePath, 'utf8')) as {
      entities?: { issues?: string[] };
    } | null;
    const issueId = parsed?.entities?.issues?.[0]?.toUpperCase() ?? null;
    if (issueId === expectedIssueId.toUpperCase()) {
      return {
        status: 'PASS',
        path: syncPath,
        issue_id: issueId,
        reason: `${syncPath} declares ${issueId}`,
      };
    }
    return {
      status: 'FAIL',
      path: syncPath,
      issue_id: issueId,
      reason: `${syncPath} does not declare ${expectedIssueId}`,
    };
  } catch (error) {
    return {
      status: 'FAIL',
      path: syncPath,
      issue_id: null,
      reason: `unable to parse ${syncPath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function readGitDiffEntries(baseRef: string, headRef: string): GitDiffEntry[] {
  const result = execFileSync('git', ['diff', '--name-status', `${baseRef}..${headRef}`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return parseGitDiffEntries(result);
}

function parseGitDiffEntries(output: string): GitDiffEntry[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t/u);
      const status = parts[0] ?? '';
      if (status.startsWith('R') || status.startsWith('C')) {
        return {
          status,
          previousFile: normalizePath(parts[1] ?? ''),
          file: normalizePath(parts[2] ?? ''),
        };
      }
      return {
        status,
        file: normalizePath(parts[1] ?? ''),
      };
    })
    .filter((entry) => entry.file.length > 0);
}

function readPackageJsonAtRef(ref: string): PackageJsonSnapshot | null {
  try {
    const stdout = execFileSync('git', ['show', `${ref}:package.json`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(stdout) as PackageJsonSnapshot;
  } catch {
    return null;
  }
}

function readPackageJsonFromDisk(): PackageJsonSnapshot | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageJsonSnapshot;
  } catch {
    return null;
  }
}

function readUntrackedArtifacts(): string[] {
  try {
    const stdout = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return stdout.split(/\r?\n/u).filter(Boolean);
  } catch {
    return [];
  }
}

function hasRLevelCheckScript(): boolean {
  return fs.existsSync(path.join(ROOT, 'scripts', 'ci', 'r-level-check.ts'));
}

function extractExecErrorOutput(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const withStreams = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
  return [withStreams.stdout, withStreams.stderr]
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }
      if (Buffer.isBuffer(value)) {
        return value.toString('utf8');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function firstNonEmptyLine(input: string): string | undefined {
  return input
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

function normalizePaths(paths: string[]): string[] {
  return [...new Set(paths.map(normalizePath).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function quoteForShell(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}

function matchingImplementationPathsForTest(filePath: string): string[] {
  const normalized = normalizePath(filePath);
  return [
    normalized.replace(/(?:\.test|\.spec)(\.[cm]?[jt]sx?)$/u, '$1'),
    normalized.replace(/(?:\.test|\.spec)(\.[cm]?[jt]sx?)$/u, '.js'),
  ];
}

function isAddedStatus(status: string): boolean {
  return status === 'A' || status.startsWith('R') || status.startsWith('C');
}

function isDeletedStatus(status: string): boolean {
  return status === 'D';
}

function isTestScript(name: string, script: string): boolean {
  return name === 'test' || name.startsWith('test:') || /\btsx\s+--test\b/u.test(script);
}

function scriptReferencesFile(script: string, file: string): boolean {
  const normalizedScript = normalizePath(script);
  if (normalizedScript.includes(file)) {
    return true;
  }
  const patterns = extractGlobLikeTokens(normalizedScript);
  return patterns.some((pattern) => micromatch.isMatch(file, pattern, { dot: true }));
}

function scriptRunsDiscoverableTests(script: string): boolean {
  return /\btsx\s+--test\b/u.test(script) && extractPathLikeTokens(script).length === 0;
}

function extractScriptTestFiles(scripts: Record<string, string>): string[] {
  const files = Object.entries(scripts)
    .filter(([name, script]) => isTestScript(name, script))
    .flatMap(([, script]) => extractPathLikeTokens(script))
    .filter(isTestFile);
  return normalizePaths(files);
}

function extractPathLikeTokens(script: string): string[] {
  return normalizePath(script)
    .split(/\s+/u)
    .map((token) => token.replace(/^['"]|['"]$/gu, ''))
    .filter((token) => token.includes('/') && !token.startsWith('--'));
}

function extractGlobLikeTokens(script: string): string[] {
  return extractPathLikeTokens(script).filter((token) => /[*?[\]{}]/u.test(token));
}

function testScriptSubset(scripts: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(scripts)
      .filter(([name, script]) => isTestScript(name, script))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function main(): Promise<void> {
  const { flags, bools } = parseArgs(process.argv.slice(2));
  const issueFlag = getFlag(flags, 'issue');
  const inferredIssue = issueFlag ?? inferIssueFromBranch();
  if (!inferredIssue) {
    throw new Error('Missing --issue <UTV2-###> and unable to infer issue from branch');
  }
  const packet = await generatePRReviewPacket({
    issue_id: requireIssueId(inferredIssue),
    pr_number: getFlag(flags, 'pr') ? Number.parseInt(getFlag(flags, 'pr') ?? '', 10) : undefined,
    base_ref: getFlag(flags, 'base') ?? undefined,
    head_ref: getFlag(flags, 'head') ?? undefined,
  });
  const outputPath = getFlag(flags, 'output');
  if (outputPath) {
    const absoluteOutput = path.resolve(ROOT, outputPath);
    fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
    fs.writeFileSync(absoluteOutput, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  }
  const riskOutputPath = getFlag(flags, 'risk-output');
  if (riskOutputPath) {
    const absoluteRiskOutput = path.resolve(ROOT, riskOutputPath);
    fs.mkdirSync(path.dirname(absoluteRiskOutput), { recursive: true });
    fs.writeFileSync(absoluteRiskOutput, `${JSON.stringify(packet.risk_packet, null, 2)}\n`, 'utf8');
  }
  if (bools.has('json') || outputPath) {
    emitJson(packet);
  } else {
    console.log(`Return review packet: ${packet.issue_id} ${packet.verdict}`);
    console.log(`Risk packet: ${packet.risk_packet.status}`);
    for (const check of packet.checks) {
      console.log(`- ${check.status} ${check.id}: ${check.detail}`);
    }
  }
  process.exit(packet.verdict === 'FAIL' ? 1 : 0);
}

function inferIssueFromBranch(): string | null {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    const match = branch.match(/(?:utv2|uni)-(\d+)/iu);
    return match ? `UTV2-${match[1]}` : null;
  } catch {
    return null;
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
}
