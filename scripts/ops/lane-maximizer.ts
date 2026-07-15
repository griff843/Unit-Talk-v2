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
  ACTIVE_LOCK_STATUSES,
  readConfiguredEnvValue,
  requireVerificationTarget,
  resolveLaneExecutor,
  type CanonicalLaneType,
} from './shared.js';
import {
  checkConcurrencyLimits,
  type ConcurrencyManifestLike,
  type IncomingLaneScope,
} from './concurrency-rules.js';
import { linearQuery } from './linear-client.js';
import {
  FULL_VERIFY_THROTTLE_DIR,
  FULL_VERIFY_THROTTLE_STALE_MS,
  configuredFullVerifyConcurrency,
} from './preflight.js';

export interface LaneManifest {
  schema_version: number;
  issue_id: string;
  lane_type: string;
  executor: 'claude' | 'codex-cli' | 'codex-cloud';
  tier: 'T1' | 'T2' | 'T3';
  branch: string;
  base_branch: string;
  status: 'started' | 'in_progress' | 'in_review' | 'merged' | 'done' | 'blocked' | 'reopened';
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

function isValidVerificationTarget(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  try {
    requireVerificationTarget(value);
    return true;
  } catch {
    return false;
  }
}

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

function activeLaneTypes(activeLanes: LaneManifest[]): string[] {
  return Array.from(new Set(activeLanes.map((lane) => lane.lane_type).filter(Boolean))).sort();
}

function activeForbiddenCombinations(
  activeTypes: string[],
  forbiddenCombinations: [string, string][],
): string[][] {
  return forbiddenCombinations.filter(([left, right]) => activeTypes.includes(left) && activeTypes.includes(right));
}

function readThrottleOwner(slotPath: string): { acquired_at?: string } | null {
  const ownerPath = path.join(slotPath, 'owner.json');
  if (!fs.existsSync(ownerPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as { acquired_at?: string };
  } catch {
    return null;
  }
}

function fullVerifySlotIsActive(slotPath: string): boolean {
  const owner = readThrottleOwner(slotPath);
  const acquiredAt = owner?.acquired_at
    ? Date.parse(owner.acquired_at)
    : fs.statSync(slotPath).mtimeMs;
  return Boolean(acquiredAt) && Date.now() - acquiredAt <= FULL_VERIFY_THROTTLE_STALE_MS;
}

function readFullVerifyThrottleState(): LaneSaturationForecast['full_verify_throttle'] {
  const maxConcurrent = configuredFullVerifyConcurrency();
  const active = fs.existsSync(FULL_VERIFY_THROTTLE_DIR)
    ? fs
        .readdirSync(FULL_VERIFY_THROTTLE_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^slot-\d+$/.test(entry.name))
        .filter((entry) => fullVerifySlotIsActive(path.join(FULL_VERIFY_THROTTLE_DIR, entry.name)))
        .length
    : 0;
  return {
    max_concurrent: maxConcurrent,
    active,
    available_slots: Math.max(0, maxConcurrent - active),
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

function readActiveLanes(dir: string = LANE_DIR): LaneManifest[] {
  return readLaneManifests(dir).filter((manifest) => ACTIVE_LOCK_STATUSES.has(manifest.status));
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

export function isBlockingLinearRelationType(type: string): boolean {
  return type === 'blocks' || type === 'blocked_by';
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

async function fetchLinearCandidates(argv: string[]): Promise<CandidateLane[]> {
  const token = readConfiguredEnvValue('LINEAR_API_TOKEN') || readConfiguredEnvValue('LINEAR_API_KEY');
  if (!token) {
    throw new Error('LINEAR_API_TOKEN or LINEAR_API_KEY not set');
  }

  const teamKey = getFlagValue(argv, '--linear-team-key') ?? process.env.LINEAR_TEAM_KEY?.trim() ?? 'UTV2';
  const limitRaw = Number.parseInt(getFlagValue(argv, '--linear-limit') ?? '10', 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 10;
  const linearOpts = { token, userAgent: 'unit-talk-ops-lane-maximizer' };
  const teamResult = await linearQuery<{
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
  const result = await linearQuery<{
    team: {
      issues: {
        nodes: Array<{
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
        }>;
      };
    } | null;
  }>(
    `query LaneCandidates($teamId: String!, $limit: Int!) {
       team(id: $teamId) {
         issues(
           first: $limit
           filter: { state: { type: { in: ["backlog", "unstarted"] } } }
           orderBy: updatedAt
         ) {
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
           }
         }
       }
     }`,
    { teamId, limit },
    linearOpts,
  );

  if (!result.ok || !result.data?.team) {
    throw new Error(`Linear candidate query failed: ${result.error ?? 'unknown'}`);
  }

  return result.data.team.issues.nodes.flatMap((issue): CandidateLane[] => {
    const labels = issue.labels.nodes.map((label) => label.name);
    const tier = parseTierLabel(labels);
    if (!tier) {
      return [];
    }
    const blockedBy = issue.relations.nodes
      .filter((relation) => isBlockingLinearRelationType(relation.type))
      .map((relation) => relation.relatedIssue?.identifier)
      .filter((identifier): identifier is string => Boolean(identifier));
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
        total: limits.maxClaude + limits.maxCodex,
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
  const activeClaude = activeLanes.filter((lane) => resolveLaneExecutor(lane) === 'claude').length;
  const activeCodex = activeLanes.filter((lane) => {
    const executor = resolveLaneExecutor(lane);
    return executor === 'codex-cli' || executor === 'codex-cloud';
  }).length;
  const initialActiveTypes = activeLaneTypes(activeLanes);
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

async function runCli(): Promise<void> {
  let candidates: CandidateLane[] = [];
  let activeLanes: LaneManifest[] = [];
  const cfg = (() => { try { return getEffectiveConfig(loadConcurrencyConfig()); } catch { return null; } })();
  const defaultLimits = { maxClaude: cfg?.executors.claude ?? 2, maxCodex: cfg?.executors.codex ?? 4 };
  let limits = defaultLimits;
  const argv = process.argv.slice(2);

  try {
    if (hasFlag(argv, '--from-linear')) {
      candidates = await fetchLinearCandidates(argv);
    } else if (hasFlag(argv, '--from-queue')) {
      candidates = parseQueueCandidates(
        getFlagValue(argv, '--queue-file') ?? path.join(ROOT, 'docs', '06_status', 'ISSUE_QUEUE.md'),
      );
    } else {
      candidates = parseCandidatesArg(argv);
    }
    activeLanes = readActiveLanes();
    limits = parseLimits(argv);
  } catch (error) {
    candidates = [];
    activeLanes = [];
    limits = defaultLimits;
    process.stderr.write(
      `[lane-maximizer] ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  const report = evaluateCandidates(candidates, activeLanes, limits);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 0;
}

const argv1 = process.argv[1] ?? '';
if (argv1.endsWith('lane-maximizer.ts') || argv1.endsWith('lane-maximizer.js')) {
  void runCli();
}
