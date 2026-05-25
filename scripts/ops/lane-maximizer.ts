import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageTouchingLaneRequiresSingleton } from './lane-execution.js';
import { loadConcurrencyConfig } from './concurrency-config.js';
import { ACTIVE_LOCK_STATUSES, resolveLaneExecutor } from './shared.js';

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
}

export interface CandidateLane {
  issue_id: string;
  tier: 'T1' | 'T2' | 'T3';
  executor: 'claude' | 'codex-cli';
  lane_type?: string;
  work_class?: string;
  file_scope: string[];
  blocked_by: string[];
  isolated_install_verified?: boolean;
}

export type RecommendDecision = 'recommended' | 'blocked' | 'risky' | 'deferred';

export interface RecommendationResult {
  issue_id: string;
  decision: RecommendDecision;
  reason_codes: string[];
  reasons: string[];
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
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
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

function inferWorkClass(laneType: string, singletonLaneTypes: string[]): string {
  return singletonLaneTypes.includes(laneType) ? 'singleton' : 'safe';
}

function activeLaneTypes(activeLanes: LaneManifest[]): string[] {
  return Array.from(new Set(activeLanes.map((lane) => lane.lane_type).filter(Boolean))).sort();
}

function hasForbiddenCombination(
  laneType: string,
  activeTypes: string[],
  forbiddenCombinations: [string, string][],
): boolean {
  return forbiddenCombinations.some(([left, right]) =>
    (left === laneType && activeTypes.includes(right)) || (right === laneType && activeTypes.includes(left)),
  );
}

function activeForbiddenCombinations(
  activeTypes: string[],
  forbiddenCombinations: [string, string][],
): string[][] {
  return forbiddenCombinations.filter(([left, right]) => activeTypes.includes(left) && activeTypes.includes(right));
}

function buildResult(
  issueId: string,
  decision: RecommendDecision,
  reasonCode?: keyof typeof REASON_MESSAGES,
): RecommendationResult {
  if (!reasonCode) {
    return {
      issue_id: issueId,
      decision,
      reason_codes: [],
      reasons: [],
    };
  }

  return {
    issue_id: issueId,
    decision,
    reason_codes: [reasonCode],
    reasons: [REASON_MESSAGES[reasonCode]],
  };
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

function parseLimits(argv: string[]): { maxClaude: number; maxCodex: number } {
  const cfg = (() => { try { return loadConcurrencyConfig(); } catch { return null; } })();
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
  const cfg = (() => { try { return loadConcurrencyConfig(); } catch { return null; } })();
  const doneIssueIds = options.doneIssueIds ?? readDoneIssueIds();
  const singletonLaneTypes = options.singletonLaneTypes ?? cfg?.singleton_types ?? [
    'runtime',
    'migration',
    'modeling',
    'data-canonical',
  ];
  const forbiddenCombinations = options.forbiddenCombinations ?? cfg?.forbidden_combinations ?? [];
  const activeClaude = activeLanes.filter((lane) => resolveLaneExecutor(lane) === 'claude').length;
  const activeCodex = activeLanes.filter((lane) => {
    const executor = resolveLaneExecutor(lane);
    return executor === 'codex-cli' || executor === 'codex-cloud';
  }).length;
  const initialActiveTypes = activeLaneTypes(activeLanes);

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
  const plannedLaneTypes = [...initialActiveTypes];

  const remainingSlots = (executor: CandidateLane['executor']): number => {
    if (executor === 'claude') return Math.max(0, limits.maxClaude - activeClaude - plannedClaude);
    return Math.max(0, limits.maxCodex - activeCodex - plannedCodex);
  };

  const pushPlan = (candidate: CandidateLane, laneType: string, workClass: string): void => {
    const slotIndex = candidate.executor === 'claude'
      ? activeClaude + plannedClaude + 1
      : activeCodex + plannedCodex + 1;
    report.dispatch_plan.fill_now.push({
      issue_id: candidate.issue_id,
      executor: candidate.executor,
      lane_type: laneType,
      work_class: workClass,
      file_scope: candidate.file_scope.map(normalizePath),
      slot_index: slotIndex,
      explanation: `${candidate.executor} slot ${slotIndex} can run now; ${workClass} ${laneType} work has no active singleton, forbidden combination, or path overlap conflict.`,
      dispatch_command: `pnpm ops:lane-start ${candidate.issue_id} --executor ${candidate.executor} --lane-type ${laneType}`,
    });
    if (candidate.executor === 'claude') plannedClaude += 1;
    else plannedCodex += 1;
    if (!plannedLaneTypes.includes(laneType)) plannedLaneTypes.push(laneType);
  };

  for (const candidate of candidates) {
    const fileScope = candidate.file_scope.map(normalizePath);
    const laneType = candidate.lane_type ?? inferLaneType(fileScope);
    const workClass = candidate.work_class ?? inferWorkClass(laneType, singletonLaneTypes);
    const hasIncompleteDependency = candidate.blocked_by.some((issueId) => !doneIssueIds.has(issueId));
    if (hasIncompleteDependency) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'BLOCKED_DEP'));
      continue;
    }

    if (fileScope.some(isMigrationPath)) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'MIGRATION_PATH'));
      continue;
    }

    if (candidate.tier === 'T1') {
      report.deferred.push(buildResult(candidate.issue_id, 'deferred', 'T1_REQUIRES_PM'));
      continue;
    }

    if (candidate.executor === 'claude' && remainingSlots(candidate.executor) <= 0) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'DISPATCH_LIMIT_CLAUDE'));
      continue;
    }

    if (candidate.executor === 'codex-cli' && remainingSlots(candidate.executor) <= 0) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'DISPATCH_LIMIT_CODEX'));
      continue;
    }

    if (singletonLaneTypes.includes(laneType) && plannedLaneTypes.includes(laneType)) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'SINGLETON_ACTIVE'));
      continue;
    }

    if (hasForbiddenCombination(laneType, plannedLaneTypes, forbiddenCombinations)) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'FORBIDDEN_COMBINATION'));
      continue;
    }

    if (
      packageTouchingLaneRequiresSingleton(fileScope, candidate.isolated_install_verified === true) &&
      activeLanes.length > 0
    ) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'ISOLATED_INSTALL_REQUIRED'));
      continue;
    }

    const overlaps = fileScope.some((candidatePath) =>
      activeLanes.some((lane) => lane.file_scope_lock.some((lockedPath) => overlapsPath(candidatePath, lockedPath))),
    );
    if (overlaps) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'OVERLAP'));
      continue;
    }

    if (fileScope.some(isTierCPath)) {
      report.risky.push(buildResult(candidate.issue_id, 'risky', 'TIER_C_PATH'));
      continue;
    }

    report.recommended.push(buildResult(candidate.issue_id, 'recommended'));
    pushPlan(candidate, laneType, workClass);
  }

  const forecast = report.dispatch_plan.lane_saturation_forecast;
  forecast.executors.claude.available_slots = Math.max(0, limits.maxClaude - activeClaude - plannedClaude);
  forecast.executors.codex.available_slots = Math.max(0, limits.maxCodex - activeCodex - plannedCodex);
  const availableSafeSlots = forecast.executors.claude.available_slots + forecast.executors.codex.available_slots;
  forecast.safe_class_recommendations = availableSafeSlots > 0
    ? [
        `Queue up to ${availableSafeSlots} hygiene, verification, governance, or ops-tooling lanes with disjoint file scopes.`,
        'Avoid runtime, migration, modeling, and data-canonical work while matching singleton classes are active.',
      ]
    : ['All configured executor slots are saturated by active or planned lanes.'];

  return report;
}

function runCli(): void {
  let candidates: CandidateLane[] = [];
  let activeLanes: LaneManifest[] = [];
  const cfg = (() => { try { return loadConcurrencyConfig(); } catch { return null; } })();
  const defaultLimits = { maxClaude: cfg?.executors.claude ?? 2, maxCodex: cfg?.executors.codex ?? 4 };
  let limits = defaultLimits;

  try {
    candidates = parseCandidatesArg(process.argv.slice(2));
    activeLanes = readActiveLanes();
    limits = parseLimits(process.argv.slice(2));
  } catch {
    candidates = [];
    activeLanes = [];
    limits = defaultLimits;
  }

  const report = evaluateCandidates(candidates, activeLanes, limits);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 0;
}

const argv1 = process.argv[1] ?? '';
if (argv1.endsWith('lane-maximizer.ts') || argv1.endsWith('lane-maximizer.js')) {
  runCli();
}
