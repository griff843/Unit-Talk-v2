import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type LaneTier = 'T1' | 'T2' | 'T3';
export type LaneManifestStatus =
  | 'started'
  | 'in_progress'
  | 'in_review'
  | 'merged'
  | 'done'
  | 'blocked'
  | 'reopened';
export type LaneType = 'claude' | 'codex-cli' | 'codex-cloud';
export type CreatedBy = 'claude' | 'codex-cli' | 'pm';

export interface TruthCheckHistoryEntry {
  checked_at: string;
  verdict: 'pass' | 'fail' | 'reopen';
  merge_sha: string | null;
  failures: string[];
  runner: 'ops:lane:close' | 'ops:reconcile' | 'manual';
}

export interface ReopenHistoryEntry {
  timestamp: string;
  reasons: string[];
  detected_by: string;
}

export interface LaneManifest {
  schema_version: 1;
  issue_id: string;
  lane_type: LaneType;
  tier: LaneTier;
  worktree_path: string;
  branch: string;
  base_branch: string;
  commit_sha: string | null;
  pr_url: string | null;
  files_changed: string[];
  file_scope_lock: string[];
  expected_proof_paths: string[];
  status: LaneManifestStatus;
  started_at: string;
  heartbeat_at: string;
  closed_at: string | null;
  blocked_by: string[];
  preflight_token: string;
  created_by: CreatedBy;
  truth_check_history: TruthCheckHistoryEntry[];
  reopen_history: ReopenHistoryEntry[];
  stale?: boolean;
  orphaned?: boolean;
  override?: {
    reason: string;
    by: string;
    at: string;
  };
  parent_lane?: string;
  task_packet_hash?: string;
  notes?: string;
}

export interface PreflightToken {
  schema_version: 1;
  branch: string;
  head_sha: string;
  tier: LaneTier;
  issue_id: string;
  generated_at: string;
  expires_at: string;
  checks: {
    git: string;
    env: string;
    deps: string;
  };
  status: string;
  waivers?: Array<{
    check_id: string;
    reason: string;
    waived_at: string;
  }>;
  baseline_cache_hit?: boolean;
  preflight_run_id?: string;
  required_docs_checked?: string[];
}

export interface MachineResult<T> {
  ok: boolean;
  code: string;
  message: string;
  data?: T;
}

export interface CheckResult {
  id: string;
  status: 'pass' | 'fail' | 'skip' | 'waived' | 'infra_error';
  detail: string;
}

export interface PreflightBaselineCache {
  head_sha: string;
  type_check_passed_at?: string;
  tests_passed_at?: string;
}

export interface PreflightWaiver {
  check_id: string;
  reason: string;
  waived_at: string;
}

export interface PreflightResult {
  schema_version: 1;
  issue_id: string;
  tier: LaneTier;
  branch: string;
  head_sha: string;
  verdict: 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'INFRA';
  run_at: string;
  checks: CheckResult[];
  waivers: PreflightWaiver[];
  token_path: string;
}

export interface TruthCheckResult {
  schema_version: 1;
  issue_id: string;
  tier: LaneTier;
  verdict: 'pass' | 'fail' | 'ineligible' | 'reopen' | 'infra_error';
  exit_code: 0 | 1 | 2 | 3 | 4;
  merge_sha: string | null;
  pr_url: string | null;
  checked_at: string;
  checks: CheckResult[];
  failures: string[];
  reopen_reasons: string[];
  manifest_path: string;
}

export interface CiDoctorResult {
  schema_version: 1;
  run_at: string;
  mode: 'local' | 'scheduled';
  repo: string;
  scope: 'workflows' | 'secrets' | 'protection' | 'preview' | 'required-checks' | 'artifacts' | 'all';
  verdict: 'PASS' | 'FAIL' | 'INFRA';
  exit_code: 0 | 1 | 3;
  checks: CheckResult[];
  failures: string[];
  infra_errors: string[];
  skips: string[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    skip: number;
    infra_error: number;
  };
}

export const ROOT = getRepoRoot();
export const MANIFEST_DIR = path.join(ROOT, 'docs', '06_status', 'lanes');
export const OPS_SCHEMA_DIR = path.join(ROOT, 'docs', '05_operations', 'schemas');
export const PREFLIGHT_DIR = path.join(ROOT, '.out', 'ops', 'preflight');
export const LANE_MANIFEST_SCHEMA_PATH = path.join(
  OPS_SCHEMA_DIR,
  'lane_manifest_v1.schema.json',
);
export const TRUTH_CHECK_RESULT_SCHEMA_PATH = path.join(
  OPS_SCHEMA_DIR,
  'truth_check_result_v1.schema.json',
);
export const EVIDENCE_BUNDLE_SCHEMA_PATH = path.join(
  OPS_SCHEMA_DIR,
  'evidence_bundle_v1.schema.json',
);
export const PREFLIGHT_RESULT_SCHEMA_PATH = path.join(
  OPS_SCHEMA_DIR,
  'preflight_result_v1.schema.json',
);
export const PREFLIGHT_TOKEN_SCHEMA_PATH = path.join(
  OPS_SCHEMA_DIR,
  'preflight_token_v1.schema.json',
);
export const PREFLIGHT_BASELINE_CACHE_PATH = path.join(
  PREFLIGHT_DIR,
  '.baseline-cache.json',
);
export const CI_DOCTOR_DIR = path.join(ROOT, '.out', 'ops', 'ci-doctor');
export const CI_DOCTOR_RESULT_SCHEMA_PATH = path.join(
  OPS_SCHEMA_DIR,
  'ci_doctor_result_v1.schema.json',
);
export const REQUIRED_SECRETS_SCHEMA_PATH = path.join(
  OPS_SCHEMA_DIR,
  'required_secrets_v1.schema.json',
);
export const REQUIRED_CI_CHECKS_SCHEMA_PATH = path.join(
  OPS_SCHEMA_DIR,
  'required_ci_checks_v1.schema.json',
);

const ISSUE_PATTERN = /^(?:UTV2|UNI)-\d+$/;
const BRANCH_PATTERN = /^(?<owner>[a-z]+)\/(?<issue>(?:utv2|uni)-\d+)-(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)$/;
export const ACTIVE_LOCK_STATUSES = new Set<LaneManifestStatus>([
  'started',
  'in_progress',
  'in_review',
  'blocked',
  'reopened',
]);
const MANIFEST_STATUSES = new Set<LaneManifestStatus>([
  'started',
  'in_progress',
  'in_review',
  'merged',
  'done',
  'blocked',
  'reopened',
]);
const TRANSITIONS: Record<LaneManifestStatus, LaneManifestStatus[]> = {
  started: ['in_progress', 'blocked', 'reopened', 'started'],
  in_progress: ['in_review', 'blocked', 'reopened', 'in_progress'],
  in_review: ['merged', 'blocked', 'reopened', 'in_review'],
  merged: ['done', 'reopened', 'merged'],
  done: ['done', 'reopened'],
  blocked: ['started', 'in_progress', 'blocked', 'reopened'],
  reopened: ['in_progress', 'blocked', 'reopened'],
};

export function getRepoRoot(): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error('Not in a git repository');
  }

  return result.stdout.trim();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function relativeToRoot(targetPath: string): string {
  return path.relative(ROOT, targetPath).split(path.sep).join('/');
}

export function issueToManifestPath(issueId: string): string {
  return path.join(MANIFEST_DIR, `${issueId.toUpperCase()}.json`);
}

export function parseArgs(argv: string[]): {
  positionals: string[];
  flags: Map<string, string[]>;
  bools: Set<string>;
} {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const bools = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) {
      positionals.push(current);
      continue;
    }

    const keyValue = current.slice(2).split('=', 2);
    const key = keyValue[0];
    if (keyValue.length === 2) {
      pushFlag(flags, key, keyValue[1] ?? '');
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      bools.add(key);
      continue;
    }

    pushFlag(flags, key, next);
    index += 1;
  }

  return { positionals, flags, bools };
}

function pushFlag(flags: Map<string, string[]>, key: string, value: string): void {
  const existing = flags.get(key) ?? [];
  existing.push(value);
  flags.set(key, existing);
}

export function getFlag(flags: Map<string, string[]>, key: string): string | undefined {
  return flags.get(key)?.at(-1);
}

export function getFlags(flags: Map<string, string[]>, key: string): string[] {
  return [...(flags.get(key) ?? [])];
}

export function requireIssueId(issueId: string): string {
  const normalized = issueId.toUpperCase();
  if (!ISSUE_PATTERN.test(normalized)) {
    throw new Error(`Invalid issue id: ${issueId}`);
  }

  return normalized;
}

export function validateTier(tier: string): LaneTier {
  if (tier === 'T1' || tier === 'T2' || tier === 'T3') {
    return tier;
  }

  throw new Error(`Invalid tier: ${tier}`);
}

export function validateBranchName(branch: string): void {
  if (branch !== branch.toLowerCase()) {
    throw new Error(`Branch must be lowercase: ${branch}`);
  }

  const match = branch.match(BRANCH_PATTERN);
  if (!match?.groups) {
    throw new Error(
      `Branch must match <owner>/<issue-id-lowercase>-<slug>: ${branch}`,
    );
  }
}

export function worktreePathForBranch(branch: string): string {
  return path.join(ROOT, '.out', 'worktrees', branch.replaceAll('/', '__'));
}

export function preflightTokenPathForBranch(branch: string): string {
  return path.join(PREFLIGHT_DIR, `${branch}.json`);
}

export function preflightResultPathForBranch(branch: string): string {
  return path.join(PREFLIGHT_DIR, `${branch}.result.json`);
}

export function normalizeRepoRelativePath(
  input: string,
  options: { requireExistingFile?: boolean } = {},
): string {
  let normalized = input.trim().replaceAll('\\', '/');
  normalized = normalized.replace(/^\.\/+/, '');
  normalized = normalized.replace(/\/{2,}/g, '/');

  if (!normalized) {
    throw new Error('File scope path cannot be empty');
  }
  if (normalized.includes('../') || normalized.startsWith('..')) {
    throw new Error(`Parent traversal is not allowed: ${input}`);
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new Error(`Absolute paths are not allowed in file scope: ${input}`);
  }
  if (/[*?[\]{}]/.test(normalized)) {
    throw new Error(`Glob patterns are not allowed in file scope: ${input}`);
  }

  if (options.requireExistingFile) {
    const absolute = path.join(ROOT, normalized);
    if (!fs.existsSync(absolute)) {
      throw new Error(`File scope path does not exist: ${normalized}`);
    }
    if (!fs.statSync(absolute).isFile()) {
      throw new Error(`File scope must reference a file, not a directory: ${normalized}`);
    }
  }

  return normalized;
}

export function normalizeFileScopePath(input: string): string {
  return normalizeRepoRelativePath(input, { requireExistingFile: true });
}

export function normalizeFileScope(pathsToNormalize: string[]): string[] {
  const seen = new Set<string>();
  const normalized = pathsToNormalize.map((entry) => normalizeFileScopePath(entry));
  for (const filePath of normalized) {
    seen.add(filePath);
  }

  return [...seen].sort((left, right) => left.localeCompare(right));
}

export function normalizeRepoRelativePaths(pathsToNormalize: string[]): string[] {
  const seen = new Set<string>();
  const normalized = pathsToNormalize.map((entry) => normalizeRepoRelativePath(entry));
  for (const filePath of normalized) {
    seen.add(filePath);
  }

  return [...seen].sort((left, right) => left.localeCompare(right));
}

export function defaultProofPaths(issueId: string, tier: LaneTier): string[] {
  const proofRoot = path.posix.join('docs', '06_status', 'proof', issueId);
  if (tier === 'T1') {
    return [`${proofRoot}/evidence.json`];
  }
  if (tier === 'T2') {
    return [`${proofRoot}/diff-summary.md`, `${proofRoot}/verification.log`];
  }

  return [];
}

export function git(args: string[], cwd = ROOT): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

export function currentHeadSha(cwd = ROOT): string {
  const result = git(['rev-parse', 'HEAD'], cwd);
  if (!result.ok || !result.stdout) {
    throw new Error(`Unable to determine HEAD SHA: ${result.stderr || 'unknown error'}`);
  }

  return result.stdout;
}

export function branchExists(branch: string): boolean {
  return git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
}

export function worktreeExists(worktreePath: string): boolean {
  return fs.existsSync(worktreePath);
}

export function createBranchAndWorktree(branch: string, worktreePath: string): void {
  ensureDir(path.dirname(worktreePath));
  const result = git(['worktree', 'add', worktreePath, '-b', branch, 'main']);
  if (!result.ok) {
    throw new Error(`Failed to create worktree: ${result.stderr}`);
  }
}

export function parseJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function readManifest(issueId: string): LaneManifest {
  return parseJsonFile<LaneManifest>(issueToManifestPath(issueId));
}

export function manifestExists(issueId: string): boolean {
  return fs.existsSync(issueToManifestPath(issueId));
}

export function readAllManifestPaths(): string[] {
  if (!fs.existsSync(MANIFEST_DIR)) {
    return [];
  }

  return fs
    .readdirSync(MANIFEST_DIR)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(MANIFEST_DIR, entry))
    .sort((left, right) => left.localeCompare(right));
}

export function readAllManifests(): LaneManifest[] {
  return readAllManifestPaths().map((filePath) => parseJsonFile<LaneManifest>(filePath));
}

export function validateManifestSchemaDependencies(): void {
  if (!fs.existsSync(LANE_MANIFEST_SCHEMA_PATH)) {
    throw new Error(
      `Missing required schema: ${relativeToRoot(LANE_MANIFEST_SCHEMA_PATH)}`,
    );
  }
}

export function validateTruthResultSchemaDependencies(): void {
  if (!fs.existsSync(TRUTH_CHECK_RESULT_SCHEMA_PATH)) {
    throw new Error(
      `Missing required schema: ${relativeToRoot(TRUTH_CHECK_RESULT_SCHEMA_PATH)}`,
    );
  }
}

export function validatePreflightSchemaDependencies(): void {
  if (!fs.existsSync(PREFLIGHT_RESULT_SCHEMA_PATH)) {
    throw new Error(
      `Missing required schema: ${relativeToRoot(PREFLIGHT_RESULT_SCHEMA_PATH)}`,
    );
  }
  if (!fs.existsSync(PREFLIGHT_TOKEN_SCHEMA_PATH)) {
    throw new Error(
      `Missing required schema: ${relativeToRoot(PREFLIGHT_TOKEN_SCHEMA_PATH)}`,
    );
  }
}

export function validateCiDoctorSchemaDependencies(): void {
  for (const schemaPath of [
    CI_DOCTOR_RESULT_SCHEMA_PATH,
    REQUIRED_SECRETS_SCHEMA_PATH,
    REQUIRED_CI_CHECKS_SCHEMA_PATH,
  ]) {
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Missing required schema: ${relativeToRoot(schemaPath)}`);
    }
  }
}

export function validateManifest(manifest: LaneManifest, filePath?: string): string[] {
  const errors: string[] = [];
  const sourcePath = filePath ? relativeToRoot(filePath) : `${manifest.issue_id}.json`;

  if (manifest.schema_version !== 1) {
    errors.push(`${sourcePath}: schema_version must be 1`);
  }
  if (!ISSUE_PATTERN.test(manifest.issue_id)) {
    errors.push(`${sourcePath}: issue_id must match UTV2-###`);
  }
  if (!MANIFEST_STATUSES.has(manifest.status)) {
    errors.push(`${sourcePath}: status is invalid`);
  }
  if (!['claude', 'codex-cli', 'codex-cloud'].includes(manifest.lane_type)) {
    errors.push(`${sourcePath}: lane_type is invalid`);
  }
  if (!['claude', 'codex-cli', 'pm'].includes(manifest.created_by)) {
    errors.push(`${sourcePath}: created_by is invalid`);
  }
  if (!['T1', 'T2', 'T3'].includes(manifest.tier)) {
    errors.push(`${sourcePath}: tier is invalid`);
  }
  if (!path.isAbsolute(manifest.worktree_path)) {
    errors.push(`${sourcePath}: worktree_path must be absolute`);
  }
  try {
    validateBranchName(manifest.branch);
  } catch (error) {
    errors.push(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (manifest.base_branch !== 'main') {
    errors.push(`${sourcePath}: base_branch must be main in Phase 1`);
  }
  if (!Array.isArray(manifest.files_changed)) {
    errors.push(`${sourcePath}: files_changed must be an array`);
  }
  if (!Array.isArray(manifest.file_scope_lock) || manifest.file_scope_lock.length === 0) {
    errors.push(`${sourcePath}: file_scope_lock must contain at least one file`);
  }
  if (!Array.isArray(manifest.expected_proof_paths)) {
    errors.push(`${sourcePath}: expected_proof_paths must be an array`);
  }
  if (!Array.isArray(manifest.blocked_by)) {
    errors.push(`${sourcePath}: blocked_by must be an array`);
  }
  if (!Array.isArray(manifest.truth_check_history)) {
    errors.push(`${sourcePath}: truth_check_history must be an array`);
  }
  if (!Array.isArray(manifest.reopen_history)) {
    errors.push(`${sourcePath}: reopen_history must be an array`);
  }
  if (!manifest.preflight_token) {
    errors.push(`${sourcePath}: preflight_token is required`);
  }
  if (!manifest.started_at || Number.isNaN(Date.parse(manifest.started_at))) {
    errors.push(`${sourcePath}: started_at must be ISO-8601`);
  }
  if (!manifest.heartbeat_at || Number.isNaN(Date.parse(manifest.heartbeat_at))) {
    errors.push(`${sourcePath}: heartbeat_at must be ISO-8601`);
  }
  if (manifest.closed_at !== null && Number.isNaN(Date.parse(manifest.closed_at))) {
    errors.push(`${sourcePath}: closed_at must be null or ISO-8601`);
  }
  if (filePath && path.basename(filePath, '.json') !== manifest.issue_id) {
    errors.push(`${sourcePath}: filename must match issue_id`);
  }
  for (const entry of manifest.file_scope_lock ?? []) {
    try {
      const normalized = normalizeRepoRelativePath(entry);
      if (normalized !== entry) {
        errors.push(`${sourcePath}: file_scope_lock entry must be canonical: ${entry}`);
      }
    } catch (error) {
      errors.push(
        `${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return errors;
}

export function writeManifest(manifest: LaneManifest): void {
  validateManifestSchemaDependencies();
  const manifestPath = issueToManifestPath(manifest.issue_id);
  const errors = validateManifest(manifest, manifestPath);
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  writeJsonFile(manifestPath, manifest);
}

export function updateManifest(
  issueId: string,
  mutate: (manifest: LaneManifest) => LaneManifest,
): LaneManifest {
  const manifest = readManifest(issueId);
  const updated = mutate({ ...manifest });
  writeManifest(updated);
  return updated;
}

export function withHeartbeat(manifest: LaneManifest, timestamp = nowIso()): LaneManifest {
  return {
    ...manifest,
    heartbeat_at: timestamp,
  };
}

export function assertStatusTransition(
  previous: LaneManifestStatus,
  next: LaneManifestStatus,
): void {
  const allowed = TRANSITIONS[previous] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`Illegal manifest status transition: ${previous} -> ${next}`);
  }
}

export function activeManifestOverlap(
  issueId: string,
  requestedFiles: string[],
): { issue_id: string; overlapping_files: string[] } | null {
  for (const manifest of readAllManifests()) {
    if (manifest.issue_id === issueId) {
      continue;
    }
    if (!ACTIVE_LOCK_STATUSES.has(manifest.status)) {
      continue;
    }

    const overlappingFiles = requestedFiles.filter((filePath) =>
      manifest.file_scope_lock.includes(filePath),
    );
    if (overlappingFiles.length > 0) {
      return {
        issue_id: manifest.issue_id,
        overlapping_files: overlappingFiles,
      };
    }
  }

  return null;
}

export function validatePreflightToken(
  issueId: string,
  branch: string,
  currentHead: string,
): { token: PreflightToken; tokenPath: string; tokenRelativePath: string } {
  const tokenPath = preflightTokenPathForBranch(branch);
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Missing preflight token: ${relativeToRoot(tokenPath)}`);
  }

  const token = parseJsonFile<PreflightToken>(tokenPath);
  if (token.schema_version !== 1) {
    throw new Error('Preflight token schema_version must be 1');
  }
  if (token.status !== 'pass') {
    throw new Error('Preflight token status must be pass');
  }
  if (token.issue_id !== issueId) {
    throw new Error('Preflight token issue_id does not match requested issue');
  }
  if (token.branch !== branch) {
    throw new Error('Preflight token branch does not match requested branch');
  }
  if (token.head_sha !== currentHead) {
    throw new Error('Preflight token head_sha does not match current HEAD');
  }
  if (Number.isNaN(Date.parse(token.expires_at))) {
    throw new Error('Preflight token expires_at must be ISO-8601');
  }
  if (new Date().getTime() >= new Date(token.expires_at).getTime()) {
    throw new Error('Preflight token is expired');
  }

  return {
    token,
    tokenPath,
    tokenRelativePath: relativeToRoot(tokenPath),
  };
}

export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function emitMachineError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  emitJson({
    ok: false,
    code,
    message,
    ...details,
  });
  process.exit(1);
}

export function createManifest(input: {
  issue_id: string;
  tier: LaneTier;
  branch: string;
  worktree_path: string;
  file_scope_lock: string[];
  expected_proof_paths: string[];
  preflight_token: string;
  lane_type?: LaneType;
  created_by?: CreatedBy;
  status?: LaneManifestStatus;
  now?: string;
}): LaneManifest {
  const timestamp = input.now ?? nowIso();
  return {
    schema_version: 1,
    issue_id: input.issue_id,
    lane_type: input.lane_type ?? 'codex-cli',
    tier: input.tier,
    worktree_path: input.worktree_path,
    branch: input.branch,
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: input.file_scope_lock,
    expected_proof_paths: input.expected_proof_paths,
    status: input.status ?? 'started',
    started_at: timestamp,
    heartbeat_at: timestamp,
    closed_at: null,
    blocked_by: [],
    preflight_token: input.preflight_token,
    created_by: input.created_by ?? 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
  };
}

export function readPreflightBaselineCache(): PreflightBaselineCache | null {
  if (!fs.existsSync(PREFLIGHT_BASELINE_CACHE_PATH)) {
    return null;
  }

  try {
    return parseJsonFile<PreflightBaselineCache>(PREFLIGHT_BASELINE_CACHE_PATH);
  } catch {
    return null;
  }
}

export function writePreflightBaselineCache(cache: PreflightBaselineCache): void {
  writeJsonFile(PREFLIGHT_BASELINE_CACHE_PATH, cache);
}

export function removeFileIfExists(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // fail closed callers may continue; deletion failure is non-fatal by spec
  }
}
