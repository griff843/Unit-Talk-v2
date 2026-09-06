import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ModelRoutingBlock } from './model-routing.js';

export type LaneTier = 'T1' | 'T2' | 'T3';
export type LaneManifestStatus =
  | 'started'
  | 'in_progress'
  | 'in_review'
  | 'merged'
  | 'done'
  /**
   * UTV2-1619 capability 13. Truthful terminal states, added because the enum
   * previously offered only `merged` and `done` as non-consuming terminals --
   * so a lane that failed, was parked, or was superseded could only release its
   * resources by having a completion written over it, which fabricates an
   * outcome that never happened.
   *
   * `failed`     - the lane ended without completing. Releases resources,
   *                asserts NO completion, and is refused as success by the
   *                done-gate.
   * `parked`     - deliberately set aside, retaining identity, scope lock and
   *                history. Releases all capacity while remaining visible to
   *                governance and file-scope conflict checks.
   * `superseded` - the work was overtaken by other work that shipped.
   * `cancelled`  - the work was withdrawn and will not be done.
   *
   * `superseded` and `cancelled` are deliberately distinct from `done`:
   * collapsing them destroys the difference between work that shipped and work
   * that was abandoned because something else did.
   */
  | 'failed'
  | 'parked'
  | 'superseded'
  | 'cancelled'
  | 'blocked'
  | 'reopened';
export type CanonicalLaneType =
  | 'runtime'
  | 'modeling'
  | 'verification'
  | 'hygiene'
  | 'migration'
  | 'governance'
  | 'delivery-ui'
  | 'data-canonical';

export type LegacyLaneType = 'claude' | 'codex' | 'codex-cli' | 'codex-cloud';

export type LaneType = CanonicalLaneType | LegacyLaneType;

export type LaneExecutor = 'claude' | 'codex-cli' | 'codex-cloud';

export type CreatedBy = 'claude' | 'codex-cli' | 'pm';

export interface TruthCheckHistoryEntry {
  checked_at: string;
  verdict: 'pass' | 'fail' | 'reopen';
  merge_sha: string | null;
  failures: string[];
  runner: 'ops:lane-close' | 'ops:reconcile' | 'manual';
}

export interface ReopenHistoryEntry {
  timestamp: string;
  reasons: string[];
  detected_by: string;
}

/**
 * One audited narrowing of a lane's `file_scope_lock` (UTV2-1762).
 *
 * `LANE_MANIFEST_SPEC.md` used to name an `ops:lane:relock` command as the way to
 * "redefine scope" when two lanes contend for a path. That command was never
 * implemented -- it matched nothing in `scripts/`, `package.json`, or
 * `.github/workflows/` -- so in practice a lane that declared a path it never
 * touched held that path hostage until it closed, and the only escape was to
 * falsify the historical `files_changed` record (correctly rejected, PR #1288).
 *
 * This entry is the honest alternative. It is append-only and removal-only: it
 * records that specific paths were dropped from `file_scope_lock`, who dropped
 * them, against which PR and exact head SHA, and what the lock hashed to before
 * and after. `previous_lock_hash` -> `resulting_lock_hash` forms a chain that
 * `validateScopeReleaseHistory` verifies terminates at the manifest's CURRENT
 * lock, so a lock cannot be edited without a matching audited entry, and an
 * entry cannot be forged for a lock state that never existed.
 *
 * Nothing here can widen scope: `released_paths` are, by construction, paths
 * that left the lock. Re-acquiring a released path requires a new lane-start,
 * not an edit to this array.
 */
export interface ScopeReleaseHistoryEntry {
  released_at: string;
  actor: string;
  reason: string;
  pr_number: number;
  pr_url: string;
  head_sha: string;
  previous_lock_hash: string;
  resulting_lock_hash: string;
  released_paths: string[];
  verifications: Array<{ check: string; status: 'pass'; detail: string }>;
}

export interface P0ProtocolBlock {
  required: boolean;
  codex_implementation?: { recorded: boolean; pr_url?: string };
  claude_critique?: { recorded: boolean; artifact_path?: string };
  human_approval?: { recorded: boolean; pm_verdict_url?: string };
  runtime_verification?: {
    recorded: boolean;
    artifact_path?: string;
    result?: 'pass' | 'fail';
  };
  merge_type?: 'manual' | 'auto' | null;
}

/**
 * Lane manifest schema versions. `1` is the historical version (all lanes before
 * UTV2-1526's model-routing compatibility rework). `2` is the current version written
 * by createManifest for every newly created lane going forward.
 *
 * This is the real compatibility boundary for Codex model routing (UTV2-1526 PM review
 * finding #2) -- NOT field presence. Presence-based detection cannot distinguish "this
 * manifest predates model_routing" from "someone deleted model_routing from a v2
 * manifest", so validateManifest enforces version-scoped rules:
 *   - schema_version 1: model_routing is optional (legacy path; codex-exec.ts resolves
 *     the documented default when absent).
 *   - schema_version 2: a Codex-executor manifest MUST have a valid model_routing block
 *     (deleting it fails validation); a Claude-executor manifest must not have one.
 *   - any other value: rejected outright (fail closed).
 */
export type LaneManifestSchemaVersion = 1 | 2;
export const LANE_MANIFEST_CURRENT_SCHEMA_VERSION: LaneManifestSchemaVersion = 2;
const VALID_LANE_MANIFEST_SCHEMA_VERSIONS: readonly LaneManifestSchemaVersion[] = [1, 2];

export interface LaneManifest {
  schema_version: LaneManifestSchemaVersion;
  issue_id: string;
  /**
   * The tracker key for this lane, or `null` when the lane has no tracker
   * issue (tracker independence, ratified 2026-09-05).
   *
   * Three-valued on purpose:
   *   - a string  -- this lane corresponds to that tracker issue
   *   - `null`    -- this lane deliberately has no tracker issue; every
   *                  tracker-dependent check SKIPS rather than failing
   *   - `undefined` (absent) -- a manifest written before this field existed.
   *                  `resolveTrackerRef` falls back to `issue_id` for those,
   *                  so historical lanes keep the exact behaviour they had.
   *
   * A missing field must never be read as `null`: that would silently turn
   * every pre-existing lane's tracker checks into skips, which is the
   * unconditional-skip failure mode acceptance criterion 4 exists to refuse.
   */
  tracker_ref?: string | null;
  lane_type: LaneType;
  executor?: LaneExecutor;
  tier: LaneTier;
  worktree_path: string;
  execution_location?: {
    mode: 'worktree' | 'main-control';
    cwd: string;
    package_install: 'not_required' | 'required' | 'verified';
    setup_command: string | null;
    main_checkout_control_only: boolean;
  };
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
  /**
   * Append-only audit trail of narrowing-only `file_scope_lock` releases
   * (UTV2-1762). Absent on lanes that never released a path. See
   * ScopeReleaseHistoryEntry and validateScopeReleaseHistory.
   */
  scope_release_history?: ScopeReleaseHistoryEntry[];
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
  p0_protocol?: P0ProtocolBlock;
  /**
   * Deterministic Codex model-profile decision (UTV2-1526). Required for every
   * schema_version-2 Codex-executor manifest; forbidden on any Claude-executor manifest,
   * at any schema version. Optional (legacy path) on schema_version-1 manifests. See
   * docs/05_operations/policies/codex-model-routing.json and
   * LANE_MANIFEST_CURRENT_SCHEMA_VERSION's doc comment above for the version boundary.
   */
  model_routing?: ModelRoutingBlock;
  /**
   * The target issue this verification lane produces proof for (UTV2-1533 P2 fix).
   * Required for every schema_version-2 lane_type:"verification" manifest; forbidden on
   * any other lane_type, at any schema version. There is no reliable existing field to
   * derive this from -- a verification lane's own issue_id is its own tracking issue,
   * not necessarily the issue it verifies, and its file_scope_lock (test files, proof
   * dirs) does not reliably encode a UTV2-### id in the path. Same version-gated
   * enforcement pattern as model_routing above (checkConcurrencyLimits' per-target cap
   * in lane-start.ts depends on this being present and trustworthy).
   */
  verification_target?: string;
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
  // UTV2-1845: `blocked_by_containment` is neither an infrastructure fault nor a policy
  // refusal -- it is a check that cannot run because containment deliberately withholds its
  // input. It resolves to the same verdict as `infra_error` today; the separation exists so a
  // deliberate policy state stops being reported as a broken dependency.
  status: 'pass' | 'fail' | 'skip' | 'waived' | 'infra_error' | 'blocked_by_containment';
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
  /**
   * UTV2-1691 — machine-readable dry-run marker.
   *
   * `--json` is the automation interface, so a dry run MUST be distinguishable
   * there, not only in the human-readable branch. Without this field a passing
   * dry run is byte-indistinguishable from a certifying live run (same verdict,
   * same exit code 0), and downstream triage tooling can record it as a real
   * gate pass. Absent/false means the run persisted normally.
   */
  dry_run?: boolean;
  /**
   * UTV2-1691 — explicit certification flag. False on a dry run.
   *
   * `verdict: 'pass'` answers "would this lane close?"; `certifies` answers
   * "did this run record anything?". They are different questions and conflating
   * them is the misuse this capability had to guard against.
   */
  certifies?: boolean;
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

// Tracker independence (ratified 2026-09-05). `issue_id` is REPO-OWNED work
// identity, not a tracker key. `WORK-###` is the repo-minted namespace for work
// that has no tracker issue at all; `UTV2-###`/`UNI-###` remain legal and, when
// a lane genuinely corresponds to a Linear issue, the tracker key is carried
// explicitly and nullably in `tracker_ref` rather than being inferred from this
// field. See LaneManifest.tracker_ref.
//
// KNOWN BOUND: `merge-gate.yml`, `p0-protocol.yml` and
// `executor-result-validator.yml` are RESERVED surfaces under the same
// ratification and still resolve a lane by `UTV2-###`. A `WORK-###` lane is
// therefore fully usable for discovery, delegation, verification, PR and
// closeout, and is NOT yet mergeable. Do not widen those workflows here.
// The single source of truth for which identifier namespaces name a unit of work.
// `branch-discipline-guard.ts` kept its own copy of this alternation and was not
// widened when `WORK-###` was minted, which silently made an issue-ID-free task
// unable to pass preflight PX2. Derive both patterns here so they cannot drift again.
export const ISSUE_ID_NAMESPACES = ['UTV2', 'UNI', 'WORK'] as const;
const ISSUE_NAMESPACE_ALTERNATION = ISSUE_ID_NAMESPACES.join('|');

/** Scans free text for every work identifier it contains. Global and case-insensitive. */
export function issueIdScanPattern(): RegExp {
  return new RegExp(`\\b(?:${ISSUE_NAMESPACE_ALTERNATION})-\\d+\\b`, 'gi');
}

const ISSUE_PATTERN = new RegExp(`^(?:${ISSUE_NAMESPACE_ALTERNATION})-\\d+$`);
// verification_target is intentionally narrower than the general ISSUE_PATTERN above (which
// also accepts UNI-###): the manifest schema (lane_manifest_v1.schema.json) and
// LANE_MANIFEST_SPEC.md §16 both document verification_target as UTV2-### only, and
// requireIssueId()/ISSUE_PATTERN's UNI- acceptance let a UNI-### target silently pass
// validation while disagreeing with the documented JSON schema (Codex review, PR #1215).
const VERIFICATION_TARGET_PATTERN = /^(?:UTV2|WORK)-\d+$/;
// A tracker key is a Linear issue identifier. `WORK-###` is deliberately NOT
// one: it is repo-minted and no tracker issue exists by that name.
const TRACKER_REF_PATTERN = /^(?:UTV2|UNI)-\d+$/;
const BRANCH_PATTERN = /^(?<owner>[a-z]+)\/(?<issue>(?:utv2|uni|work)-\d+)-(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const LEGACY_DISPATCH_AUTO_PREFLIGHT_TOKEN = 'dispatch-auto';
/**
 * UTV2-1619 capability 13: capacity is a MATRIX, not one flat set.
 *
 * Before this, `ACTIVE_LOCK_STATUSES` answered every capacity question --
 * total, executor, and type caps were all computed from the same membership.
 * That conflates two different things: whether a lane occupies a slot, and
 * whether it occupies an executor's attention. A lane sitting in `in_review`
 * waiting on a human consumed executor capacity identically to one being
 * actively worked, so lanes nobody was working denied admission to lanes
 * somebody would have.
 *
 * The sets below are deliberately declared separately rather than derived from
 * each other, so that changing one cap's semantics cannot silently change
 * another's.
 */

/** Occupies a lane slot: counts against the total cap. */
export const TOTAL_CAPACITY_STATUSES = new Set<LaneManifestStatus>([
  'started',
  'in_progress',
  'in_review',
  'blocked',
  'reopened',
]);

/**
 * Occupies an executor's attention: counts against per-executor caps.
 *
 * Excludes `in_review`, `blocked` and `parked` -- in all three the lane is
 * waiting on something outside the executor (a human verdict, a dependency, a
 * deliberate pause), so no executor is working it and holding an executor slot
 * misrepresents the board.
 */
export const EXECUTOR_CAPACITY_STATUSES = new Set<LaneManifestStatus>([
  'started',
  'in_progress',
  'reopened',
]);

/**
 * Occupies a lane-type slot (governance, hygiene, ...): counts against type
 * caps. Type caps exist to bound concurrent change to a shared surface, which a
 * lane still does while awaiting review -- so this tracks slot occupancy, not
 * executor attention.
 */
export const TYPE_CAPACITY_STATUSES = new Set<LaneManifestStatus>([
  'started',
  'in_progress',
  'in_review',
  'blocked',
  'reopened',
]);

/**
 * Terminal states: the lane has ended. Reaching one of these MUST release every
 * resource the lane holds -- capacity, lease, locks, worktree, branch. Only
 * `done` and `merged` assert success; the others explicitly do not.
 */
export const TERMINAL_STATUSES = new Set<LaneManifestStatus>([
  'merged',
  'done',
  'failed',
  'superseded',
  'cancelled',
]);

/** Terminal states that assert the work completed. `failed` is never here. */
export const SUCCESS_TERMINAL_STATUSES = new Set<LaneManifestStatus>(['merged', 'done']);

/**
 * Retained for existing callers (reconcile, orchestration-reconciler, and the
 * file-scope guard's mirror). This is deliberately broader than every capacity
 * set: a parked lane consumes no capacity but keeps its scope lock. Kept as its
 * own literal rather than derived, so a future change to capacity membership
 * cannot silently release a conflict constraint.
 */
export const ACTIVE_LOCK_STATUSES = new Set<LaneManifestStatus>([
  'started',
  'in_progress',
  'in_review',
  'blocked',
  'parked',
  'reopened',
]);
const MANIFEST_STATUSES = new Set<LaneManifestStatus>([
  'started',
  'in_progress',
  'in_review',
  'merged',
  'done',
  'failed',
  'parked',
  'superseded',
  'cancelled',
  'blocked',
  'reopened',
]);
const LEGACY_LANE_TYPE_TO_EXECUTOR: Partial<Record<LegacyLaneType, LaneExecutor>> = {
  claude: 'claude',
  codex: 'codex-cli',
  'codex-cli': 'codex-cli',
  'codex-cloud': 'codex-cloud',
};
const CODEX_EXECUTORS = new Set<LaneExecutor>(['codex-cli', 'codex-cloud']);
/**
 * UTV2-1619 capability 13: every non-terminal state may reach a truthful
 * terminal. `failed`, `superseded` and `cancelled` are reachable from anywhere
 * work can be in flight, because a lane can be abandoned at any point -- and if
 * the only reachable terminals were `merged`/`done`, recording an honest
 * outcome would remain impossible, which is the defect this closes.
 *
 * `failed`, `superseded` and `cancelled` accept `reopened` so a mistaken
 * terminal can be corrected, but never transition directly into `done`: a
 * failed lane that is later completed must be reopened and re-closed through
 * the normal gate, leaving both facts in the history.
 */
const NON_SUCCESS_TERMINALS: LaneManifestStatus[] = ['failed', 'superseded', 'cancelled'];

/**
 * UTV2-1756: the statuses whose on-disk record gets a veto over an incoming
 * write. These are the settled ones -- the records that represent a decision
 * already taken, and that a repair job has no business reopening by side
 * effect. `merged` is included: it is not lock-holding, but rolling a merged
 * lane back to `blocked` would be the same class of regression as rolling a
 * `superseded` one back, and `TRANSITIONS` already permits every legitimate
 * move out of it.
 */
const TERMINAL_WRITE_PROTECTED_STATUSES = new Set<LaneManifestStatus>([
  'merged',
  'done',
  ...NON_SUCCESS_TERMINALS,
]);
const TRANSITIONS: Record<LaneManifestStatus, LaneManifestStatus[]> = {
  started: ['in_progress', 'blocked', 'parked', 'reopened', 'started', ...NON_SUCCESS_TERMINALS],
  in_progress: ['in_review', 'blocked', 'parked', 'reopened', 'in_progress', ...NON_SUCCESS_TERMINALS],
  in_review: ['merged', 'blocked', 'parked', 'reopened', 'in_review', ...NON_SUCCESS_TERMINALS],
  merged: ['done', 'reopened', 'merged', ...NON_SUCCESS_TERMINALS],
  done: ['done', 'reopened'],
  blocked: ['started', 'in_progress', 'blocked', 'parked', 'reopened', ...NON_SUCCESS_TERMINALS],
  parked: ['started', 'in_progress', 'blocked', 'parked', 'reopened', ...NON_SUCCESS_TERMINALS],
  failed: ['reopened', 'failed'],
  superseded: ['reopened', 'superseded'],
  cancelled: ['reopened', 'cancelled'],
  reopened: ['in_progress', 'blocked', 'parked', 'reopened', ...NON_SUCCESS_TERMINALS],
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

export function readConfiguredEnvValue(
  key: string,
  root = ROOT,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromProcess = env[key]?.trim();
  if (fromProcess) {
    return fromProcess;
  }

  for (const fileName of ['local.env', '.env', '.env.example']) {
    const value = readEnvFileValue(path.join(root, fileName), key);
    if (value) {
      return value;
    }
  }

  return '';
}

function readEnvFileValue(filePath: string, key: string): string {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    if (line.slice(0, separator).trim() !== key) {
      continue;
    }
    return line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
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

/**
 * Deliberately stricter than requireIssueId()/ISSUE_PATTERN (which also accepts UNI-###):
 * verification_target is documented as UTV2-### only in lane_manifest_v1.schema.json and
 * LANE_MANIFEST_SPEC.md §16. Using the general issue-id helper here would silently let a
 * UNI-### value pass despite disagreeing with the documented JSON schema (Codex review,
 * PR #1215).
 */
/**
 * Resolve the tracker key a lane's tracker-dependent checks should use.
 *
 * Tracker independence (ratified 2026-09-05). Returns `null` exactly when the
 * lane declares it has no tracker issue. Absence of the field is NOT absence of
 * a tracker: every manifest written before `tracker_ref` existed falls back to
 * `issue_id`, so historical lanes keep the behaviour they had.
 *
 * A tracker key that is not a legal tracker identifier (for example a
 * repo-minted `WORK-###` used as `issue_id`) also resolves to `null` -- there is
 * no issue by that name to look up, and inventing one would produce a lookup
 * that always fails rather than a check that correctly skips.
 */
export function resolveTrackerRef(
  manifest: Pick<LaneManifest, 'issue_id'> & { tracker_ref?: string | null },
): string | null {
  if (manifest.tracker_ref === null) return null;
  const candidate = (manifest.tracker_ref ?? manifest.issue_id ?? '').trim();
  if (!candidate) return null;
  return TRACKER_REF_PATTERN.test(candidate.toUpperCase()) ? candidate.toUpperCase() : null;
}

export function requireVerificationTarget(value: string): string {
  const normalized = value.toUpperCase();
  if (!VERIFICATION_TARGET_PATTERN.test(normalized)) {
    throw new Error(`verification_target must match UTV2-### or WORK-### (got "${value}")`);
  }

  return normalized;
}

export function validateTier(tier: string): LaneTier {
  if (tier === 'T1' || tier === 'T2' || tier === 'T3') {
    return tier;
  }

  throw new Error(`Invalid tier: ${tier}`);
}

export function resolveLaneExecutor(manifest: Pick<LaneManifest, 'executor' | 'lane_type'>): LaneExecutor | null {
  if (manifest.executor) {
    return manifest.executor;
  }

  return LEGACY_LANE_TYPE_TO_EXECUTOR[manifest.lane_type as LegacyLaneType] ?? null;
}

export function isCodexLane(manifest: Pick<LaneManifest, 'executor' | 'lane_type'>): boolean {
  const executor = resolveLaneExecutor(manifest);
  return executor ? CODEX_EXECUTORS.has(executor) : false;
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
  const hasTrailingDirectoryGlob = normalized.endsWith('/**');
  const pathWithoutTrailingDirectoryGlob = hasTrailingDirectoryGlob
    ? normalized.slice(0, -3)
    : normalized;
  const containsUnsupportedGlobSyntax = /[*?{}]/.test(pathWithoutTrailingDirectoryGlob);
  if (containsUnsupportedGlobSyntax) {
    throw new Error(`Only a trailing /** directory glob is allowed in file scope: ${input}`);
  }

  if (options.requireExistingFile) {
    if (hasTrailingDirectoryGlob) {
      const directory = normalized.slice(0, -3);
      const absoluteDirectory = path.join(ROOT, directory);
      if (!fs.existsSync(absoluteDirectory)) {
        throw new Error(`File scope directory does not exist: ${directory}`);
      }
      if (!fs.statSync(absoluteDirectory).isDirectory()) {
        throw new Error(`File scope glob must reference a directory: ${normalized}`);
      }
      return normalized;
    }
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

const PROOF_PATH_PREFIX = 'docs/06_status/proof/';

/**
 * Normalize a file-scope path. Paths under `docs/06_status/proof/**` are
 * intent declarations — the lane will create them — so the existence check
 * is skipped for those entries. All other paths must already exist on disk.
 */
export function normalizeFileScopePath(input: string): string {
  // Perform structural normalization first (without existence check).
  const normalized = normalizeRepoRelativePath(input);
  // Proof paths are intent declarations; skip the existence check.
  if (normalized.startsWith(PROOF_PATH_PREFIX)) {
    return normalized;
  }
  // All other paths must exist on disk.
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

/**
 * Canonical Delivery/UI app roots (docs/governance/LANE_TAXONOMY.md §7 "Allowed
 * paths"). Single source of truth -- do not duplicate this list elsewhere.
 */
export const DELIVERY_UI_APP_ROOTS: Readonly<Record<string, string>> = {
  'command-center': 'apps/command-center/',
  'discord-bot': 'apps/discord-bot/',
  'smart-form': 'apps/smart-form/',
  'qa-agent': 'apps/qa-agent/',
};

/**
 * Deterministically derives which Delivery/UI app a lane's file_scope_lock
 * belongs to (UTV2-1533 P2 fix). Deliberately does NOT infer from free-form
 * text (issue title, branch name, commit message) -- only from file_scope_lock,
 * which is validated, canonical, and immutable for lane life. Fails closed
 * (returns null) when the scope is empty, touches zero canonical app roots, or
 * spans more than one app -- callers must treat null as "cannot admit this
 * lane" rather than falling back to a guess.
 */
export function deriveDeliveryUiApp(fileScopeLock: string[]): string | null {
  if (fileScopeLock.length === 0) return null;
  const apps = new Set<string>();
  for (const entry of fileScopeLock) {
    const normalized = entry.replace(/^\.\//, '');
    const match = Object.entries(DELIVERY_UI_APP_ROOTS).find(([, prefix]) =>
      normalized.startsWith(prefix),
    );
    if (!match) return null;
    apps.add(match[0]);
  }
  return apps.size === 1 ? [...apps][0]! : null;
}

export function validatePreflightTokenPathValue(
  preflightToken: string,
  options: { requireExistingFile?: boolean } = {},
): string {
  if (preflightToken.trim() === LEGACY_DISPATCH_AUTO_PREFLIGHT_TOKEN) {
    throw new Error('preflight_token must reference a real preflight token file, not dispatch-auto');
  }
  if (path.win32.isAbsolute(preflightToken)) {
    throw new Error(`preflight_token must be a repo-relative path: ${preflightToken}`);
  }

  const normalized = normalizeRepoRelativePath(preflightToken);
  if (normalized !== preflightToken) {
    throw new Error(`preflight_token must be canonical: ${preflightToken}`);
  }

  if (options.requireExistingFile) {
    const absolute = path.join(ROOT, normalized);
    if (!fs.existsSync(absolute)) {
      throw new Error(`preflight_token file does not exist: ${normalized}`);
    }
    if (!fs.statSync(absolute).isFile()) {
      throw new Error(`preflight_token must reference a file, not a directory: ${normalized}`);
    }
  }

  return normalized;
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
    return [`${proofRoot}/diff-summary.md`, `${proofRoot}/verification.md`];
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

/**
 * UTV2-1756: a manifest paired with the exact file it was read from.
 *
 * `readAllManifestPaths` recurses, so the manifest tree can hold two records
 * with the same `issue_id` -- `docs/06_status/lanes/UTV2-1512.json` alongside
 * `docs/06_status/lanes/parked/UTV2-1512.json`, and (in the same directory)
 * `UTV2-1157.json` alongside `UTV2-1157-codex.json`. Every writer that
 * resolves its destination from the issue ID alone therefore writes one
 * record's content over a different record's file.
 *
 * That is not hypothetical: commit `a67a6a59` reverted PR #1448's ratified
 * `superseded` root manifest back to `blocked` and deleted 58 lines of
 * `truth_check_history`, by reading the parked copy and writing the root path.
 *
 * Carrying the source path alongside the manifest is what makes writing back
 * to the file a record actually came from expressible at all.
 */
export interface LaneManifestEntry {
  path: string;
  manifest: LaneManifest;
}

export function readAllManifestPaths(manifestDir = MANIFEST_DIR): string[] {
  if (!fs.existsSync(manifestDir)) {
    throw new Error(`Lane manifest directory does not exist: ${manifestDir}`);
  }

  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        paths.push(entryPath);
      }
    }
  };

  visit(manifestDir);
  return paths.sort((left, right) => left.localeCompare(right));
}

export function readAllManifestEntries(manifestDir = MANIFEST_DIR): LaneManifestEntry[] {
  return readAllManifestPaths(manifestDir).map((filePath) => ({
    path: filePath,
    manifest: parseJsonFile<LaneManifest>(filePath),
  }));
}

export function readAllManifests(manifestDir = MANIFEST_DIR): LaneManifest[] {
  return readAllManifestEntries(manifestDir).map((entry) => entry.manifest);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1634: authoritative active-lane discovery.
//
// readAllManifests() above recursively enumerates the LOCAL working tree. A
// lane's manifest is created on its own branch at ops:lane-start and does not
// reach `main` until the lane merges -- so for the entire time a lane is active,
// which is precisely when concurrency control matters, its manifest is
// invisible to every other worktree.
//
// That makes every gate built on it fail OPEN: an empty board and a full board
// are indistinguishable, so the ABSENCE of a violation gets read as PROOF of no
// violation. Measured 2026-07-31: six lanes active, two visible.
//
// The fix is to resolve the active set from authoritative remote state -- open
// PRs and their head-ref manifests -- and to treat "could not enumerate" as
// fail-CLOSED rather than as an empty board.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when the active-lane set cannot be established. Callers admitting new
 * work MUST refuse on this rather than proceeding: an unknown board is not an
 * empty board.
 */
export class ActiveLaneDiscoveryError extends Error {
  readonly code = 'active_lane_discovery_failed';
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ActiveLaneDiscoveryError';
  }
}

export interface OpenPullRequestRef {
  number: number;
  headRefName: string;
  url?: string;
}

/** How a resolved manifest entered the canonical source population. */
export type LaneManifestSource = 'local_worktree' | 'open_pr_head';

/** Which sanctioned manifest directory held the lane. Never a capacity signal. */
export type LaneManifestLocation = 'lanes_root' | 'lanes_parked';

export interface LocatedLaneManifest {
  manifest: LaneManifest;
  location: LaneManifestLocation;
}

export const CANONICAL_CAPACITY_SOURCE_POPULATION = 'canonical_active_lane_union' as const;

export interface LaneCapacityClassification {
  lifecycleStatus: LaneManifestStatus;
  sourcePopulation: typeof CANONICAL_CAPACITY_SOURCE_POPULATION;
  classification: 'counted' | 'partially_counted' | 'visible_uncounted';
  countsAgainst: {
    executor: boolean;
    total: boolean;
    laneType: boolean;
  };
}

/**
 * Capacity is a pure function of lifecycle status. Manifest location is
 * intentionally absent from this API so relocating a lane can never alter its
 * arithmetic. Parked lanes remain in the canonical governance population and
 * lock population, but are explicitly visible-and-uncounted for every cap.
 */
export function classifyLaneCapacity(status: LaneManifestStatus): LaneCapacityClassification {
  const countsAgainst = {
    executor: EXECUTOR_CAPACITY_STATUSES.has(status),
    total: TOTAL_CAPACITY_STATUSES.has(status),
    laneType: TYPE_CAPACITY_STATUSES.has(status),
  };
  const count = Object.values(countsAgainst).filter(Boolean).length;
  return {
    lifecycleStatus: status,
    sourcePopulation: CANONICAL_CAPACITY_SOURCE_POPULATION,
    classification:
      count === 0 ? 'visible_uncounted' : count === 3 ? 'counted' : 'partially_counted',
    countsAgainst,
  };
}

export interface ResolvedActiveLane {
  manifest: LaneManifest;
  source: LaneManifestSource;
  manifestLocation: LaneManifestLocation;
  capacity: LaneCapacityClassification;
  /** PR number when the manifest came from an open PR head. */
  prNumber?: number;
}

export interface ActiveLaneDiscovery {
  /** Active manifests only (ACTIVE_LOCK_STATUSES), deduped by issue_id. */
  lanes: ResolvedActiveLane[];
  /** Convenience projection for callers that just want the manifests. */
  manifests: LaneManifest[];
  /** Open PRs whose branch carried no parseable issue id -- diagnostic only. */
  skippedPullRequests: Array<{ number: number; headRefName: string; reason: string }>;
}

export interface ActiveLaneDiscoveryDeps {
  listOpenPullRequests?: () => OpenPullRequestRef[];
  readManifestAtRef?: (issueId: string, ref: string) => LaneManifest | LocatedLaneManifest | null;
  readLocalManifests?: () => LaneManifest[];
  readLocalManifestEntries?: () => LocatedLaneManifest[];
}

/**
 * Extracts the canonical issue id from a lane branch name
 * (`claude/utv2-1634-slug` -> `UTV2-1634`). Returns null for branches that are
 * not lane branches, which are skipped rather than treated as failures.
 */
export function issueIdFromBranchName(branch: string): string | null {
  const match = /^(?:[a-z][a-z0-9-]*)\/(utv2|uni)-(\d+)(?:-|$)/i.exec(branch);
  return match ? `${match[1]!.toUpperCase()}-${match[2]}` : null;
}

/**
 * Hard cap on the open-PR listing. If the API returns exactly this many rows we
 * cannot prove the list is complete, so discovery fails closed rather than
 * silently treating a truncated page as the whole board.
 */
export const OPEN_PR_LISTING_LIMIT = 500;

/**
 * Active-lane discovery makes one GitHub call to list open PRs and then one
 * more PER OPEN PR to read that PR's lane manifest. With N open PRs that is
 * N+1 sequential network calls, and the original implementation failed the
 * whole admission on the first transient error of any one of them.
 *
 * That is fail-closed, which is correct, but with no retry the probability of
 * aborting compounds with the size of the board: at a per-call transient
 * failure rate p, admission succeeds only with probability (1-p)^(N+1). Measured
 * 2026-08-11 with 15 open PRs, `ops:lane-start` aborted on 5 of 6 consecutive
 * attempts while a single `gh api` call succeeded 8/8 -- the board size, not
 * the network, was the dominant term.
 *
 * Retrying does NOT weaken the guarantee. A transient error still never counts
 * as an absence; it is retried, and if every attempt fails the original
 * ActiveLaneDiscoveryError is thrown exactly as before. Only the definition of
 * "the call failed" changes -- from "one attempt failed" to "every attempt
 * failed".
 */
// Tuned against the live board, not guessed. With 15 open PRs, a 4-attempt
// linear 250ms backoff lifted end-to-end discovery from 1/6 to only 3/6 -- the
// transport stalls outlast a ~1.5s budget. Exponential backoff capped at 4s
// over 6 attempts gives each call up to ~11.5s to ride out a blip, which
// measured 6/6. The happy path is unaffected: a call that succeeds first try
// never sleeps at all.
export const DISCOVERY_FETCH_ATTEMPTS = 6;
export const DISCOVERY_RETRY_BASE_DELAY_MS = 500;
export const DISCOVERY_RETRY_MAX_DELAY_MS = 4000;

/**
 * True for a failure that is plausibly transient and therefore worth retrying:
 * network/DNS/TLS faults, timeouts, connection resets, 5xx, and 429 rate
 * limiting.
 *
 * Deliberately NOT retryable:
 *  - a confirmed 404, which is a definitive answer (handled before this call);
 *  - 401/403/bad credentials, which are permanent within a run -- retrying only
 *    delays a failure that will not resolve itself.
 *
 * An unrecognised error is treated as retryable. That is the safe direction
 * here: the worst case is a few wasted attempts before the same fail-closed
 * error is raised, whereas classifying a transient fault as permanent
 * reintroduces exactly the abort this exists to prevent.
 */
export function isRetryableDiscoveryFailure(stderr: string, status: number | null): boolean {
  const text = stderr.toLowerCase();
  // Permanent auth failures: never retry.
  if (/\b(401|403)\b/.test(text) || /bad credentials|requires authentication|permission denied/.test(text)) {
    return false;
  }
  // A confirmed 404 is a definitive answer, not a transient fault.
  if (isConfirmedManifestNotFound(stderr, status)) return false;
  return true;
}

/** Sleep without a busy loop. Injectable so tests never actually wait. */
function defaultDiscoverySleep(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface DiscoveryRetryDeps {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => void;
}

/**
 * Runs `operation` until it succeeds or the attempt budget is exhausted.
 * `classify` decides whether a given failure is worth another attempt; a
 * non-retryable failure is rethrown immediately. The LAST error is always
 * rethrown, so the caller's fail-closed handling and error message are
 * preserved verbatim.
 */
export function withDiscoveryRetry<T>(
  operation: () => T,
  classify: (error: unknown) => boolean,
  deps: DiscoveryRetryDeps = {},
): T {
  const attempts = Math.max(1, deps.attempts ?? DISCOVERY_FETCH_ATTEMPTS);
  const baseDelayMs = deps.baseDelayMs ?? DISCOVERY_RETRY_BASE_DELAY_MS;
  const maxDelayMs = deps.maxDelayMs ?? DISCOVERY_RETRY_MAX_DELAY_MS;
  const sleep = deps.sleep ?? defaultDiscoverySleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      if (!classify(error)) throw error;
      if (attempt === attempts) break;
      // Exponential backoff, capped. A transport stall lasts longer than a
      // fixed short delay, so doubling rides it out; the cap keeps worst-case
      // discovery bounded across a large board.
      sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs));
    }
  }
  throw lastError;
}

function stderrOf(error: unknown): { stderr: string; status: number | null } {
  const err = error as { status?: number | null; stderr?: Buffer | string };
  const stderr = typeof err.stderr === 'string' ? err.stderr : (err.stderr?.toString() ?? '');
  return { stderr, status: err.status ?? null };
}

function defaultListOpenPullRequests(retry: DiscoveryRetryDeps = {}): OpenPullRequestRef[] {
  // --paginate walks every page; --slurp merges them into one array. The limit
  // below is a truncation *detector*, not a page size.
  const stdout = withDiscoveryRetry(
    () =>
      execFileSync(
        'gh',
        [
          'api',
          '--paginate',
          '--slurp',
          `repos/{owner}/{repo}/pulls?state=open&per_page=100`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
      ),
    (error) => {
      const { stderr, status } = stderrOf(error);
      return isRetryableDiscoveryFailure(stderr, status);
    },
    retry,
  );

  const pages = JSON.parse(stdout) as Array<Array<{ number?: number; head?: { ref?: string }; html_url?: string }>>;
  if (!Array.isArray(pages)) {
    throw new Error('gh api --paginate --slurp did not return an array of pages');
  }

  const refs: OpenPullRequestRef[] = [];
  for (const page of pages) {
    if (!Array.isArray(page)) {
      throw new Error('gh api --paginate --slurp returned a non-array page');
    }
    for (const entry of page) {
      if (typeof entry?.number !== 'number' || typeof entry?.head?.ref !== 'string') {
        throw new Error(`open pull request entry is malformed: ${JSON.stringify(entry)}`);
      }
      refs.push({ number: entry.number, headRefName: entry.head.ref, url: entry.html_url });
    }
  }

  if (refs.length >= OPEN_PR_LISTING_LIMIT) {
    throw new Error(
      `open pull request listing returned ${refs.length} rows, at or beyond the ${OPEN_PR_LISTING_LIMIT} ` +
        'safety cap -- completeness cannot be proven, refusing to treat it as the whole board.',
    );
  }

  return refs;
}

/**
 * True only for a gh/GitHub failure that positively proves the file is absent
 * at that ref. Everything else -- auth loss, rate limiting, network failure,
 * 5xx, an unrecognised message -- is an UNKNOWN, not an absence.
 */
export function isConfirmedManifestNotFound(stderr: string, status: number | null): boolean {
  // gh exits 1 for both "404 Not Found" and "401 Bad credentials", so the exit
  // code alone can never be the discriminator. Require the explicit 404 marker
  // AND the absence of any other error signature.
  const text = stderr.toLowerCase();
  if (status !== 1) return false;
  if (/\b(401|403|429|5\d{2})\b/.test(text)) return false;
  if (/bad credentials|rate limit|abuse detection|could not resolve host|timeout|timed out|connection reset|network/.test(text)) {
    return false;
  }
  return /http 404|404 not found|not found \(http 404\)/.test(text);
}

function defaultReadManifestAtPathAtRef(
  issueId: string,
  ref: string,
  manifestPath: string,
  retry: DiscoveryRetryDeps = {},
): LaneManifest | null {
  let stdout: string;
  try {
    stdout = withDiscoveryRetry(
      () =>
        execFileSync(
          'gh',
          [
            'api',
            `repos/{owner}/{repo}/contents/${manifestPath}?ref=${encodeURIComponent(ref)}`,
            '--jq',
            '.content',
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim(),
      (error) => {
        const { stderr, status } = stderrOf(error);
        // A confirmed 404 is a real answer about this PR -- stop immediately and
        // let the handler below return null. Retrying it would be pure waste.
        return isRetryableDiscoveryFailure(stderr, status);
      },
      retry,
    );
  } catch (error) {
    const { stderr } = stderrOf(error);
    const err = error as { status?: number | null };
    // A CONFIRMED 404 means this PR simply has no manifest for that id at that
    // head -- a normal, non-lane PR. That is genuinely absent data about ONE
    // PR, and skipping it is correct.
    if (isConfirmedManifestNotFound(stderr, err.status ?? null)) {
      return null;
    }
    // Everything else -- auth, rate limit, network, 5xx -- is UNKNOWN. Treating
    // an unknown as an absence is precisely the fail-open this lane exists to
    // remove: it would silently drop an active lane from the board.
    throw new ActiveLaneDiscoveryError(
      `Could not read the lane manifest for ${issueId} at "${manifestPath}" on ref "${ref}", and the failure is not a confirmed 404. ` +
        `Refusing to treat an unreadable manifest as an absent one. Underlying error: ${stderr.trim() || 'unknown'}`,
      error,
    );
  }

  if (!stdout) {
    throw new ActiveLaneDiscoveryError(
      `The contents API returned an empty body for ${issueId} at "${manifestPath}" on ref "${ref}" without a 404. ` +
        'Refusing to infer absence from an empty response.',
    );
  }

  let decoded: string;
  try {
    decoded = Buffer.from(stdout, 'base64').toString('utf8');
  } catch (error) {
    throw new ActiveLaneDiscoveryError(
      `Base64 decoding failed for ${issueId}'s manifest at "${manifestPath}" on ref "${ref}".`,
      error,
    );
  }

  try {
    return JSON.parse(decoded) as LaneManifest;
  } catch (error) {
    throw new ActiveLaneDiscoveryError(
      `The lane manifest for ${issueId} at "${manifestPath}" on ref "${ref}" is not valid JSON. ` +
        'A malformed manifest is an unknown lane state, not an absent one.',
      error,
    );
  }
}

export interface ManifestAtRefReadDeps {
  readManifestAtPath?: (
    issueId: string,
    ref: string,
    manifestPath: string,
  ) => LaneManifest | null;
}

/**
 * Reads the sanctioned root location first, then the parked directory only
 * after a confirmed absence. An unreadable root lookup throws and never falls
 * through to parked, preserving the unknown-board fail-closed guarantee.
 */
export function readManifestAtRef(
  issueId: string,
  ref: string,
  deps: ManifestAtRefReadDeps = {},
): LocatedLaneManifest | null {
  const readManifestAtPath = deps.readManifestAtPath ?? defaultReadManifestAtPathAtRef;
  const candidates: Array<{ path: string; location: LaneManifestLocation }> = [
    { path: `docs/06_status/lanes/${issueId}.json`, location: 'lanes_root' },
    { path: `docs/06_status/lanes/parked/${issueId}.json`, location: 'lanes_parked' },
  ];

  for (const candidate of candidates) {
    const manifest = readManifestAtPath(issueId, ref, candidate.path);
    if (manifest) {
      return { manifest, location: candidate.location };
    }
  }
  return null;
}

function isLocatedLaneManifest(
  value: LaneManifest | LocatedLaneManifest,
): value is LocatedLaneManifest {
  return 'manifest' in value && 'location' in value;
}

function localManifestEntries(): LocatedLaneManifest[] {
  return readAllManifestPaths().map((filePath) => ({
    manifest: parseJsonFile<LaneManifest>(filePath),
    location: relativeToRoot(filePath).startsWith('docs/06_status/lanes/parked/')
      ? 'lanes_parked'
      : 'lanes_root',
  }));
}

/**
 * Resolves the set of currently-active lanes from authoritative state: every
 * open PR's manifest at its own head ref, unioned with the local working tree.
 *
 * Precedence: an open-PR-head manifest WINS over a local copy of the same
 * issue_id. The PR head is where an active lane's manifest actually lives and
 * is kept current; a local copy on `main` is either a stale merged snapshot or
 * this worktree's own in-progress file.
 *
 * Fail-closed: if the open-PR enumeration itself throws, this throws
 * ActiveLaneDiscoveryError. Callers must refuse to admit work rather than
 * proceeding against an unknown board.
 */
export function resolveActiveLaneManifests(
  deps: ActiveLaneDiscoveryDeps = {},
): ActiveLaneDiscovery {
  const listOpenPullRequests = deps.listOpenPullRequests ?? defaultListOpenPullRequests;
  const readManifestAtRefDependency = deps.readManifestAtRef ?? readManifestAtRef;
  const readLocalManifestEntries = deps.readLocalManifestEntries ?? (
    deps.readLocalManifests
      ? () =>
          deps.readLocalManifests!().map((manifest) => ({
            manifest,
            location: 'lanes_root' as const,
          }))
      : localManifestEntries
  );

  let openPullRequests: OpenPullRequestRef[];
  try {
    openPullRequests = listOpenPullRequests();
  } catch (error) {
    throw new ActiveLaneDiscoveryError(
      'Could not enumerate open pull requests, so the active-lane set is unknown. ' +
        'Refusing to treat an unknown board as an empty one.',
      error,
    );
  }

  const byIssueId = new Map<string, ResolvedActiveLane>();
  const skippedPullRequests: ActiveLaneDiscovery['skippedPullRequests'] = [];

  // Local first, so open-PR-head manifests overwrite them below.
  let localEntries: LocatedLaneManifest[];
  try {
    localEntries = readLocalManifestEntries();
  } catch (error) {
    throw new ActiveLaneDiscoveryError(
      'Could not read the local lane-manifest population, so the active-lane set is unknown. ' +
        'Refusing to treat an unreadable local board as an empty one.',
      error,
    );
  }
  for (const entry of localEntries) {
    const { manifest } = entry;
    if (!ACTIVE_LOCK_STATUSES.has(manifest.status)) continue;
    byIssueId.set(manifest.issue_id, {
      manifest,
      source: 'local_worktree',
      manifestLocation: entry.location,
      capacity: classifyLaneCapacity(manifest.status),
    });
  }

  for (const pullRequest of openPullRequests) {
    const issueId = issueIdFromBranchName(pullRequest.headRefName ?? '');
    if (!issueId) {
      skippedPullRequests.push({
        number: pullRequest.number,
        headRefName: pullRequest.headRefName ?? '',
        reason: 'branch name carries no UTV2-/UNI- issue id',
      });
      continue;
    }

    // Any throw here is an UNKNOWN lane state. Normalise it to
    // ActiveLaneDiscoveryError so every caller sees one fail-closed type,
    // whether the failure came from the default gh path or an injected dep.
    let lookup: LaneManifest | LocatedLaneManifest | null;
    try {
      lookup = readManifestAtRefDependency(issueId, pullRequest.headRefName);
    } catch (error) {
      if (error instanceof ActiveLaneDiscoveryError) throw error;
      throw new ActiveLaneDiscoveryError(
        `Could not resolve the lane manifest for ${issueId} on PR #${pullRequest.number}. ` +
          'Refusing to admit work against an incompletely-known board.',
        error,
      );
    }
    if (!lookup) continue;

    const located = isLocatedLaneManifest(lookup)
      ? lookup
      : { manifest: lookup, location: 'lanes_root' as const };
    const { manifest } = located;

    if (!ACTIVE_LOCK_STATUSES.has(manifest.status)) {
      // A merged/done lane still holding an open PR must NOT keep its locks.
      byIssueId.delete(manifest.issue_id);
      continue;
    }

    byIssueId.set(manifest.issue_id, {
      manifest,
      source: 'open_pr_head',
      manifestLocation: located.location,
      capacity: classifyLaneCapacity(manifest.status),
      prNumber: pullRequest.number,
    });
  }

  const lanes = [...byIssueId.values()].sort((left, right) =>
    left.manifest.issue_id.localeCompare(right.manifest.issue_id),
  );

  return { lanes, manifests: lanes.map((entry) => entry.manifest), skippedPullRequests };
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

  if (!VALID_LANE_MANIFEST_SCHEMA_VERSIONS.includes(manifest.schema_version)) {
    errors.push(
      `${sourcePath}: schema_version must be one of ${VALID_LANE_MANIFEST_SCHEMA_VERSIONS.join(', ')} (got ${String(manifest.schema_version)})`,
    );
  }
  if (!ISSUE_PATTERN.test(manifest.issue_id)) {
    errors.push(`${sourcePath}: issue_id must match UTV2-###`);
  }
  if (!MANIFEST_STATUSES.has(manifest.status)) {
    errors.push(`${sourcePath}: status is invalid`);
  }
  const VALID_LANE_TYPES = new Set([
    'runtime', 'modeling', 'verification', 'hygiene', 'migration',
    'governance', 'delivery-ui', 'data-canonical',
    'claude', 'codex', 'codex-cli', 'codex-cloud',
  ]);
  if (!VALID_LANE_TYPES.has(manifest.lane_type)) {
    errors.push(`${sourcePath}: lane_type is invalid`);
  }
  if (!['claude', 'codex-cli', 'pm'].includes(manifest.created_by)) {
    errors.push(`${sourcePath}: created_by is invalid`);
  }
  if (!['T1', 'T2', 'T3'].includes(manifest.tier)) {
    errors.push(`${sourcePath}: tier is invalid`);
  }
  if (!isPortableAbsolutePath(manifest.worktree_path)) {
    errors.push(`${sourcePath}: worktree_path must be absolute`);
  }
  if (manifest.execution_location) {
    if (!isPortableAbsolutePath(manifest.execution_location.cwd)) {
      errors.push(`${sourcePath}: execution_location.cwd must be absolute`);
    }
    if (
      normalizePortableAbsolutePath(manifest.execution_location.cwd) !==
      normalizePortableAbsolutePath(manifest.worktree_path)
    ) {
      errors.push(`${sourcePath}: execution_location.cwd must match worktree_path`);
    }
    if (!['worktree', 'main-control'].includes(manifest.execution_location.mode)) {
      errors.push(`${sourcePath}: execution_location.mode is invalid`);
    }
    if (
      !['not_required', 'required', 'verified'].includes(
        manifest.execution_location.package_install,
      )
    ) {
      errors.push(`${sourcePath}: execution_location.package_install is invalid`);
    }
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
  } else {
    try {
      validatePreflightTokenPathValue(manifest.preflight_token, {
        requireExistingFile: ACTIVE_LOCK_STATUSES.has(manifest.status),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !(
          manifest.preflight_token === LEGACY_DISPATCH_AUTO_PREFLIGHT_TOKEN &&
          (manifest.status === 'merged' || manifest.status === 'done')
        )
      ) {
        errors.push(`${sourcePath}: ${message}`);
      }
    }
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

  if (
    manifest.schema_version === 2 &&
    manifest.lane_type === 'verification' &&
    !manifest.verification_target
  ) {
    // Mirrors the model_routing fix below (UTV2-1526): presence alone can't distinguish
    // "predates verification_target" from "deleted from a v2 manifest". schema_version 2
    // makes deletion detectable and rejected outright.
    errors.push(
      `${sourcePath}: schema_version 2 verification-type manifest is missing verification_target (the UTV2-### issue this lane produces proof for -- deleting or omitting it is rejected)`,
    );
  }

  if (manifest.verification_target !== undefined) {
    if (!VERIFICATION_TARGET_PATTERN.test(manifest.verification_target)) {
      errors.push(`${sourcePath}: verification_target must match UTV2-### (got "${manifest.verification_target}")`);
    }
    if (manifest.lane_type !== 'verification') {
      errors.push(
        `${sourcePath}: verification_target is present but lane_type is "${manifest.lane_type}" -- verification_target is verification-lane-only`,
      );
    }
  }

  const isCodexExecutorForVersionCheck =
    manifest.executor === 'codex-cli' || manifest.executor === 'codex-cloud';
  if (manifest.schema_version === 2 && isCodexExecutorForVersionCheck && !manifest.model_routing) {
    // The core fix for PM review finding #2: presence alone cannot distinguish "this
    // manifest predates model_routing" from "model_routing was deleted from a v2
    // manifest". schema_version 2 makes deletion detectable and rejected outright.
    errors.push(
      `${sourcePath}: schema_version 2 Codex-executor manifest is missing model_routing (deleting or omitting it is rejected -- only schema_version 1 manifests may lack model_routing)`,
    );
  }

  if (manifest.model_routing) {
    const mr = manifest.model_routing;
    const isCodexExecutor = manifest.executor === 'codex-cli' || manifest.executor === 'codex-cloud';
    if (!isCodexExecutor) {
      errors.push(
        `${sourcePath}: model_routing is present but executor is "${manifest.executor ?? 'unset'}" -- model_routing is Codex-only`,
      );
    }
    if (!mr.profile || typeof mr.profile !== 'string') {
      errors.push(`${sourcePath}: model_routing.profile is required`);
    }
    if (!mr.model || typeof mr.model !== 'string') {
      errors.push(`${sourcePath}: model_routing.model is required`);
    }
    if (!mr.reasoning_effort || typeof mr.reasoning_effort !== 'string') {
      errors.push(`${sourcePath}: model_routing.reasoning_effort is required`);
    }
    if (!['three-brain', 'manual-override'].includes(mr.selected_by)) {
      errors.push(`${sourcePath}: model_routing.selected_by must be "three-brain" or "manual-override"`);
    }
    if (!mr.policy_version || typeof mr.policy_version !== 'string') {
      errors.push(`${sourcePath}: model_routing.policy_version is required`);
    }
    if (mr.override) {
      if (!mr.override.authorized_by || !mr.override.authorized_by.trim()) {
        errors.push(`${sourcePath}: model_routing.override.authorized_by is required when override is present`);
      }
      if (!mr.override.reason || !mr.override.reason.trim()) {
        errors.push(`${sourcePath}: model_routing.override.reason is required when override is present`);
      }
    }
  }

  errors.push(...validateScopeReleaseHistory(manifest, sourcePath));

  return errors;
}

function isPortableAbsolutePath(value: string): boolean {
  // "." is accepted as the main-checkout root when worktree_path is used with mode=main-control
  return value === '.' || path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function normalizePortableAbsolutePath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (path.win32.isAbsolute(value)) {
    return normalized.replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
  }
  if (path.posix.isAbsolute(value)) {
    return path.posix.normalize(normalized);
  }
  return path.resolve(value).replaceAll('\\', '/');
}

/**
 * Canonical, order-independent hash of a `file_scope_lock`.
 *
 * Normalized + sorted + deduplicated before hashing so that reordering or
 * re-serializing a lock never reads as a change, and so a release computed on
 * one machine verifies on another. This is the identity used by
 * `scope_release_history` chaining; it is NOT a security boundary (the manifest
 * lives in the PR's own diff), it is a tamper-EVIDENCE boundary: an unaudited
 * edit to the lock breaks the chain and is detectable.
 */
export function hashFileScopeLock(fileScopeLock: readonly string[]): string {
  const canonical = [...new Set(fileScopeLock.map((entry) => entry.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')))]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates the shape and the hash chain of `scope_release_history` (UTV2-1762).
 *
 * The chain is what makes the audit trail load-bearing rather than decorative:
 *   - entry[i].previous_lock_hash must equal entry[i-1].resulting_lock_hash
 *   - the LAST entry's resulting_lock_hash must equal the hash of the manifest's
 *     current file_scope_lock
 * so a lock edited without a matching entry, or an entry claiming a lock state
 * the manifest does not actually hold, both fail closed here.
 *
 * A released path must also be absent from the current lock -- otherwise the
 * entry would be claiming a removal that did not happen.
 */
export function validateScopeReleaseHistory(
  manifest: Pick<LaneManifest, 'file_scope_lock' | 'scope_release_history'>,
  sourcePath: string,
): string[] {
  const errors: string[] = [];
  const history = manifest.scope_release_history;
  if (history === undefined) {
    return errors;
  }
  if (!Array.isArray(history)) {
    errors.push(`${sourcePath}: scope_release_history must be an array`);
    return errors;
  }

  const currentLock = Array.isArray(manifest.file_scope_lock) ? manifest.file_scope_lock : [];
  const currentLockSet = new Set(currentLock);

  history.forEach((entry, index) => {
    const at = `${sourcePath}: scope_release_history[${index}]`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${at} must be an object`);
      return;
    }
    if (!isNonEmptyString(entry.released_at)) errors.push(`${at}.released_at is required`);
    if (!isNonEmptyString(entry.actor)) errors.push(`${at}.actor is required`);
    if (!isNonEmptyString(entry.reason)) errors.push(`${at}.reason is required`);
    if (!Number.isInteger(entry.pr_number) || entry.pr_number <= 0) {
      errors.push(`${at}.pr_number must be a positive integer`);
    }
    if (!isNonEmptyString(entry.pr_url)) errors.push(`${at}.pr_url is required`);
    if (!isNonEmptyString(entry.head_sha)) errors.push(`${at}.head_sha is required`);
    if (!isNonEmptyString(entry.previous_lock_hash)) errors.push(`${at}.previous_lock_hash is required`);
    if (!isNonEmptyString(entry.resulting_lock_hash)) errors.push(`${at}.resulting_lock_hash is required`);
    if (!Array.isArray(entry.released_paths) || entry.released_paths.length === 0) {
      errors.push(`${at}.released_paths must be a non-empty array`);
    } else {
      for (const released of entry.released_paths) {
        if (!isNonEmptyString(released)) {
          errors.push(`${at}.released_paths contains an empty entry`);
        } else if (currentLockSet.has(released)) {
          errors.push(
            `${at}.released_paths claims "${released}" was released, but it is still present in file_scope_lock`,
          );
        }
      }
    }
    if (!Array.isArray(entry.verifications) || entry.verifications.length === 0) {
      errors.push(`${at}.verifications must be a non-empty array`);
    }
    if (index > 0) {
      const previous = history[index - 1];
      if (previous && entry.previous_lock_hash !== previous.resulting_lock_hash) {
        errors.push(
          `${at}.previous_lock_hash does not chain from scope_release_history[${index - 1}].resulting_lock_hash`,
        );
      }
    }
  });

  if (errors.length === 0 && history.length > 0) {
    const last = history[history.length - 1];
    const expected = hashFileScopeLock(currentLock);
    if (last.resulting_lock_hash !== expected) {
      errors.push(
        `${sourcePath}: scope_release_history tail resulting_lock_hash ${last.resulting_lock_hash} does not match the current file_scope_lock hash ${expected} -- the lock was modified outside the audited release path`,
      );
    }
  }

  return errors;
}

/**
 * UTV2-1756: raised by `assertManifestWriteIsSafe`, and by nothing else.
 *
 * A manifest write can fail for two unrelated reasons, and a caller that
 * conflates them is dangerous. One is policy: this write would rewrite settled
 * truth, and the refusal is a decision the guard made deliberately. The other
 * is operational: the disk is full, the path is read-only, the process lost a
 * permission. The first is a normal, reportable outcome for a sweeping caller
 * like `ops:reconcile`, which should record it and carry on. The second means
 * the run did not do what it claims and must not be reported as success.
 *
 * A bare `catch` cannot tell them apart, so the policy refusal gets its own
 * type. Catch `ManifestWritePolicyError` to handle a refusal; let everything
 * else propagate.
 */
export class ManifestWritePolicyError extends Error {
  override readonly name = 'ManifestWritePolicyError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * UTV2-1756: the single fail-closed guard every manifest write passes through.
 *
 * `writeManifestAtPath` is the chokepoint. Before a write can land on a file
 * that already exists, the record already on disk gets a vote:
 *
 *   1. Identity. If the on-disk record carries a different `issue_id`, the
 *      write is a cross-record clobber and is refused outright.
 *   2. Terminal protection. When the record on disk is in a settled status,
 *      the move to the incoming status must be legal under `TRANSITIONS`.
 *      `superseded -> blocked` is not, so the exact clobber performed by
 *      `a67a6a59` is refused here regardless of which caller resolved the path
 *      or how it resolved it -- so the protection is not specific to the one
 *      writer whose path resolution was fixed.
 *
 *      It is NOT yet universal, and must not be described as such. Two writers
 *      still reach a manifest file without passing through here:
 *      `writeBoundManifest` in `scripts/ops/lane-link-pr.ts` when
 *      `allowMissingPreflightToken` is set (it calls `writeJsonFile` directly
 *      after a filtered `validateManifest`), and the one-off lane-type
 *      migration CLI (raw `fs.writeFileSync`); both are named with exact paths
 *      and line numbers in this lane's verification.md, which is deliberately
 *      where those strings live -- `executable-wiring` reads a path written in
 *      non-test source as an executable reference and would mark that CLI
 *      spuriously wired. Both predate this change and are out of this
 *      lane's frozen scope; both are recorded as follow-up work. Closing them
 *      is what would make the claim "un-rewritable by any writer" true.
 *
 *      The arm is deliberately scoped to settled statuses rather than to every
 *      status. Applying `TRANSITIONS` to in-flight records would make this
 *      guard a lifecycle authority, which is not what this lane ratified --
 *      and the table is not currently fit for that role: `ops:lane-link-pr`
 *      moves every lane `started -> in_review` on PR binding, a transition the
 *      table does not list. That gap is real and worth its own issue, but
 *      closing it by having a write guard start refusing PR binding would be
 *      smuggling a lifecycle change in under a clobber fix.
 *
 * The guard deliberately abstains when the on-disk file cannot be parsed or
 * carries no recognisable status: a corrupt manifest must stay repairable, and
 * refusing to overwrite garbage would brick the only path that fixes it.
 *
 * The guard is not a substitute for writing to the right file. Two records can
 * share an `issue_id` and still be distinct lanes -- `UTV2-1157.json` and
 * `UTV2-1157-codex.json` sit in the same directory and both say `UTV2-1157`,
 * so the identity arm has nothing to compare and only the transition arm
 * applies. Path fidelity at the call site is the primary fix; this guard is
 * the backstop that holds even when a caller resolves the wrong path.
 *
 * Note the layering. `selectReconcilableManifests` (UTV2-1619) already fails
 * closed on the *read* side by allowlisting active statuses; that fix is
 * correct and untouched. It could not stop this defect because the candidate
 * it selected was never the terminal manifest -- the terminal manifest was
 * only ever the write *destination*. Guarding both sides is what closes it.
 */
function assertManifestWriteIsSafe(manifest: LaneManifest, manifestPath: string): void {
  if (!fs.existsSync(manifestPath)) {
    return;
  }

  let onDisk: LaneManifest;
  try {
    onDisk = parseJsonFile<LaneManifest>(manifestPath);
  } catch {
    // Unparseable target: abstain so a corrupt manifest stays repairable.
    return;
  }

  const onDiskIssueId = String(onDisk?.issue_id ?? '').trim().toUpperCase();
  const incomingIssueId = String(manifest.issue_id ?? '').trim().toUpperCase();
  if (onDiskIssueId && incomingIssueId && onDiskIssueId !== incomingIssueId) {
    throw new ManifestWritePolicyError(
      `Refusing to write manifest for ${incomingIssueId} over ${relativeToRoot(manifestPath)}, ` +
        `which holds ${onDiskIssueId}: a manifest must be written back to its own file`,
    );
  }

  if (!TERMINAL_WRITE_PROTECTED_STATUSES.has(onDisk?.status)) {
    // Not settled (or an unrecognised legacy value): no transition vote. An
    // in-flight lane is expected to move, and a corrupt one must stay
    // repairable.
    return;
  }

  // The one sanctioned reanimation: ops:lane-start replaces a `done` manifest
  // with a fresh `started` one when an issue is worked a second time. It is not
  // in TRANSITIONS, and adding it there would let anything move a done lane
  // back to started. Permitting it here instead keeps the exception exactly as
  // wide as the kernel's own rule: lane-start hard-errors on an existing
  // manifest in ANY other status, so `done` is the only settled record it will
  // ever replace, and `started` is the only status it replaces one with.
  //
  // This is load-bearing, not cosmetic. Branch, worktree, and lease are all
  // created before lane-start reaches its manifest write, and that path has no
  // rollback -- so refusing this write would strand a worktree and a lease on
  // every restart of a completed issue.
  //
  // Nothing else can reach it: ops:reconcile only ever writes `blocked`,
  // `merged`, or `done`, and only for manifests in ACTIVE_LOCK_STATUSES, which
  // excludes `done`.
  const isSanctionedRestart = onDisk.status === 'done' && manifest.status === 'started';
  if (isSanctionedRestart) {
    return;
  }

  try {
    assertStatusTransition(onDisk.status, manifest.status);
  } catch {
    throw new ManifestWritePolicyError(
      `Refusing to overwrite ${relativeToRoot(manifestPath)}: on-disk status "${onDisk.status}" ` +
        `cannot transition to "${manifest.status}". A terminal manifest may only be moved through ` +
        'a legal transition (see TRANSITIONS); reconciling one backwards would rewrite settled truth.',
    );
  }
}

export interface WriteManifestOptions {
  /**
   * Whether to run full schema validation on the outgoing manifest.
   *
   * Defaults to true, and every lane-authoring writer leaves it that way.
   * `ops:reconcile` sets it to false, deliberately: it repairs pre-existing
   * records it did not author, and many of them no longer satisfy the current
   * schema through no fault of the repair -- a reaped `preflight_token` file
   * is enough, and `docs/06_status/lanes/UTV2-1512.json` fails on exactly that
   * today. Validating there would make the reconciler refuse to release locks
   * on precisely the legacy lanes reconciliation exists to unstick, turning a
   * clobber bug into a stuck-board bug.
   *
   * The clobber guard below is NOT optional and runs either way. Skipping
   * schema validation is a statement about the outgoing record's shape; it is
   * never permission to write over a different record.
   */
  validate?: boolean;
}

export function writeManifestAtPath(
  manifest: LaneManifest,
  manifestPath: string,
  options: WriteManifestOptions = {},
): void {
  assertManifestWriteIsSafe(manifest, manifestPath);

  if (options.validate !== false) {
    validateManifestSchemaDependencies();
    const errors = validateManifest(manifest, manifestPath);
    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }
  }

  writeJsonFile(manifestPath, manifest);
}

export function writeManifest(manifest: LaneManifest): void {
  writeManifestAtPath(manifest, issueToManifestPath(manifest.issue_id));
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

function normalizeLockPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

export function pathsOverlap(a: string, b: string): boolean {
  const na = normalizeLockPath(a);
  const nb = normalizeLockPath(b);
  return na === nb || na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`);
}

/**
 * Finds an active lane whose file_scope_lock overlaps the requested files.
 *
 * UTV2-1634: `candidateManifests` lets the caller pass the authoritative
 * active-lane set (see resolveActiveLaneManifests) instead of this function
 * re-reading the local working tree. Omitting it preserves the historical
 * local-only behaviour for callers outside the admission path -- but note that
 * the local-only set under-reports active lanes, so admission gates must pass
 * the resolved set explicitly.
 */
export function activeManifestOverlap(
  issueId: string,
  requestedFiles: string[],
  candidateManifests?: LaneManifest[],
): { issue_id: string; overlapping_files: string[] } | null {
  for (const manifest of candidateManifests ?? readAllManifests()) {
    if (manifest.issue_id === issueId) {
      continue;
    }
    if (!ACTIVE_LOCK_STATUSES.has(manifest.status)) {
      continue;
    }

    const overlappingFiles = requestedFiles.filter((requested) =>
      manifest.file_scope_lock.some((locked) => pathsOverlap(requested, locked)),
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
  const tokenRelativePath = validatePreflightTokenPathValue(relativeToRoot(tokenPath), {
    requireExistingFile: true,
  });

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
    tokenRelativePath,
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
  executor?: LaneExecutor;
  created_by?: CreatedBy;
  status?: LaneManifestStatus;
  now?: string;
  requireExistingPreflightToken?: boolean;
  model_routing?: ModelRoutingBlock;
  /**
   * The target issue this verification lane produces proof for. Required for
   * lane_type:"verification" at schema_version 2; forbidden on any other
   * lane_type. See the LaneManifest.verification_target doc comment.
   */
  verification_target?: string;
  /**
   * Schema version to write. Defaults to LANE_MANIFEST_CURRENT_SCHEMA_VERSION (2) for
   * every real lane-start call. The only sanctioned reason to pass `1` is constructing a
   * legacy-manifest fixture in a test that specifically exercises the schema_version-1
   * compatibility path -- ops:lane-start never passes this.
   */
  schema_version?: LaneManifestSchemaVersion;
}): LaneManifest {
  const timestamp = input.now ?? nowIso();
  const preflightToken = validatePreflightTokenPathValue(input.preflight_token, {
    requireExistingFile: input.requireExistingPreflightToken,
  });
  const schemaVersion = input.schema_version ?? LANE_MANIFEST_CURRENT_SCHEMA_VERSION;
  if (!VALID_LANE_MANIFEST_SCHEMA_VERSIONS.includes(schemaVersion)) {
    throw new Error(`Invalid schema_version: ${String(schemaVersion)}`);
  }
  const isCodexExecutor = input.executor === 'codex-cli' || input.executor === 'codex-cloud';
  if (isCodexExecutor && schemaVersion === 2 && !input.model_routing) {
    throw new Error(
      `Codex lane ${input.issue_id} requires a model_routing decision at creation time (schema_version 2). ` +
        `Resolve a profile via scripts/ops/model-routing.ts and pass --model-profile to ops:lane-start.`,
    );
  }
  if (!isCodexExecutor && input.model_routing) {
    throw new Error(
      `Lane ${input.issue_id} has executor "${input.executor ?? 'unset'}" but a model_routing block was supplied. ` +
        `model_routing is Codex-only -- Claude lanes must never carry an executable Codex model configuration.`,
    );
  }
  const isVerificationLane = input.lane_type === 'verification';
  if (isVerificationLane && schemaVersion === 2 && !input.verification_target) {
    throw new Error(
      `Verification lane ${input.issue_id} requires a verification_target at creation time (schema_version 2): ` +
        `the UTV2-### issue this lane produces proof for. Pass --verification-target to ops:lane-start.`,
    );
  }
  if (!isVerificationLane && input.verification_target) {
    throw new Error(
      `Lane ${input.issue_id} has lane_type "${input.lane_type ?? 'unset'}" but a verification_target was supplied. ` +
        `verification_target is verification-lane-only.`,
    );
  }
  if (input.verification_target && !VERIFICATION_TARGET_PATTERN.test(input.verification_target)) {
    throw new Error(`verification_target must match UTV2-### (got "${input.verification_target}")`);
  }
  return {
    schema_version: schemaVersion,
    issue_id: input.issue_id,
    lane_type: input.lane_type ?? 'runtime',
    executor: input.executor,
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
    preflight_token: preflightToken,
    created_by: input.created_by ?? 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...(input.model_routing ? { model_routing: input.model_routing } : {}),
    ...(input.verification_target ? { verification_target: input.verification_target } : {}),
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

/**
 * Merges a verifier `identity` into an already-existing `verifier` object
 * without discarding whatever else is already on it (`method`,
 * `verifier_scope`, `independence_note`, or any other hand-authored
 * narrative field).
 *
 * UTV2-1642: both `scripts/ops/proof-repair.ts`'s `mergeRuntimeProofIntoEvidence`
 * and `scripts/ops/proof-generate.ts`'s CI-DB-proof auto-harvest path (UTV2-1641)
 * need to stamp a verifier identity onto `evidence.json` when they add
 * `runtime_proof`. The proof-repair version used to do `verifier: { identity }` --
 * a bare object literal that REPLACED the whole `verifier` value. Confirmed live on
 * UTV2-1399's PR #1348: a pre-existing rich verifier object (method/verifier_scope/
 * independence_note describing the lane's real verification methodology) was
 * silently discarded and had to be restored by hand. Centralizing the merge here
 * means both callers get the same non-destructive behavior and neither can
 * regress independently.
 *
 * If no prior verifier object exists (or the existing value is not an object --
 * e.g. `null`, a string, an array), there is nothing to preserve and this
 * degrades to the previous bare-object behavior, which the issue explicitly
 * allows ("If no prior verifier object exists, the current bare-object behavior
 * is fine").
 */
export function mergeVerifierIdentity(
  existingVerifier: unknown,
  identity: string,
): Record<string, unknown> {
  const base =
    existingVerifier && typeof existingVerifier === 'object' && !Array.isArray(existingVerifier)
      ? (existingVerifier as Record<string, unknown>)
      : {};
  return { ...base, identity };
}
