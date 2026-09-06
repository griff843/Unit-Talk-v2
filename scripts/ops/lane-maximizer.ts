import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TYPE_CAPS,
  getEffectiveConfig,
  loadConcurrencyConfig,
  type ConcurrencyConfig,
  type EffectiveConcurrencyConfig,
  type TypeCapsConfig,
} from './concurrency-config.js';
import {
  ActiveLaneDiscoveryError,
  classifyLaneCapacity,
  readConfiguredEnvValue,
  resolveActiveLaneManifests,
  resolveLaneExecutor,
  type ActiveLaneDiscoveryDeps,
  type CanonicalLaneType,
  type LaneManifestStatus,
  type LaneTier,
} from './shared.js';
import {
  checkConcurrencyLimits,
  isValidVerificationTarget,
  type ConcurrencyManifestLike,
  type IncomingLaneScope,
} from './concurrency-rules.js';
import { linearQuery, type LinearQueryResult } from './linear-client.js';
import {
  FULL_VERIFY_THROTTLE_DIR,
  configuredFullVerifyConcurrency,
} from './preflight.js';
import { readSemaphoreStatus } from './verify-semaphore.js';

/**
 * Structural view of a lane manifest as this planner consumes it. Deliberately
 * a superset-compatible subset of `shared.ts`'s canonical `LaneManifest`, so the
 * canonical active-lane resolver's output can be handed to `evaluateCandidates`
 * verbatim (UTV2-1699). `executor` is optional and `status` uses the canonical
 * status union -- notably including `parked`, which is inside
 * `ACTIVE_LOCK_STATUSES` and was previously unrepresentable here.
 */
export interface LaneManifest {
  schema_version: number;
  issue_id: string;
  lane_type: string;
  executor?: 'claude' | 'codex-cli' | 'codex-cloud';
  tier: LaneTier;
  branch: string;
  base_branch: string;
  status: LaneManifestStatus;
  file_scope_lock: string[];
  blocked_by: string[];
  commit_sha: string | null;
  pr_url: string | null;
  verification_target?: string;
}

export interface CandidateLane {
  issue_id: string;
  tier: 'T1' | 'T2' | 'T3';
  executor: 'claude' | 'codex-cli';
  title?: string;
  branch?: string;
  lane_type?: string;
  work_class?: string;
  file_scope: string[];
  blocked_by: string[];
  isolated_install_verified?: boolean;
  has_acceptance_criteria?: boolean;
  labels?: string[];
  url?: string;
  // Explicit, machine-supplied target for a lane_type:"verification" candidate.
  // Never inferred -- see UTV2-1533's lane-maximizer P2 fix. A verification
  // candidate with no explicit target is blocked (MISSING_VERIFICATION_TARGET),
  // never defaulted to issue_id.
  verification_target?: string;
}

export type RecommendDecision = 'recommended' | 'blocked' | 'risky' | 'deferred';

export interface RecommendationResult {
  issue_id: string;
  decision: RecommendDecision;
  reason_codes: string[];
  reasons: string[];
  rank?: number;
  ranking_score?: number;
  ranking_reasons?: string[];
}

export interface DispatchLimits {
  max_claude: number;
  max_codex: number;
  active_claude: number;
  active_codex: number;
  claude_available: boolean;
  codex_available: boolean;
}

export interface DispatchPlanEntry {
  issue_id: string;
  executor: 'claude' | 'codex-cli';
  lane_type: string;
  work_class: string;
  file_scope: string[];
  slot_index: number;
  explanation: string;
  dispatch_command: string;
}

export interface LaneSaturationForecast {
  executors: {
    claude: {
      max: number;
      active: number;
      available_slots: number;
    };
    codex: {
      max: number;
      active: number;
      available_slots: number;
    };
  };
  active_singletons: string[];
  forbidden_combinations_active: string[][];
  full_verify_throttle: {
    max_concurrent: number;
    active: number;
    available_slots: number;
    lock_dir: string;
  };
  /**
   * UTV2-1699 F1: lanes that are visible and still hold their file-scope lock
   * but count against NO cap (parked). Reported so a consumer can never read
   * "absent from the capacity counts" as "absent from the board" -- these lanes
   * still block an overlapping candidate with OVERLAP.
   */
  visible_uncounted_lanes: Array<{ issue_id: string; lane_type: string; status: string }>;
  /** How each reported number was populated. Never inferred by a consumer. */
  capacity_classification: {
    source: 'classifyLaneCapacity';
    executor_rule: string;
    lane_slot_rule: string;
    lock_population_rule: string;
  };
  safe_class_recommendations: string[];
}

export interface DispatchPlan {
  fill_now: DispatchPlanEntry[];
  lane_saturation_forecast: LaneSaturationForecast;
}

export interface EvaluateCandidateOptions {
  doneIssueIds?: Set<string>;
  singletonLaneTypes?: string[];
  forbiddenCombinations?: [string, string][];
  /**
   * Override for the hygiene/governance/delivery-ui/verification per-type caps
   * forecast. Defaults to the real effective CONCURRENCY_CONFIG.json's type_caps,
   * falling back to DEFAULT_TYPE_CAPS if the config file cannot be loaded.
   */
  typeCaps?: TypeCapsConfig;
  /**
   * Full override for the concurrency policy checkConcurrencyLimits() is evaluated
   * against (total/executors/singleton_types/forbidden_combinations/type_caps, and
   * optionally the trial governor fields). When supplied, this is used verbatim --
   * intended for tests that need exact control over every cap simultaneously
   * (mirrors concurrency-simulation.test.ts's own POLICY/PROD_POLICY fixtures).
   * When omitted, a policy is synthesized from the real effective config (or safe
   * fallbacks) with `executors`/`total` driven by the `limits` parameter, so this
   * function's pre-existing `limits`-driven executor-cap behavior is unchanged for
   * every existing caller/test that does not opt into this override.
   */
  concurrencyConfig?: ConcurrencyConfig | EffectiveConcurrencyConfig;
}

export interface MaximizationReport {
  generated_at: string;
  dispatch_limits: DispatchLimits;
  dispatch_plan: DispatchPlan;
  recommended: RecommendationResult[];
  blocked: RecommendationResult[];
  risky: RecommendationResult[];
  deferred: RecommendationResult[];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANE_DIR = path.join(ROOT, 'docs', '06_status', 'lanes');

const REASON_MESSAGES: Record<string, string> = {
  OVERLAP: 'Candidate file scope overlaps an active lane lock.',
  BLOCKED_DEP: 'Candidate is blocked by one or more incomplete dependencies.',
  DISPATCH_LIMIT_CLAUDE: 'Claude executor has no remaining dispatch capacity.',
  DISPATCH_LIMIT_CODEX: 'Codex executor has no remaining dispatch capacity.',
  TIER_C_PATH: 'Candidate touches a Tier C path and should be treated as risky.',
  MIGRATION_PATH: 'Candidate touches a migration-sensitive path and is fail-closed blocked.',
  T1_REQUIRES_PM: 'T1 work requires PM authorization before recommendation.',
  SINGLETON_ACTIVE: 'Candidate lane type is singleton and already active.',
  FORBIDDEN_COMBINATION: 'Candidate lane type is forbidden alongside an active lane type.',
  ISOLATED_INSTALL_REQUIRED:
    'Package/API/worker/ingestor lanes stay singleton until isolated install is proven green in the lane cwd.',
  MISSING_FILE_SCOPE:
    'Candidate does not declare a file scope, so overlap and singleton path checks cannot be proven before lane start.',
  MISSING_ACCEPTANCE_CRITERIA:
    'Candidate does not include acceptance criteria, so it is not safe to dispatch automatically.',
  MISSING_VERIFICATION_TARGET:
    'Verification-lane candidate does not supply an explicit verification_target and cannot be safely recommended -- the per-target concurrency cap cannot be proven without it. Never inferred from issue_id.',
  MALFORMED_VERIFICATION_TARGET:
    'Verification-lane candidate supplies a verification_target that does not match UTV2-###.',
  VERIFICATION_TARGET_UNDETERMINED_CONFLICT:
    'An active verification lane has no trustworthy verification_target, so this candidate cannot be proven to target a different issue. Fails closed until the ambiguous active lane is resolved.',
  VERIFICATION_TARGET_ACTIVE:
    'Candidate verification_target is already claimed by an active verification lane.',
  VERIFICATION_TARGET_ALREADY_PLANNED:
    'Candidate verification_target is already claimed by another candidate recommended earlier in this same wave.',
  TOTAL_CAP_EXCEEDED:
    'Candidate would exceed the total active-lane cap once the active board and this wave\'s already-planned candidates are counted together.',
  TRIAL_UNSAFE_LANE_TYPE:
    'Trial slots above the base cap are restricted to safe lane types; this candidate\'s lane type is not eligible for trial expansion.',
  HYGIENE_TYPE_CAP_EXCEEDED:
    'Hygiene lane type cap would be exceeded once the active board and this wave\'s already-planned candidates are counted together.',
  GOVERNANCE_TYPE_CAP_EXCEEDED:
    'Governance lane type cap would be exceeded once the active board and this wave\'s already-planned candidates are counted together.',
  DELIVERY_UI_APP_UNDETERMINED:
    'Delivery/UI candidate file scope does not map to exactly one canonical app root -- cannot admit a lane whose app cannot be determined from its declared file_scope, never inferred from title/branch/text.',
  DELIVERY_UI_APP_UNDETERMINED_CONFLICT:
    'An active or already-planned Delivery/UI lane has a file scope that cannot be reduced to one canonical app, so this candidate cannot be proven to target a different app. Fails closed until the ambiguous lane is resolved.',
  DELIVERY_UI_APP_ACTIVE:
    'Candidate Delivery/UI app is already claimed by an active Delivery/UI lane.',
  DELIVERY_UI_APP_ALREADY_PLANNED:
    'Candidate Delivery/UI app is already claimed by another candidate recommended earlier in this same wave.',
  CONCURRENCY_LIMIT_EXCEEDED:
    'Candidate fails the concurrency forecast for a reason not otherwise classified above -- fails closed.',
};

/**
 * Maps a checkConcurrencyLimits() violation code to this planner's own reason-code
 * vocabulary. `wasActiveBaseline` distinguishes an identity conflict (delivery-ui app /
 * verification target) that already existed against the real active board from one that
 * only arises once this same wave's already-accepted candidates are projected in --
 * callers compute this by calling checkConcurrencyLimits() twice (once against real
 * active lanes only, once against the growing wave-projected list) and checking whether
 * the same violation code appears in both result sets. Count-based caps (total/executor/
 * hygiene/governance/trial) and non-identity conflicts (singleton/forbidden) do not need
 * this distinction -- the cap fires the same way regardless of which lane pushed the
 * count over the line.
 */
function classifyViolation(code: string, wasActiveBaseline: boolean): keyof typeof REASON_MESSAGES {
  switch (code) {
    case 'total_cap_exceeded':
      return 'TOTAL_CAP_EXCEEDED';
    case 'claude_cap_exceeded':
      return 'DISPATCH_LIMIT_CLAUDE';
    case 'codex_cap_exceeded':
      return 'DISPATCH_LIMIT_CODEX';
    case 'trial_unsafe_lane_type':
      return 'TRIAL_UNSAFE_LANE_TYPE';
    case 'singleton_type_conflict':
      return 'SINGLETON_ACTIVE';
    case 'hygiene_type_cap_exceeded':
      return 'HYGIENE_TYPE_CAP_EXCEEDED';
    case 'governance_type_cap_exceeded':
      return 'GOVERNANCE_TYPE_CAP_EXCEEDED';
    case 'delivery_ui_app_undetermined':
      return 'DELIVERY_UI_APP_UNDETERMINED';
    case 'delivery_ui_app_undetermined_conflict':
      return 'DELIVERY_UI_APP_UNDETERMINED_CONFLICT';
    case 'delivery_ui_app_conflict':
      return wasActiveBaseline ? 'DELIVERY_UI_APP_ACTIVE' : 'DELIVERY_UI_APP_ALREADY_PLANNED';
    case 'verification_target_missing':
      return 'MISSING_VERIFICATION_TARGET';
    case 'verification_target_undetermined_conflict':
      return 'VERIFICATION_TARGET_UNDETERMINED_CONFLICT';
    case 'verification_target_conflict':
      return wasActiveBaseline ? 'VERIFICATION_TARGET_ACTIVE' : 'VERIFICATION_TARGET_ALREADY_PLANNED';
    case 'forbidden_combination':
      return 'FORBIDDEN_COMBINATION';
    default:
      return 'CONCURRENCY_LIMIT_EXCEEDED';
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
  return slug || 'lane';
}

function deriveBranchName(candidate: CandidateLane): string {
  if (candidate.branch) {
    return candidate.branch;
  }
  const owner = candidate.executor === 'claude' ? 'claude' : 'codex';
  const issue = candidate.issue_id.toLowerCase();
  const title = slugify(candidate.title ?? candidate.issue_id);
  return `${owner}/${issue}-${title}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hasAcceptanceCriteria(text: string | null | undefined): boolean {
  return Boolean(text && /acceptance\s+criteria|(?:^|\n)\s*AC:/i.test(text));
}

function extractFileScopeFromText(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const scopes: string[] = [];
  let inScopeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^(?:#+\s*)?(allowed\s+file\s+scope|file\s+scope|files\s+changed|allowed\s+paths)\b/i.test(line)) {
      inScopeBlock = true;
      const inline = line.split(/:|-/).slice(1).join('-').trim();
      if (inline) {
        scopes.push(...inline.split(/[, ]+/));
      }
      continue;
    }

    if (inScopeBlock && line.length === 0) {
      // Tolerate a blank line between the heading and its bullet list — Linear's
      // markdown normalization always inserts one after a `#`-prefixed heading.
      // Once bullets have started, a blank line still ends the block.
      if (scopes.length === 0) {
        continue;
      }
      break;
    }

    if (inScopeBlock && /^(?:#+\s*)?[A-Z][A-Za-z0-9 /-]+:?\s*$/.test(line) && !line.startsWith('-')) {
      break;
    }

    if (inScopeBlock) {
      const bullet = line.match(/^[-*]\s+`?([^`]+?)`?\s*$/);
      if (bullet) {
        scopes.push(bullet[1].trim());
        continue;
      }
      const code = line.match(/^`([^`]+)`$/);
      if (code) {
        scopes.push(code[1].trim());
      }
    }
  }

  return Array.from(
    new Set(
      scopes
        .flatMap((scope) => scope.split(/,\s*/))
        .map((scope) => normalizePath(scope.replace(/^`|`$/g, '').trim()))
        .filter((scope) => scope.length > 0 && scope !== '-' && scope !== '—'),
    ),
  );
}

// Explicit, narrowly-parsed intake for a lane_type:"verification" candidate's
// real target. Deliberately a single machine-readable line ("Verification
// target: UTV2-####"), never inferred from title, branch name, free-form
// purpose text, or file paths -- UTV2-1533's lane-maximizer P2 fix.
function extractVerificationTargetFromText(text: string | null | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const match = text.match(/^\s*Verification\s+target:\s*(UTV2-\d+)\s*$/im);
  return match ? match[1].toUpperCase() : undefined;
}

function overlapsPath(left: string, right: string): boolean {
  const lhs = normalizePath(left);
  const rhs = normalizePath(right);
  return lhs === rhs || lhs.startsWith(`${rhs}/`) || rhs.startsWith(`${lhs}/`);
}

function isMigrationPath(fileScope: string): boolean {
  const normalized = normalizePath(fileScope);
  return (
    normalized.startsWith('supabase/migrations/') ||
    normalized.startsWith('packages/database/') ||
    normalized.endsWith('/database.types.ts') ||
    normalized === 'database.types.ts' ||
    normalized.endsWith('/schema.generated.ts') ||
    normalized === 'schema.generated.ts'
  );
}

function isTierCPath(fileScope: string): boolean {
  const normalized = normalizePath(fileScope);
  return (
    normalized.startsWith('packages/') ||
    normalized.startsWith('apps/api/') ||
    normalized.startsWith('apps/worker/') ||
    normalized.startsWith('apps/ingestor/')
  );
}

function inferLaneType(fileScope: string[]): string {
  const searchable = fileScope.map(normalizePath).join(' ');
  if (/supabase\/migrations|schema|database\.types/.test(searchable)) return 'migration';
  if (/apps\/worker|apps\/api|distribution|outbox|runtime/.test(searchable)) return 'runtime';
  if (/model|scoring|calibration/.test(searchable)) return 'modeling';
  if (/canonical|taxonomy|reference-data/.test(searchable)) return 'data-canonical';
  if (/docs\/governance|policy|governance/.test(searchable)) return 'governance';
  if (/test|verification|proof/.test(searchable)) return 'verification';
  return 'hygiene';
}

function inferLaneTypeFromLabels(labels: string[] = [], title = ''): string | null {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const executorLabels = new Set(['lane:codex', 'lane:codex-cli', 'lane:codex-cloud', 'lane:claude']);
  const explicit = normalizedLabels.find((label) =>
    (label.startsWith('ops:lane:') || label.startsWith('lane:')) && !executorLabels.has(label)
  );
  if (explicit) {
    return explicit.replace(/^ops:/, '').slice('lane:'.length);
  }

  const searchable = `${normalizedLabels.join(' ')} ${title}`.toLowerCase();
  if (/migration|schema|supabase/.test(searchable)) return 'migration';
  if (/runtime|worker|api|delivery|outbox/.test(searchable)) return 'runtime';
  if (/model|scoring|calibration/.test(searchable)) return 'modeling';
  if (/canonical|reference data|taxonomy/.test(searchable)) return 'data-canonical';
  if (/governance|policy|alignment/.test(searchable)) return 'governance';
  if (/verification|proof|test/.test(searchable)) return 'verification';
  if (/hygiene|cleanup|ops|tooling|ci/.test(searchable)) return 'hygiene';
  return null;
}

function inferWorkClass(laneType: string, singletonLaneTypes: string[]): string {
  return singletonLaneTypes.includes(laneType) ? 'singleton' : 'safe';
}

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1699 F1: capacity is a MATRIX, not one flat set.
//
// `activeLanes` here is the ACTIVE_LOCK_STATUSES population -- the LOCK
// population. It is deliberately broader than every capacity set, because a
// parked lane consumes no capacity but keeps its file-scope lock. Counting the
// lock population straight into executor slots, singleton forecasts and
// forbidden-combination forecasts manufactures phantom occupancy: a parked
// `migration` lane would fabricate a migration singleton and a
// migration+runtime forbidden pair, and an `in_review` lane would report an
// executor busy that nobody is working.
//
// That mis-report was dormant while active lanes were read from the local
// manifest directory only (on `main` there are none, so the tool reported 0/0).
// Resolving the open-PR-head union makes it live, so the capacity
// classification is applied here rather than deferred.
//
// `classifyLaneCapacity` (shared.ts) is the single canonical source for which
// status counts against which cap -- the same function `ops:execution-state`
// filters on, backed by the same EXECUTOR_/TOTAL_/TYPE_CAPACITY_STATUSES sets
// that `checkConcurrencyLimits` (concurrency-rules.ts) enforces at real
// admission time. No parallel policy is defined here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lanes occupying an executor's attention. Excludes in_review, blocked and
 * parked: in all three the lane waits on something outside the executor.
 * Mirrors checkConcurrencyLimits()'s `executorActive`.
 */
function executorCapacityLanes(activeLanes: LaneManifest[]): LaneManifest[] {
  return activeLanes.filter((lane) => classifyLaneCapacity(lane.status).countsAgainst.executor);
}

/**
 * Lanes occupying a lane slot. This is the population checkConcurrencyLimits()
 * calls `active` and evaluates the singleton and forbidden-combination rules
 * against, so the forecast must use the same one or it predicts conflicts the
 * real admission check would not raise. Excludes parked.
 */
function totalCapacityLanes(activeLanes: LaneManifest[]): LaneManifest[] {
  return activeLanes.filter((lane) => classifyLaneCapacity(lane.status).countsAgainst.total);
}

/**
 * Lanes that are visible and hold locks but count against no capacity at all.
 * Reported explicitly so "not counted" can never be confused with "not there" --
 * these lanes still enforce file-scope OVERLAP.
 */
function visibleUncountedLanes(activeLanes: LaneManifest[]): LaneManifest[] {
  return activeLanes.filter((lane) => {
    const counts = classifyLaneCapacity(lane.status).countsAgainst;
    return !counts.executor && !counts.total && !counts.laneType;
  });
}

function activeLaneTypes(activeLanes: LaneManifest[]): string[] {
  return Array.from(new Set(activeLanes.map((lane) => lane.lane_type).filter(Boolean))).sort();
}

function activeForbiddenCombinations(
  activeTypes: string[],
  forbiddenCombinations: [string, string][],
): string[][] {
  return forbiddenCombinations.filter(([left, right]) => activeTypes.includes(left) && activeTypes.includes(right));
}

/**
 * UTV2-1594: a slot only counts against saturation when its owner is actually
 * alive. The previous wall-clock check reported a slot held by a dead process
 * as "active" for six hours, so the forecast told operators the throttle was
 * saturated when in fact nothing was running. `readSemaphoreStatus` classifies
 * each slot by provable liveness and hands back the same reasons the operator
 * command prints.
 */
function readFullVerifyThrottleState(): LaneSaturationForecast['full_verify_throttle'] {
  const status = readSemaphoreStatus({
    dir: FULL_VERIFY_THROTTLE_DIR,
    maxConcurrent: configuredFullVerifyConcurrency(),
  });
  const active = status.slots.filter((slot) => slot.occupied && !slot.classification.reapable).length;
  return {
    max_concurrent: status.max_concurrent,
    active,
    available_slots: Math.max(0, status.max_concurrent - active),
    lock_dir: normalizePath(path.relative(ROOT, FULL_VERIFY_THROTTLE_DIR)),
  };
}

function buildResult(
  issueId: string,
  decision: RecommendDecision,
  reasonCode?: keyof typeof REASON_MESSAGES,
  ranking?: Pick<RecommendationResult, 'rank' | 'ranking_score' | 'ranking_reasons'>,
): RecommendationResult {
  if (!reasonCode) {
    return {
      issue_id: issueId,
      decision,
      reason_codes: [],
      reasons: [],
      ...ranking,
    };
  }

  return {
    issue_id: issueId,
    decision,
    reason_codes: [reasonCode],
    reasons: [REASON_MESSAGES[reasonCode]],
    ...ranking,
  };
}

function scoreCandidate(candidate: CandidateLane, index: number): CandidateLane & {
  rank: number;
  ranking_score: number;
  ranking_reasons: string[];
} {
  let rankingScore = 0;
  const rankingReasons: string[] = [];

  if (candidate.tier === 'T2') {
    rankingScore += 45;
    rankingReasons.push('tier:T2 dispatchable default');
  } else if (candidate.tier === 'T3') {
    rankingScore += 30;
    rankingReasons.push('tier:T3 lower urgency');
  } else {
    rankingScore += 20;
    rankingReasons.push('tier:T1 requires PM authorization');
  }

  if (candidate.file_scope.length > 0) {
    rankingScore += 20;
    rankingReasons.push('file scope declared');
  } else {
    rankingScore -= 40;
    rankingReasons.push('file scope missing');
  }

  if (candidate.has_acceptance_criteria === false) {
    rankingScore -= 20;
    rankingReasons.push('acceptance criteria missing');
  } else if (candidate.has_acceptance_criteria === true) {
    rankingScore += 10;
    rankingReasons.push('acceptance criteria present');
  }

  const laneType = candidate.lane_type ?? inferLaneType(candidate.file_scope);
  const workClass = candidate.work_class ?? inferWorkClass(laneType, []);
  if (workClass === 'safe') {
    rankingScore += 5;
    rankingReasons.push('safe work class');
  }

  return {
    ...candidate,
    rank: index + 1,
    ranking_score: rankingScore,
    ranking_reasons: rankingReasons,
  };
}

function rankCandidates(candidates: CandidateLane[]): Array<CandidateLane & {
  rank: number;
  ranking_score: number;
  ranking_reasons: string[];
}> {
  return candidates
    .map((candidate, index) => ({ candidate, index, scored: scoreCandidate(candidate, index) }))
    .sort((left, right) => {
      if (right.scored.ranking_score !== left.scored.ranking_score) {
        return right.scored.ranking_score - left.scored.ranking_score;
      }
      return left.index - right.index;
    })
    .map((entry, index) => ({
      ...entry.scored,
      rank: index + 1,
    }));
}

function readLaneManifests(dir: string = LANE_DIR): LaneManifest[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(dir, entry))
    .map((filePath) => {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as LaneManifest;
      } catch {
        return null;
      }
    })
    .filter((manifest): manifest is LaneManifest => manifest !== null);
}

/**
 * UTV2-1699 Defect 2/8 repair. The active-lane set is resolved through the
 * canonical resolver in `shared.ts` -- the same one `ops:lane-start` and
 * `ops:execution-state` use -- which unions the local manifest population with
 * every OPEN PR's manifest read at that PR's own head ref, and which throws
 * `ActiveLaneDiscoveryError` rather than returning a smaller board when any
 * part of that enumeration cannot be completed.
 *
 * The previous local-directory-only read was fail-open twice over: an active
 * lane whose manifest exists only on its PR head was invisible (measured
 * 2026-09-01: ZERO active manifests on `main` while three lanes were live), and
 * an unparseable manifest was silently dropped, shrinking the board instead of
 * failing it.
 */
/**
 * UTV2-1699. A manifest read from an open PR head is FOREIGN input: it was
 * authored on a branch this process has never verified, and it can be
 * syntactically valid JSON while being structurally unusable -- most commonly a
 * missing or non-array `file_scope_lock`, which makes the overlap scan
 * dereference `undefined` deep inside `evaluateCandidates`.
 *
 * That throw is not merely a crash: it escapes AFTER the error-envelope branches
 * have been passed, so the process exits non-zero having printed NOTHING to
 * stdout. A consumer that parses stdout gets an empty string, which is exactly
 * the unreadable-board-as-empty-board failure this lane exists to remove.
 *
 * So the structural contract is enforced HERE, at the discovery boundary, where
 * the failure is still attributable to active-lane discovery and still lands in
 * the `active_lane_discovery_failed` envelope with a real remediation.
 */
function assertUsableActiveLanes(manifests: LaneManifest[]): LaneManifest[] {
  for (const manifest of manifests) {
    const label =
      typeof manifest?.issue_id === 'string' && manifest.issue_id.length > 0
        ? manifest.issue_id
        : '<unknown issue_id>';
    if (typeof manifest?.issue_id !== 'string' || manifest.issue_id.length === 0) {
      throw new ActiveLaneDiscoveryError(
        'Discovered active lane manifest has no usable issue_id. Refusing to evaluate capacity, ' +
          'singleton and file-scope conflicts against an unidentifiable lane.',
      );
    }
    if (typeof manifest.status !== 'string' || manifest.status.length === 0) {
      throw new ActiveLaneDiscoveryError(
        `Discovered active lane manifest ${label} has no usable status. Refusing to classify ` +
          'capacity against a lane whose lifecycle state is unknown.',
      );
    }
    if (!Array.isArray(manifest.file_scope_lock)) {
      throw new ActiveLaneDiscoveryError(
        `Discovered active lane manifest ${label} has no array file_scope_lock. Refusing to run ` +
          'the file-scope overlap scan against a lane whose declared scope is unreadable -- an ' +
          'unknown scope is never treated as an empty scope.',
      );
    }
  }
  return manifests;
}

function resolveActiveLanesCanonically(
  discoveryDeps?: ActiveLaneDiscoveryDeps,
): LaneManifest[] {
  return assertUsableActiveLanes(resolveActiveLaneManifests(discoveryDeps).manifests);
}

function readDoneIssueIds(dir: string = LANE_DIR): Set<string> {
  return new Set(
    readLaneManifests(dir)
      .filter((manifest) => manifest.status === 'done')
      .map((manifest) => manifest.issue_id),
  );
}

function parseCandidatesArg(argv: string[]): CandidateLane[] {
  const index = argv.indexOf('--candidates');
  if (index === -1) {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin.length === 0) {
      return [];
    }
    return JSON.parse(stdin) as CandidateLane[];
  }

  const raw = argv[index + 1] ?? '[]';
  return JSON.parse(raw) as CandidateLane[];
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function getFlagValue(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return argv[index + 1] ?? null;
}

function parseTierLabel(labels: string[]): CandidateLane['tier'] | null {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (lower === 't1' || lower === 'tier:t1') return 'T1';
    if (lower === 't2' || lower === 'tier:t2') return 'T2';
    if (lower === 't3' || lower === 'tier:t3') return 'T3';
  }
  return null;
}

function parseExecutorLabel(tier: CandidateLane['tier'], labels: string[]): CandidateLane['executor'] {
  const lowerLabels = labels.map((label) => label.toLowerCase());
  if (lowerLabels.some((label) => label === 'lane:codex-cli' || label === 'lane:codex' || label === 'executor:codex-cli')) {
    return 'codex-cli';
  }
  if (lowerLabels.some((label) => label === 'lane:claude' || label === 'executor:claude')) {
    return 'claude';
  }
  if (tier === 'T2' && !lowerLabels.some((label) => label.includes('migration') || label.includes('contract'))) {
    return 'codex-cli';
  }
  return 'claude';
}

function parseBlockedByFromText(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }
  const blockedLine = text.match(/blocked\s+by\s*:?\s*([^\n]+)/i);
  if (!blockedLine) {
    return [];
  }
  return [...blockedLine[1].matchAll(/(?:UTV2|UNI)-\d+/g)].map((match) => match[0]);
}

/**
 * UTV2-1820: which relation types name a PREREQUISITE, and on which edge.
 *
 * Linear stores one row per relation and exposes it from both ends. Measured
 * against the live API on 2026-09-01, for the real edge UTV2-1771 -> UTV2-1370:
 *
 *   UTV2-1771.relations        -> { type: "blocks", relatedIssue: UTV2-1370 }
 *   UTV2-1370.inverseRelations -> { type: "blocks", issue:        UTV2-1771 }
 *
 * Both sides of the SAME edge carry `type: "blocks"`. The type string alone
 * therefore carries no direction at all -- the direction is which connection
 * the node came from. `relations` is the outgoing edge (this issue blocks the
 * related one, so the related one is DOWNSTREAM), and `inverseRelations` is the
 * incoming edge (the named issue blocks this one, so it is a PREREQUISITE).
 *
 * The shipped predicate treated `blocks` on the outgoing edge as a prerequisite,
 * which inverted the dependency: an issue that unblocks other work was reported
 * as blocked by that work and refused dispatch until its own dependents
 * completed -- which they could not, because they were waiting on it.
 *
 * `blocked_by` is accepted here as well. It was never observed on the wire in
 * the UTV2 team (the vocabulary seen is `blocks` and `related`), but if Linear
 * ever emits it on the inverse edge it unambiguously names a prerequisite, and
 * accepting it costs nothing while refusing it would fail open.
 */
/**
 * Stand-in prerequisite used when a relation set cannot be read. It is not a
 * real issue identifier and never resolves to a completed issue, so a candidate
 * carrying it stays BLOCKED_DEP instead of being silently admitted.
 */
export const LINEAR_UNREADABLE_RELATIONS_SENTINEL = 'UNREADABLE-RELATIONS';

export function isPrerequisiteInverseRelation(type: string): boolean {
  return type === 'blocks' || type === 'blocked_by';
}

/**
 * The OUTGOING edge never names a prerequisite. This exists as a named function
 * rather than an inlined `false` so the property is testable and so a future
 * reader cannot "fix" the inversion back by editing a bare literal.
 *
 * `blocked_by` on the outgoing edge would mean "this issue is blocked by the
 * related one", which IS a prerequisite -- so it is honoured. It has never been
 * observed on this connection; `blocks` and `related` are what Linear returns.
 */
export function isPrerequisiteOutgoingRelation(type: string): boolean {
  return type === 'blocked_by';
}

export function parseQueueCandidates(queuePath: string): CandidateLane[] {
  if (!fs.existsSync(queuePath)) {
    return [];
  }

  const markdown = fs.readFileSync(queuePath, 'utf8');
  const headingPattern = /^### ((?:UTV2|UNI)-\d+) [—-] (.+)$/gm;
  const matches = [...markdown.matchAll(headingPattern)];
  const candidates: CandidateLane[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const issueId = match[1];
    const title = match[2].replace(/^T[123]\s+/, '').trim();
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(start, end);
    const status = block.match(/\| \*\*Status\*\* \|([^|]+)\|/)?.[1]?.replace(/\*/g, '').trim();
    if (status && !['READY', 'TODO', 'BACKLOG'].includes(status)) {
      continue;
    }
    const tier = block.match(/\| \*\*Tier\*\* \|([^|]+)\|/)?.[1]?.trim() as CandidateLane['tier'] | undefined;
    if (tier !== 'T1' && tier !== 'T2' && tier !== 'T3') {
      continue;
    }
    const lane = block.match(/\| \*\*Lane\*\* \|([^|]+)\|/)?.[1]?.replace(/[`|]/g, '').trim().toLowerCase();
    const branch = block.match(/\| \*\*Branch\*\* \|([^|]+)\|/)?.[1]?.replace(/[`|]/g, '').trim();
    const labels = [lane ?? ''].filter(Boolean);
    const fileScope = extractFileScopeFromText(block);
    candidates.push({
      issue_id: issueId,
      title,
      tier,
      executor: lane?.includes('codex') ? 'codex-cli' : 'claude',
      branch: branch && branch !== '—' ? branch : undefined,
      lane_type: inferLaneTypeFromLabels(labels, title) ?? undefined,
      file_scope: fileScope,
      blocked_by: parseBlockedByFromText(block),
      has_acceptance_criteria: hasAcceptanceCriteria(block),
      labels,
      verification_target: extractVerificationTargetFromText(block),
    });
  }

  return candidates;
}

/**
 * Linear's server-side GraphQL query-complexity ceiling. Exceeding it is a hard
 * HTTP 400 (`"Query too complex"`), not a soft degradation.
 */
export const LINEAR_CANDIDATE_COMPLEXITY_BUDGET = 10_000;

/**
 * Measured complexity cost of ONE `LaneCandidates` node, taken from a live API
 * response on 2026-09-01: `first: 100` was rejected at a reported complexity of
 * 22601, i.e. ~226.01 per node. Linear charges for the nested connections in the
 * selection (`labels`, `relations` and `inverseRelations`), which is why a node
 * is this expensive.
 *
 * The figure was 116.01 with two connections. Adding `inverseRelations` -- which
 * UTV2-1820 requires, because it is the only edge that names a genuine
 * prerequisite -- very nearly doubled it, re-measured on the same day against
 * the real query text: 100 -> 22601, 75 -> 16951, 60 -> 13561, 50 -> 11301,
 * 40 -> OK. That is why the page size below had to move at the same time.
 *
 * If the node selection gains another nested connection this figure is stale --
 * `LINEAR_CANDIDATE_NESTED_CONNECTIONS` exists to make that a test failure
 * rather than a production outage.
 */
export const LINEAR_CANDIDATE_MEASURED_COMPLEXITY_PER_NODE = 226.01;

/**
 * Number of nested connections in the `LaneCandidates` node selection that the
 * per-node complexity figure above was measured against: `labels { nodes }`,
 * `relations { nodes }` and `inverseRelations { nodes }`. Adding a fourth
 * invalidates the measurement.
 */
export const LINEAR_CANDIDATE_NESTED_CONNECTIONS = 3;

/**
 * Page size for the candidate query. Linear's `issues` connection accepts up to
 * 250 rows per page, but the ROW limit is not the binding constraint -- the
 * query-complexity budget is. At the measured ~226 complexity per node, 100 rows
 * costs ~22601 against a ceiling of 10000 and is rejected outright with HTTP 400,
 * which took the whole dispatch family down (UTV2-1819). 30 costs ~6780, roughly
 * 68% of budget, leaving headroom for Linear to re-price the selection without
 * breaking discovery again.
 *
 * 50 was correct for the two-connection selection and is NOT correct for this
 * one: it costs ~11301 and would be rejected outright. The page size and the
 * measured per-node cost have to move together, which is what
 * `LINEAR_CANDIDATE_NESTED_CONNECTIONS` is there to force.
 *
 * This is a TRANSPORT detail only. It never caps the candidate population: the
 * cursor walk in `fetchLinearCandidates` pages until `hasNextPage` is false, so
 * a smaller page size costs an extra round trip and changes nothing else.
 */
export const LINEAR_CANDIDATE_PAGE_SIZE = 30;

/**
 * Hard stop on whole-board discovery, expressed in CANDIDATE NODES.
 *
 * This is the supported population ceiling: a board at or under this size is
 * fully discoverable, and a board above it FAILS CLOSED rather than returning
 * the pages collected so far -- a truncated candidate population is exactly the
 * fail-open this lane exists to remove.
 *
 * It is deliberately stated in nodes, not pages. The pre-UTV2-1819 guard was
 * `page > 100` with a page size of 100, so the real ceiling was an ACCIDENT of
 * the transport: halving the page size to stay inside Linear's complexity
 * budget would have silently halved supported board capacity from 10000 to
 * 5000. Transport page size must never define whole-board population capacity,
 * so the ceiling is named here and the page bound is derived from it below.
 */
export const LINEAR_CANDIDATE_MAX_NODES = 10_000;

/**
 * Loop bound for the cursor walk, DERIVED from the node ceiling so that
 * changing `LINEAR_CANDIDATE_PAGE_SIZE` cannot change supported capacity.
 *
 * The node ceiling alone cannot bound the loop: a server that returns empty
 * pages while still reporting `hasNextPage` would never reach it. This bound
 * exists only to make that pathological case terminate, so it is one page
 * looser than the node ceiling strictly requires and is never the guard that
 * fires on a merely-large board.
 */
export function linearCandidateMaxPages(pageSize: number = LINEAR_CANDIDATE_PAGE_SIZE): number {
  return Math.ceil(LINEAR_CANDIDATE_MAX_NODES / pageSize) + 1;
}

/**
 * The candidate query, exported so the complexity regression inspects the REAL
 * query text rather than a copy that could drift away from it.
 */
export const LINEAR_CANDIDATE_QUERY = `query LaneCandidates($teamId: String!, $limit: Int!, $cursor: String) {
       team(id: $teamId) {
         issues(
           first: $limit
           after: $cursor
           filter: { state: { type: { in: ["backlog", "unstarted"] } } }
           orderBy: createdAt
         ) {
           pageInfo { hasNextPage endCursor }
           nodes {
             identifier
             title
             url
             description
             branchName
             labels { nodes { name } }
             state { name type }
             relations {
               nodes {
                 type
                 relatedIssue { identifier }
               }
             }
             inverseRelations {
               nodes {
                 type
                 issue { identifier }
               }
             }
           }
         }
       }
     }`;

/** Injection seam for the Linear transport, so pagination is testable offline. */
export interface LinearCandidateFetchDeps {
  query?: <T>(
    query: string,
    variables: Record<string, unknown>,
    options: { token: string; userAgent?: string; timeoutMs?: number },
  ) => Promise<LinearQueryResult<T>>;
  token?: string | null;
}

interface LinearCandidateIssueNode {
  identifier: string;
  title: string;
  url: string;
  description: string | null;
  branchName: string | null;
  labels: { nodes: Array<{ name: string }> };
  state: { name: string; type: string } | null;
  relations: {
    nodes: Array<{
      type: string;
      relatedIssue: { identifier: string } | null;
    }>;
  };
  /**
   * Relations where this issue is the TARGET. A prerequisite of this issue
   * appears here, not in `relations` -- see `isPrerequisiteInverseRelation`.
   * Optional in the type because a server that omits it must be treated as
   * unreadable and blocked, never as "no prerequisites".
   */
  inverseRelations?: {
    nodes: Array<{
      type: string;
      issue: { identifier: string } | null;
    }>;
  } | null;
}

interface LinearCandidatePage {
  team: {
    issues: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: LinearCandidateIssueNode[];
    };
  } | null;
}

export async function fetchLinearCandidates(
  argv: string[],
  deps: LinearCandidateFetchDeps = {},
): Promise<CandidateLane[]> {
  const query = deps.query ?? linearQuery;
  const token =
    deps.token !== undefined
      ? deps.token
      : readConfiguredEnvValue('LINEAR_API_TOKEN') || readConfiguredEnvValue('LINEAR_API_KEY');
  if (!token) {
    throw new Error('LINEAR_API_TOKEN or LINEAR_API_KEY not set');
  }

  const teamKey = getFlagValue(argv, '--linear-team-key') ?? process.env.LINEAR_TEAM_KEY?.trim() ?? 'UTV2';
  // UTV2-1699 Defect 3 repair. `--linear-limit` is now an OPTIONAL ceiling for
  // an operator who deliberately wants a smaller sample. Unset (the canonical
  // dispatch invocation) means "the whole eligible population", retrieved by
  // cursor pagination -- not "the 10 most recently updated issues", and not
  // clamped to 50.
  const limitFlag = getFlagValue(argv, '--linear-limit');
  const limitRaw = limitFlag === null ? Number.NaN : Number.parseInt(limitFlag, 10);
  const maxCandidateIssues = Number.isFinite(limitRaw) ? Math.max(1, limitRaw) : null;
  const linearOpts = { token, userAgent: 'unit-talk-ops-lane-maximizer' };
  const teamResult = await query<{
    teams: { nodes: Array<{ id: string; key: string }> };
  }>(
    `query ResolveTeam($key: String!) {
       teams(filter: { key: { eq: $key } }, first: 1) {
         nodes { id key }
       }
     }`,
    { key: teamKey },
    linearOpts,
  );

  if (!teamResult.ok || !teamResult.data?.teams.nodes[0]) {
    throw new Error(`Linear team resolve failed: ${teamResult.error ?? teamKey}`);
  }

  const teamId = teamResult.data.teams.nodes[0].id;
  const nodes: LinearCandidateIssueNode[] = [];
  let cursor: string | null = null;
  let page = 0;
  const maxPages = linearCandidateMaxPages(LINEAR_CANDIDATE_PAGE_SIZE);

  // Cursor pagination over the FULL eligible population. Every page must
  // succeed: a mid-walk failure throws, because half a board dressed as a whole
  // board is the same fail-open as an empty board dressed as no work.
  //
  // UTV2-1699: the walk is ordered by `createdAt`, NOT `updatedAt`.
  // Linear's cursors are keyset cursors over the order field, so an issue whose
  // order key changes mid-walk can move relative to an already-consumed cursor
  // and be skipped entirely. `updatedAt` is mutated by literally any edit --
  // including the edits this very dispatch cycle provokes -- so a candidate
  // could vanish from the board purely because someone touched it while the
  // walk was in flight. That is the same "an unattempted/incomplete read
  // presented as a complete answer" fail-open this lane exists to remove, one
  // layer down. `createdAt` is immutable for the life of an issue, so no issue
  // can change its position in the ordering and no already-passed cursor can
  // move ahead of an unread issue. An issue created mid-walk sorts after every
  // cursor already consumed, so it is either seen on a later page or missed by
  // one cycle -- it can never displace an existing candidate.
  for (;;) {
    page += 1;
    if (page > maxPages) {
      throw new Error(
        `Linear candidate pagination exceeded ${maxPages} pages; ` +
          'refusing to report a candidate population that cannot be proven complete.',
      );
    }

    const pageSize = maxCandidateIssues === null
      ? LINEAR_CANDIDATE_PAGE_SIZE
      : Math.min(LINEAR_CANDIDATE_PAGE_SIZE, maxCandidateIssues - nodes.length);

    const result: LinearQueryResult<LinearCandidatePage> = await query<LinearCandidatePage>(
      LINEAR_CANDIDATE_QUERY,
      { teamId, limit: pageSize, cursor },
      linearOpts,
    );

    if (!result.ok || !result.data?.team) {
      throw new Error(`Linear candidate query failed: ${result.error ?? 'unknown'}`);
    }

    const connection = result.data.team.issues;
    nodes.push(...connection.nodes);

    // Node ceiling, checked AFTER the page lands so a board of exactly
    // LINEAR_CANDIDATE_MAX_NODES is fully discoverable and only the first node
    // beyond it fails closed. An explicit operator sample (`--linear-limit`) is
    // a deliberate smaller read and is handled below; this guard is about the
    // whole board being larger than we can prove we read completely.
    if (maxCandidateIssues === null && nodes.length > LINEAR_CANDIDATE_MAX_NODES) {
      throw new Error(
        `Linear candidate population exceeded ${LINEAR_CANDIDATE_MAX_NODES} nodes; ` +
          'refusing to report a candidate population that cannot be proven complete.',
      );
    }

    if (maxCandidateIssues !== null && nodes.length >= maxCandidateIssues) {
      nodes.length = maxCandidateIssues;
      break;
    }
    if (!connection.pageInfo?.hasNextPage) {
      break;
    }
    if (!connection.pageInfo.endCursor) {
      throw new Error(
        'Linear reported another candidate page but returned no cursor; ' +
          'refusing to report a truncated candidate population as the whole board.',
      );
    }
    cursor = connection.pageInfo.endCursor;
  }

  return nodes.flatMap((issue): CandidateLane[] => {
    const labels = issue.labels.nodes.map((label) => label.name);
    const tier = parseTierLabel(labels);
    if (!tier) {
      return [];
    }
    // UTV2-1820: prerequisites come from the INVERSE edge. An outgoing
    // `blocks` means this issue is the blocker, not the blocked.
    const outgoingPrerequisites = issue.relations.nodes
      .filter((relation) => isPrerequisiteOutgoingRelation(relation.type))
      .map((relation) => relation.relatedIssue?.identifier)
      .filter((identifier): identifier is string => Boolean(identifier));

    // Fail closed on an unreadable relation set. A server that omits
    // `inverseRelations`, or returns a relation whose issue identifier is
    // missing, has not told us this issue is unblocked -- it has told us
    // nothing. Admitting on silence is the fail-open this lane exists to
    // prevent, so an unreadable set blocks under a synthetic sentinel that no
    // completion check can ever satisfy.
    const inverse = issue.inverseRelations;
    let incomingPrerequisites: string[];
    if (!inverse || !Array.isArray(inverse.nodes)) {
      incomingPrerequisites = [LINEAR_UNREADABLE_RELATIONS_SENTINEL];
    } else {
      const prerequisiteNodes = inverse.nodes.filter((relation) =>
        isPrerequisiteInverseRelation(relation.type),
      );
      incomingPrerequisites = prerequisiteNodes.map(
        (relation) =>
          relation.issue?.identifier ?? LINEAR_UNREADABLE_RELATIONS_SENTINEL,
      );
    }

    const blockedBy = [...outgoingPrerequisites, ...incomingPrerequisites];
    const fileScope = extractFileScopeFromText(issue.description);
    return [{
      issue_id: issue.identifier,
      title: issue.title,
      tier,
      executor: parseExecutorLabel(tier, labels),
      branch: issue.branchName ?? undefined,
      lane_type: inferLaneTypeFromLabels(labels, issue.title) ?? undefined,
      file_scope: fileScope,
      blocked_by: Array.from(new Set([...blockedBy, ...parseBlockedByFromText(issue.description)])),
      has_acceptance_criteria: hasAcceptanceCriteria(issue.description),
      labels,
      url: issue.url,
      verification_target: extractVerificationTargetFromText(issue.description),
    }];
  });
}

function parseLimits(argv: string[]): { maxClaude: number; maxCodex: number } {
  const cfg = (() => { try { return getEffectiveConfig(loadConcurrencyConfig()); } catch { return null; } })();
  const defaultClaude = cfg?.executors.claude ?? 2;
  const defaultCodex = cfg?.executors.codex ?? 4;

  const getNumberFlag = (name: string, fallback: number): number => {
    const index = argv.indexOf(name);
    if (index === -1) {
      return fallback;
    }
    const raw = Number.parseInt(argv[index + 1] ?? '', 10);
    return Number.isFinite(raw) ? raw : fallback;
  };

  return {
    maxClaude: getNumberFlag('--max-claude', defaultClaude),
    maxCodex: getNumberFlag('--max-codex', defaultCodex),
  };
}

export function evaluateCandidates(
  candidates: CandidateLane[],
  activeLanes: LaneManifest[],
  limits: { maxClaude: number; maxCodex: number },
  options: EvaluateCandidateOptions = {},
): MaximizationReport {
  const cfg = (() => { try { return getEffectiveConfig(loadConcurrencyConfig()); } catch { return null; } })();
  const doneIssueIds = options.doneIssueIds ?? readDoneIssueIds();
  const singletonLaneTypes = options.singletonLaneTypes ?? cfg?.singleton_types ?? [
    'runtime',
    'migration',
    'modeling',
    'data-canonical',
  ];
  const forbiddenCombinations = options.forbiddenCombinations ?? cfg?.forbidden_combinations ?? [];
  const typeCaps = options.typeCaps ?? cfg?.type_caps ?? DEFAULT_TYPE_CAPS;
  // Single canonical concurrency policy this wave is forecast against --
  // checkConcurrencyLimits() (imported from concurrency-rules.ts, the same module
  // ops:lane-start's real, fail-closed admission check calls) is the ONLY place total/
  // executor/singleton/forbidden-combination/type-cap rules are implemented; this
  // function never re-derives them. `executors`/`total` are driven by the `limits`
  // parameter (not the loaded cfg) so this function's pre-existing limits-driven
  // executor-cap behavior is unchanged for every caller that does not opt into
  // `options.concurrencyConfig`. A caller that needs full control over every cap at
  // once (tests mirroring concurrency-simulation.test.ts's PROD_POLICY fixtures, or a
  // trial-governor scenario) can supply `options.concurrencyConfig` verbatim.
  const basePolicy: ConcurrencyConfig | EffectiveConcurrencyConfig = options.concurrencyConfig ?? (cfg
    ? {
        ...cfg,
        executors: { claude: limits.maxClaude, codex: limits.maxCodex },
        // Codex review (PR #1220): never let the synthesized total exceed the
        // REAL configured total cap. If CONCURRENCY_CONFIG.json ever sets a hard
        // `total` below the sum of the executor caps (a tighter overall ceiling
        // than the per-executor caps alone would imply), widening it here to
        // `maxClaude + maxCodex` would let this planner recommend lanes in the
        // gap that ops:lane-start's checkConcurrencyLimits() -- which enforces
        // cfg.total directly -- would then reject. Clamping to the smaller of
        // the two keeps the planner at least as conservative as the real
        // admission check, never more permissive.
        total: Math.min(cfg.total, limits.maxClaude + limits.maxCodex),
        singleton_types: singletonLaneTypes,
        forbidden_combinations: forbiddenCombinations,
        type_caps: typeCaps,
      }
    : {
        version: 1,
        total: limits.maxClaude + limits.maxCodex,
        executors: { claude: limits.maxClaude, codex: limits.maxCodex },
        merge_serialized_max: 1,
        singleton_types: singletonLaneTypes,
        forbidden_combinations: forbiddenCombinations,
        type_caps: typeCaps,
      });
  // UTV2-1699 F1: executor occupancy counts ONLY lanes an executor is actually
  // working, never the whole lock population.
  const executorLanes = executorCapacityLanes(activeLanes);
  const activeClaude = executorLanes.filter((lane) => resolveLaneExecutor(lane) === 'claude').length;
  const activeCodex = executorLanes.filter((lane) => {
    const executor = resolveLaneExecutor(lane);
    return executor === 'codex-cli' || executor === 'codex-cloud';
  }).length;
  // UTV2-1699 F1: the singleton and forbidden-combination FORECASTS must read
  // the same population checkConcurrencyLimits() evaluates those two rules
  // against (its `active`, i.e. TOTAL_CAPACITY_STATUSES), or the forecast
  // predicts conflicts the real admission check would never raise.
  const initialActiveTypes = activeLaneTypes(totalCapacityLanes(activeLanes));
  const visibleUncounted = visibleUncountedLanes(activeLanes);
  const fullVerifyThrottle = readFullVerifyThrottleState();

  const report: MaximizationReport = {
    generated_at: new Date().toISOString(),
    dispatch_limits: {
      max_claude: limits.maxClaude,
      max_codex: limits.maxCodex,
      active_claude: activeClaude,
      active_codex: activeCodex,
      claude_available: activeClaude < limits.maxClaude,
      codex_available: activeCodex < limits.maxCodex,
    },
    dispatch_plan: {
      fill_now: [],
      lane_saturation_forecast: {
        executors: {
          claude: {
            max: limits.maxClaude,
            active: activeClaude,
            available_slots: Math.max(0, limits.maxClaude - activeClaude),
          },
          codex: {
            max: limits.maxCodex,
            active: activeCodex,
            available_slots: Math.max(0, limits.maxCodex - activeCodex),
          },
        },
        active_singletons: initialActiveTypes.filter((laneType) => singletonLaneTypes.includes(laneType)),
        forbidden_combinations_active: activeForbiddenCombinations(initialActiveTypes, forbiddenCombinations),
        full_verify_throttle: fullVerifyThrottle,
        visible_uncounted_lanes: visibleUncounted.map((lane) => ({
          issue_id: lane.issue_id,
          lane_type: lane.lane_type,
          status: lane.status,
        })),
        capacity_classification: {
          source: 'classifyLaneCapacity',
          executor_rule: 'countsAgainst.executor === true (EXECUTOR_CAPACITY_STATUSES)',
          lane_slot_rule: 'countsAgainst.total === true (TOTAL_CAPACITY_STATUSES) -- also the singleton and forbidden-combination forecast population',
          lock_population_rule: 'ACTIVE_LOCK_STATUSES -- file-scope OVERLAP only; never a capacity signal',
        },
        safe_class_recommendations: [],
      },
    },
    recommended: [],
    blocked: [],
    risky: [],
    deferred: [],
  };
  let plannedClaude = 0;
  let plannedCodex = 0;
  // Wave-projected active-lane list: starts as the real active board and grows by one
  // synthetic entry every time a candidate is accepted into fill_now (see pushPlan
  // below). checkConcurrencyLimits() is called against this growing list for every
  // subsequent candidate in the same wave -- this is what lets the planner forecast
  // total/executor/singleton/forbidden/hygiene/governance/delivery-ui/verification caps
  // across the WHOLE wave, not just against the lanes that were active before planning
  // started (UTV2-1533's originally-shipped lane-maximizer P2 fix only did this
  // wave-projection for verification_target; this generalizes it to every cap
  // checkConcurrencyLimits() enforces).
  const projectedActive: ConcurrencyManifestLike[] = [...activeLanes];

  const pushPlan = (candidate: CandidateLane, laneType: string, workClass: string): void => {
    const slotIndex = candidate.executor === 'claude'
      ? activeClaude + plannedClaude + 1
      : activeCodex + plannedCodex + 1;
    const branch = deriveBranchName(candidate);
    const fileArgs = candidate.file_scope
      .map(normalizePath)
      .flatMap((filePath) => ['--files', shellQuote(filePath)]);
    // UTV2-1526: a Codex candidate's recommended command must include --model-profile --
    // ops:lane-start now requires it for codex-cli/codex-cloud executors. This mirrors
    // codex-dispatch.ts's own tier-based default (three-brain.md's routing table at the
    // same mechanical level); it is advisory text only, never executed by this script, so
    // an operator or /three-brain-informed orchestrator can still override it before running.
    const modelProfileArgs =
      candidate.executor === 'codex-cli' || candidate.executor === 'codex-cloud'
        ? ['--model-profile', candidate.tier === 'T1' ? 'codex-sol-high' : 'codex-terra-medium']
        : [];
    // UTV2-1533 lane-maximizer P2 fix: verification_target is never guessed from
    // candidate.issue_id. By the time pushPlan runs for a lane_type:"verification"
    // candidate, the evaluation loop has already required an explicit, validated
    // candidate.verification_target (MISSING_VERIFICATION_TARGET /
    // MALFORMED_VERIFICATION_TARGET block otherwise) -- the exact supplied value is
    // carried through unchanged.
    const verificationTargetArgs =
      laneType === 'verification' ? ['--verification-target', candidate.verification_target as string] : [];
    report.dispatch_plan.fill_now.push({
      issue_id: candidate.issue_id,
      executor: candidate.executor,
      lane_type: laneType,
      work_class: workClass,
      file_scope: candidate.file_scope.map(normalizePath),
      slot_index: slotIndex,
      explanation: `${candidate.executor} slot ${slotIndex} can run now; ${workClass} ${laneType} work has no active singleton, forbidden combination, or path overlap conflict.`,
      dispatch_command: [
        'pnpm',
        'ops:lane-start',
        candidate.issue_id,
        '--tier',
        candidate.tier,
        '--branch',
        shellQuote(branch),
        '--executor',
        candidate.executor,
        ...modelProfileArgs,
        '--lane-type',
        laneType,
        ...verificationTargetArgs,
        ...fileArgs,
      ].join(' '),
    });
    if (candidate.executor === 'claude') plannedClaude += 1;
    else plannedCodex += 1;
    projectedActive.push({
      issue_id: candidate.issue_id,
      lane_type: laneType,
      executor: candidate.executor,
      status: 'in_progress',
      file_scope_lock: candidate.file_scope.map(normalizePath),
      verification_target: laneType === 'verification' ? candidate.verification_target : undefined,
    });
  };

  for (const candidate of rankCandidates(candidates)) {
    const ranking = {
      rank: candidate.rank,
      ranking_score: candidate.ranking_score,
      ranking_reasons: candidate.ranking_reasons,
    };
    const fileScope = candidate.file_scope.map(normalizePath);
    const laneType = candidate.lane_type ?? inferLaneType(fileScope);
    const workClass = candidate.work_class ?? inferWorkClass(laneType, singletonLaneTypes);
    const hasIncompleteDependency = candidate.blocked_by.some((issueId) => !doneIssueIds.has(issueId));
    if (candidate.has_acceptance_criteria === false) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'MISSING_ACCEPTANCE_CRITERIA', ranking));
      continue;
    }

    if (fileScope.length === 0) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'MISSING_FILE_SCOPE', ranking));
      continue;
    }

    if (hasIncompleteDependency) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'BLOCKED_DEP', ranking));
      continue;
    }

    if (fileScope.some(isMigrationPath)) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'MIGRATION_PATH', ranking));
      continue;
    }

    if (candidate.tier === 'T1') {
      report.deferred.push(buildResult(candidate.issue_id, 'deferred', 'T1_REQUIRES_PM', ranking));
      continue;
    }

    // UTV2-1533 lane-maximizer P2 fix: a lane_type:"verification" candidate's real
    // target is never guessed from its own issue_id. Format/presence validation stays
    // local (checkConcurrencyLimits below assumes a caller already rejected a missing
    // or malformed target the way ops:lane-start's own CLI flag parsing does, before
    // ever reaching the shared cap-evaluation logic) -- fail closed at every step
    // rather than silently defaulting or silently allowing an unprovable per-target cap.
    if (laneType === 'verification') {
      if (!candidate.verification_target) {
        report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'MISSING_VERIFICATION_TARGET', ranking));
        continue;
      }

      if (!isValidVerificationTarget(candidate.verification_target)) {
        report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'MALFORMED_VERIFICATION_TARGET', ranking));
        continue;
      }
    }

    // Unified concurrency forecast. checkConcurrencyLimits() (imported from
    // concurrency-rules.ts) is the single canonical implementation of total/executor/
    // singleton/forbidden-combination/hygiene/governance/delivery-ui/verification-target
    // admission rules -- the exact same function ops:lane-start's checkConcurrencyLimits()
    // call site uses at real lane-creation time. Called twice per candidate:
    //   - `baselineViolations` against the real active board only, to classify an
    //     identity conflict (delivery-ui app / verification target) as one that already
    //     existed against active lanes;
    //   - `projectedViolations` against `projectedActive` (real active lanes PLUS every
    //     candidate already accepted earlier in this same wave), which is the actual
    //     admission decision for this candidate. `projectedActive` only grows, so
    //     baselineViolations is always a subset of projectedViolations -- any code
    //     present in projectedViolations but absent from baselineViolations arose purely
    //     from this wave, and is classified as an "already planned" conflict rather than
    //     an "active lane" conflict.
    const incomingScope: IncomingLaneScope = {
      fileScopeLock: fileScope,
      verificationTarget: laneType === 'verification' ? candidate.verification_target : undefined,
    };
    const laneTypeForCheck = laneType as CanonicalLaneType;
    const projectedViolations = checkConcurrencyLimits(
      projectedActive,
      laneTypeForCheck,
      candidate.executor,
      basePolicy,
      incomingScope,
    );
    if (projectedViolations.length > 0) {
      const baselineCodes = new Set(
        checkConcurrencyLimits(activeLanes, laneTypeForCheck, candidate.executor, basePolicy, incomingScope).map(
          (violation) => violation.code,
        ),
      );
      const primary = projectedViolations[0]!;
      const reasonKey = classifyViolation(primary.code, baselineCodes.has(primary.code));
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', reasonKey, ranking));
      continue;
    }

    // File-scope overlap check against the real active board AND every candidate
    // already accepted earlier in this same wave (projectedActive covers both, since it
    // starts as activeLanes and grows per accepted candidate above).
    const overlaps = fileScope.some((candidatePath) =>
      projectedActive.some((lane) => lane.file_scope_lock.some((lockedPath) => overlapsPath(candidatePath, lockedPath))),
    );
    if (overlaps) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'OVERLAP', ranking));
      continue;
    }

    if (fileScope.some(isTierCPath)) {
      report.risky.push(buildResult(candidate.issue_id, 'risky', 'TIER_C_PATH', ranking));
      continue;
    }

    report.recommended.push(buildResult(candidate.issue_id, 'recommended', undefined, ranking));
    pushPlan(candidate, laneType, workClass);
  }

  const forecast = report.dispatch_plan.lane_saturation_forecast;
  forecast.executors.claude.available_slots = Math.max(0, limits.maxClaude - activeClaude - plannedClaude);
  forecast.executors.codex.available_slots = Math.max(0, limits.maxCodex - activeCodex - plannedCodex);
  const availableSafeSlots = forecast.executors.claude.available_slots + forecast.executors.codex.available_slots;
  forecast.safe_class_recommendations = availableSafeSlots > 0
    ? [
        `Queue up to ${availableSafeSlots} hygiene, verification, governance, or ops-tooling lanes with disjoint file scopes.`,
        fullVerifyThrottle.available_slots > 0
          ? `Full verify throttle has ${fullVerifyThrottle.available_slots}/${fullVerifyThrottle.max_concurrent} slot available; preflight heavy checks are serialized independently of executor caps.`
          : `Full verify throttle is saturated (${fullVerifyThrottle.active}/${fullVerifyThrottle.max_concurrent}); wait before starting another full pnpm verify/pnpm test run.`,
        'Avoid runtime, migration, modeling, and data-canonical work while matching singleton classes are active.',
      ]
    : [
        'All configured executor slots are saturated by active or planned lanes.',
        fullVerifyThrottle.available_slots > 0
          ? `Full verify throttle has ${fullVerifyThrottle.available_slots}/${fullVerifyThrottle.max_concurrent} slot available for the next heavy verification run.`
          : `Full verify throttle is saturated (${fullVerifyThrottle.active}/${fullVerifyThrottle.max_concurrent}); do not start another full pnpm verify/pnpm test run yet.`,
      ];

  return report;
}

/**
 * Machine-readable candidate source actually used for a given argv. `linear` is
 * the canonical default -- the form `/dispatch`, `/dispatch-board` and
 * `/loop-dispatch` invoke.
 */
export type CandidateSource = 'linear' | 'queue' | 'explicit';

export type MaximizerErrorCode =
  | 'candidate_discovery_failed'
  | 'active_lane_discovery_failed'
  | 'evaluation_failed';

/**
 * The ONLY thing this CLI writes to stdout on a failure path. Deliberately not
 * report-shaped: no `recommended`/`blocked`/`risky`/`deferred` keys at all, so a
 * machine consumer that reads `.recommended` gets `undefined` rather than an
 * empty array it would misread as "no work available" (UTV2-1699 requirement 7).
 */
export interface MaximizerErrorEnvelope {
  ok: false;
  error: true;
  code: MaximizerErrorCode;
  message: string;
  remediation: string;
  candidate_source: CandidateSource;
}

export interface MaximizerCliDeps {
  /** Overrides the whole candidate-source selection. Used by failure-injection tests. */
  fetchCandidates?: (argv: string[]) => Promise<CandidateLane[]>;
  /** Transport seam for the canonical Linear candidate source. */
  linear?: LinearCandidateFetchDeps;
  /** Overrides the canonical active-lane resolution wholesale. */
  resolveActiveLanes?: (discoveryDeps?: ActiveLaneDiscoveryDeps) => LaneManifest[];
  /** Injected dependencies for the canonical active-lane resolver itself. */
  activeLaneDiscovery?: ActiveLaneDiscoveryDeps;
}

export interface MaximizerCliOutcome {
  exitCode: number;
  stdout: string;
  candidate_source: CandidateSource;
  report?: MaximizationReport;
  error?: MaximizerErrorEnvelope;
}

/**
 * UTV2-1699 Defect 0 repair. A BARE invocation now resolves to the canonical
 * Linear candidate source. Previously the no-flag branch fell through to
 * `parseCandidatesArg(argv)`, which parses an empty argv/stdin into zero
 * candidates -- so the canonical dispatch invocation never attempted discovery
 * at all and reported a well-formed empty board with exit 0.
 *
 * `--candidates` / `--from-stdin` remain available for a caller that genuinely
 * wants to supply the population itself, but they must now say so explicitly.
 */
export function resolveCandidateSource(
  argv: string[],
  hasTrackerCredential: boolean = Boolean(
    readConfiguredEnvValue('LINEAR_API_TOKEN') || readConfiguredEnvValue('LINEAR_API_KEY'),
  ),
): CandidateSource {
  if (hasFlag(argv, '--from-queue')) return 'queue';
  if (hasFlag(argv, '--candidates') || hasFlag(argv, '--from-stdin')) return 'explicit';
  // Tracker independence (ratified 2026-09-05). The queue file is a FIRST-CLASS
  // discovery source, not a fallback for tests: it is repo-owned, reviewable in
  // a PR, and available when the tracker is not. A bare invocation still
  // prefers the tracker when a credential exists -- the tracker remains the
  // richer source and nothing here makes it optional to CONSULT -- but with no
  // credential the previous behaviour was to throw
  // 'LINEAR_API_TOKEN or LINEAR_API_KEY not set' out of discovery, which made
  // the very first step of an ordinary task depend on the tracker.
  //
  // This is a source selection, not a silent degradation: `candidate_source` is
  // already reported on every outcome, so a caller can always see which
  // population it actually got.
  if (!hasTrackerCredential) return 'queue';
  return 'linear';
}

async function defaultFetchCandidates(
  argv: string[],
  linearDeps: LinearCandidateFetchDeps | undefined,
): Promise<CandidateLane[]> {
  switch (resolveCandidateSource(argv)) {
    case 'queue':
      return parseQueueCandidates(
        getFlagValue(argv, '--queue-file') ?? path.join(ROOT, 'docs', '06_status', 'ISSUE_QUEUE.md'),
      );
    case 'explicit':
      return parseCandidatesArg(argv);
    default:
      return fetchLinearCandidates(argv, linearDeps ?? {});
  }
}

function errorOutcome(
  code: MaximizerErrorCode,
  source: CandidateSource,
  message: string,
  remediation: string,
): MaximizerCliOutcome {
  const envelope: MaximizerErrorEnvelope = {
    ok: false,
    error: true,
    code,
    message,
    remediation,
    candidate_source: source,
  };
  return {
    exitCode: 1,
    stdout: `${JSON.stringify(envelope, null, 2)}\n`,
    candidate_source: source,
    error: envelope,
  };
}

/**
 * UTV2-1699 Defect 1 repair. Candidate discovery and active-lane discovery are
 * two DISTINCT fail-closed conditions with two distinct codes and two distinct
 * remediations, and neither is ever collapsed into an empty board with exit 0.
 * A genuinely empty candidate population still exits 0 with a real report, so
 * "no work today" stays distinguishable from "the board is unknown".
 */
export async function runMaximizerCli(
  argv: string[],
  deps: MaximizerCliDeps = {},
): Promise<MaximizerCliOutcome> {
  const source = resolveCandidateSource(argv);

  let candidates: CandidateLane[];
  try {
    candidates = deps.fetchCandidates
      ? await deps.fetchCandidates(argv)
      : await defaultFetchCandidates(argv, deps.linear);
  } catch (error) {
    return errorOutcome(
      'candidate_discovery_failed',
      source,
      `Could not read the ${source} candidate source, so the dispatchable population is unknown. ` +
        'Refusing to report an unknown candidate population as an empty board. ' +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
      source === 'linear'
        ? 'Restore LINEAR_API_TOKEN/LINEAR_API_KEY and network access to api.linear.app, then retry. An unknown board is never treated as an empty one.'
        : 'Repair the supplied candidate source (queue file or --candidates payload), then retry. An unknown board is never treated as an empty one.',
    );
  }

  let activeLanes: LaneManifest[];
  try {
    activeLanes = deps.resolveActiveLanes
      ? assertUsableActiveLanes(deps.resolveActiveLanes(deps.activeLaneDiscovery))
      : resolveActiveLanesCanonically(deps.activeLaneDiscovery);
  } catch (error) {
    return errorOutcome(
      'active_lane_discovery_failed',
      source,
      error instanceof ActiveLaneDiscoveryError || error instanceof Error
        ? error.message
        : 'Could not resolve the active-lane set from open pull requests.',
      'Restore `gh` authentication and network access and repair any unreadable lane manifest, then retry. Capacity, singleton, and file-scope conflict checks are unsafe against an unknown active board.',
    );
  }

  /**
   * UTV2-1699. Evaluation is the LAST place a discovered-state defect can
   * surface, and it used to run outside every try: anything thrown here
   * (a malformed lane manifest that slipped the boundary check, an unreadable
   * local done-manifest directory in `readDoneIssueIds`) escaped as an
   * unhandled rejection -- non-zero exit, empty stdout, no machine-readable
   * cause. Every exit path now emits an envelope or a report; none emits
   * nothing.
   */
  let report: MaximizationReport;
  try {
    report = evaluateCandidates(candidates, activeLanes, parseLimits(argv));
  } catch (error) {
    return errorOutcome(
      'evaluation_failed',
      source,
      'Could not evaluate the discovered board, so no dispatch recommendation can be trusted. ' +
        'Refusing to report an unevaluated board as an empty or safe one. ' +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
      'Repair the malformed lane manifest or local lane directory named in the cause, then retry. Capacity, singleton and file-scope conflict checks are unsafe against a board that could not be evaluated.',
    );
  }

  return {
    exitCode: 0,
    stdout: `${JSON.stringify(report, null, 2)}\n`,
    candidate_source: source,
    report,
  };
}

async function runCli(): Promise<void> {
  let outcome: MaximizerCliOutcome;
  try {
    outcome = await runMaximizerCli(process.argv.slice(2));
  } catch (error) {
    // Backstop. `runMaximizerCli` is envelope-complete by construction, but an
    // unhandled rejection here would exit non-zero with EMPTY stdout, which a
    // machine consumer cannot distinguish from a crash-free empty board.
    outcome = errorOutcome(
      'evaluation_failed',
      'linear',
      `lane-maximizer failed before it could produce a report. Cause: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'Report this as a lane-maximizer defect: an unenveloped failure path reached the CLI boundary.',
    );
  }
  if (outcome.error) {
    process.stderr.write(`[lane-maximizer] ${outcome.error.code}: ${outcome.error.message}\n`);
  }
  process.stdout.write(outcome.stdout);
  process.exitCode = outcome.exitCode;
}

const argv1 = process.argv[1] ?? '';
if (argv1.endsWith('lane-maximizer.ts') || argv1.endsWith('lane-maximizer.js')) {
  void runCli().catch((error: unknown) => {
    process.stderr.write(`[lane-maximizer] fatal: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
