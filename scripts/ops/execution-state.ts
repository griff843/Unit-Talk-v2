import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTIVE_LOCK_STATUSES,
  MANIFEST_DIR,
  ROOT,
  defaultProofPaths,
  emitJson,
  readAllManifests,
  type LaneManifest,
} from './shared.js';
import { getEffectiveConfig, loadConcurrencyConfig } from './concurrency-config.js';
import { MERGE_LOCK_PATH, readMergeLock } from './merge-mutex.js';

export interface ExecutionStateReport {
  generated_at: string;
  active_lanes: LaneSummary[];
  blocked_lanes: LaneSummary[];
  dispatch_slots: {
    claude: { used: number; max: number; available: number };
    codex: { used: number; max: number; available: number };
  };
  merge_risk_summary: {
    hard_fail: number;
    block: number;
    warning: number;
    top_conditions: string[];
  };
  dispatch_dashboard: DispatchDashboard;
  proof_readiness: ProofReadiness[];
  source_of_truth: {
    manifests_path: string;
    linear_url: string;
    github_url: string;
  };
}

export interface DispatchDashboard {
  active_by_executor: {
    claude: number;
    codex: number;
    unknown: number;
  };
  active_by_lane_type: Record<string, number>;
  stale_heartbeats: Array<{
    issue_id: string;
    heartbeat_at: string;
    age_hours: number;
  }>;
  singleton_blockers: Array<{
    lane_type: string;
    active_issue_ids: string[];
  }>;
  forbidden_pair_blockers: Array<{
    pair: [string, string];
    active_issue_ids: string[];
  }>;
  merge_mutex: {
    serialized_max: number;
    lock_path: string;
    status: string;
    issue_id: string | null;
    expires_at: string | null;
  };
  recommended_actions: string[];
}

export interface LaneSummary {
  issue_id: string;
  branch: string;
  executor: string;
  tier: string;
  status: string;
  heartbeat_at: string;
  pr_url: string | null;
  blockers: string[];
  source_url: string;
}

export interface ProofReadiness {
  issue_id: string;
  tier: string;
  required_artifacts: string[];
  present_artifacts: string[];
  ready: boolean;
}

interface MergeRiskConditionLike {
  code: string;
  severity: 'hard_fail' | 'block' | 'warning';
  lanes: string[];
  detail: string;
}

interface MergeRiskReportLike {
  generated_at: string;
  total_active_lanes: number;
  conditions: MergeRiskConditionLike[];
  summary: {
    hard_fail: number;
    block: number;
    warning: number;
  };
}

interface MergeRiskBuilderInput {
  lanes: LaneManifest[];
  remoteBranches: string[];
  openPrBranches: string[];
  mergedPrBranches: string[];
  nowMs?: number;
  generatedAt?: string;
}

interface BuildExecutionStateReportOptions {
  generatedAt?: string;
  nowMs?: number;
  linearBaseUrl?: string;
  githubBaseUrl?: string;
  artifactExists?: (artifact: string, manifest: LaneManifest) => boolean;
  mergeRiskBuilder?: (input: MergeRiskBuilderInput) => MergeRiskReportLike;
  mergeRiskInput?: Partial<Omit<MergeRiskBuilderInput, 'lanes'>>;
}

interface TierVerificationRule {
  fallbackToDefaultProofPaths: boolean;
  extraArtifacts: string[];
}

const LINEAR_BASE_URL = 'https://linear.app/unit-talk-v2';
const GITHUB_BASE_URL = 'https://github.com/griff843/Unit-Talk-v2';

// Load from CONCURRENCY_CONFIG.json — single source of truth
const _cc = (() => { try { return getEffectiveConfig(loadConcurrencyConfig()); } catch { return null; } })();
export const MAX_CLAUDE_LANES = _cc?.executors.claude ?? 2;
export const MAX_CODEX_LANES = _cc?.executors.codex ?? 4;
const SINGLETON_TYPES = _cc?.singleton_types ?? ['runtime', 'migration', 'modeling', 'data-canonical'];
const FORBIDDEN_COMBINATIONS = (_cc?.forbidden_combinations ?? []) as Array<[string, string]>;
const MERGE_SERIALIZED_MAX = _cc?.merge_serialized_max ?? 1;

const TIER_VERIFICATION_MAP: Record<'T1' | 'T2' | 'T3', TierVerificationRule> = {
  T1: {
    fallbackToDefaultProofPaths: true,
    extraArtifacts: ['pnpm test:db'],
  },
  T2: {
    fallbackToDefaultProofPaths: false,
    extraArtifacts: [],
  },
  T3: {
    fallbackToDefaultProofPaths: false,
    extraArtifacts: [],
  },
};

const STALE_HEARTBEAT_MS = 72 * 60 * 60 * 1000;
const SEVERITY_RANK: Record<MergeRiskConditionLike['severity'], number> = {
  hard_fail: 0,
  block: 1,
  warning: 2,
};

export function buildExecutionStateReport(
  manifests: LaneManifest[],
  options: BuildExecutionStateReportOptions = {},
): ExecutionStateReport {
  const generatedAt = options.generatedAt ?? new Date(options.nowMs ?? Date.now()).toISOString();
  const linearBaseUrl = options.linearBaseUrl ?? LINEAR_BASE_URL;
  const githubBaseUrl = options.githubBaseUrl ?? GITHUB_BASE_URL;
  const activeManifests = manifests.filter(isActiveLane);
  const blockedManifests = activeManifests.filter(isBlockedLane);
  const artifactExists = options.artifactExists ?? defaultArtifactExists;

  const mergeRiskReport = (options.mergeRiskBuilder ?? fallbackBuildMergeRiskReport)({
    lanes: activeManifests,
    remoteBranches: options.mergeRiskInput?.remoteBranches ?? [],
    openPrBranches: options.mergeRiskInput?.openPrBranches ?? [],
    mergedPrBranches: options.mergeRiskInput?.mergedPrBranches ?? [],
    nowMs: options.nowMs,
    generatedAt,
  });

  return {
    generated_at: generatedAt,
    active_lanes: activeManifests
      .map((manifest) => summarizeLane(manifest, linearBaseUrl))
      .sort(compareLaneSummary),
    blocked_lanes: blockedManifests
      .map((manifest) => summarizeLane(manifest, linearBaseUrl))
      .sort(compareLaneSummary),
    dispatch_slots: buildDispatchSlots(activeManifests),
    merge_risk_summary: {
      hard_fail: mergeRiskReport.summary.hard_fail,
      block: mergeRiskReport.summary.block,
      warning: mergeRiskReport.summary.warning,
      top_conditions: topConditionCodes(mergeRiskReport.conditions, 3),
    },
    dispatch_dashboard: buildDispatchDashboard(activeManifests, {
      nowMs: options.nowMs ?? Date.now(),
      mergeRiskConditions: mergeRiskReport.conditions,
    }),
    proof_readiness: activeManifests
      .map((manifest) => buildProofReadiness(manifest, artifactExists))
      .sort((left, right) => left.issue_id.localeCompare(right.issue_id)),
    source_of_truth: {
      manifests_path: MANIFEST_DIR,
      linear_url: linearBaseUrl,
      github_url: githubBaseUrl,
    },
  };
}

function buildDispatchDashboard(
  manifests: LaneManifest[],
  options: { nowMs: number; mergeRiskConditions: MergeRiskConditionLike[] },
): DispatchDashboard {
  const activeByExecutor = {
    claude: manifests.filter((manifest) => classifyExecutor(manifest) === 'claude').length,
    codex: manifests.filter((manifest) => classifyExecutor(manifest) === 'codex').length,
    unknown: manifests.filter((manifest) => classifyExecutor(manifest) === 'unknown').length,
  };
  const activeByLaneType = buildActiveByLaneType(manifests);
  const singletonBlockers = SINGLETON_TYPES.flatMap((laneType) => {
    const activeIssueIds = manifests
      .filter((manifest) => manifest.lane_type === laneType)
      .map((manifest) => manifest.issue_id)
      .sort();
    return activeIssueIds.length > 0 ? [{ lane_type: laneType, active_issue_ids: activeIssueIds }] : [];
  });
  const forbiddenPairBlockers = FORBIDDEN_COMBINATIONS.flatMap((pair) => {
    const activeIssueIds = manifests
      .filter((manifest) => pair.includes(manifest.lane_type))
      .map((manifest) => manifest.issue_id)
      .sort();
    const activeTypes = new Set(
      manifests
        .filter((manifest) => activeIssueIds.includes(manifest.issue_id))
        .map((manifest) => manifest.lane_type),
    );
    return activeTypes.has(pair[0]) && activeTypes.has(pair[1])
      ? [{ pair, active_issue_ids: activeIssueIds }]
      : [];
  });
  const staleHeartbeats = buildStaleHeartbeatSummaries(manifests, options.nowMs);
  const dispatchSlots = buildDispatchSlots(manifests);
  const mergeMutex = readMergeMutexSummary();

  return {
    active_by_executor: activeByExecutor,
    active_by_lane_type: activeByLaneType,
    stale_heartbeats: staleHeartbeats,
    singleton_blockers: singletonBlockers,
    forbidden_pair_blockers: forbiddenPairBlockers,
    merge_mutex: mergeMutex,
    recommended_actions: buildRecommendedDashboardActions({
      staleHeartbeats,
      singletonBlockers,
      forbiddenPairBlockers,
      mergeMutex,
      dispatchSlots,
      mergeRiskConditions: options.mergeRiskConditions,
    }),
  };
}

function buildActiveByLaneType(manifests: LaneManifest[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const manifest of manifests) {
    counts[manifest.lane_type] = (counts[manifest.lane_type] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function buildStaleHeartbeatSummaries(
  manifests: LaneManifest[],
  nowMs: number,
): DispatchDashboard['stale_heartbeats'] {
  return manifests
    .filter((manifest) => Date.parse(manifest.heartbeat_at) + STALE_HEARTBEAT_MS < nowMs)
    .map((manifest) => ({
      issue_id: manifest.issue_id,
      heartbeat_at: manifest.heartbeat_at,
      age_hours: Math.round((nowMs - Date.parse(manifest.heartbeat_at)) / (60 * 60 * 1000)),
    }))
    .sort((left, right) => left.issue_id.localeCompare(right.issue_id));
}

function readMergeMutexSummary(): DispatchDashboard['merge_mutex'] {
  const result = readMergeLock(MERGE_LOCK_PATH);
  if (!result.ok) {
    return {
      serialized_max: MERGE_SERIALIZED_MAX,
      lock_path: MERGE_LOCK_PATH,
      status: result.code === 'merge_lock_missing' ? 'released' : result.code,
      issue_id: null,
      expires_at: null,
    };
  }
  if (result.lock.status === 'released') {
    return {
      serialized_max: MERGE_SERIALIZED_MAX,
      lock_path: MERGE_LOCK_PATH,
      status: 'released',
      issue_id: null,
      expires_at: null,
    };
  }
  return {
    serialized_max: MERGE_SERIALIZED_MAX,
    lock_path: MERGE_LOCK_PATH,
    status: result.lock.status,
    issue_id: result.lock.issue_id,
    expires_at: result.lock.expires_at,
  };
}

function buildRecommendedDashboardActions(input: {
  staleHeartbeats: DispatchDashboard['stale_heartbeats'];
  singletonBlockers: DispatchDashboard['singleton_blockers'];
  forbiddenPairBlockers: DispatchDashboard['forbidden_pair_blockers'];
  mergeMutex: DispatchDashboard['merge_mutex'];
  dispatchSlots: ExecutionStateReport['dispatch_slots'];
  mergeRiskConditions: MergeRiskConditionLike[];
}): string[] {
  const actions: string[] = [];
  if (input.staleHeartbeats.length > 0) {
    actions.push(`reconcile stale heartbeat lanes: ${input.staleHeartbeats.map((lane) => lane.issue_id).join(', ')}`);
  }
  for (const blocker of input.singletonBlockers.filter((blocker) => blocker.active_issue_ids.length > 1)) {
    actions.push(`resolve duplicate singleton lane_type:${blocker.lane_type}`);
  }
  for (const blocker of input.forbiddenPairBlockers) {
    actions.push(`resolve forbidden lane pair: ${blocker.pair.join(' + ')}`);
  }
  if (input.mergeMutex.status === 'held') {
    actions.push(`merge mutex held by ${input.mergeMutex.issue_id ?? 'unknown'}`);
  } else if (input.mergeMutex.status === 'stale_reclaim_required') {
    actions.push(`reclaim stale merge mutex from ${input.mergeMutex.issue_id ?? 'unknown'}`);
  }
  const mergedPrActiveManifestIssues = uniqueSorted(
    input.mergeRiskConditions
      .filter((condition) => condition.code === 'MERGED_PR_ACTIVE_MANIFEST')
      .flatMap((condition) => condition.lanes),
  );
  if (mergedPrActiveManifestIssues.length > 0) {
    actions.push(`record merged PR evidence on lane manifests: ${mergedPrActiveManifestIssues.join(', ')}`);
  }
  if (input.mergeRiskConditions.some((condition) => condition.severity === 'hard_fail')) {
    actions.push('resolve hard-fail merge risk before dispatching more lanes');
  }
  if (input.dispatchSlots.codex.available > 0) {
    actions.push(`codex slots available: ${input.dispatchSlots.codex.available}`);
  }
  if (input.dispatchSlots.claude.available > 0) {
    actions.push(`claude slots available: ${input.dispatchSlots.claude.available}`);
  }
  if (actions.length === 0) {
    actions.push('dispatch board saturated; close or merge existing lanes first');
  }
  return actions;
}

function buildProofReadiness(
  manifest: LaneManifest,
  artifactExists: (artifact: string, manifest: LaneManifest) => boolean,
): ProofReadiness {
  const requiredArtifacts = requiredArtifactsForLane(manifest);
  const presentArtifacts = requiredArtifacts.filter((artifact) =>
    artifactExists(artifact, manifest),
  );

  return {
    issue_id: manifest.issue_id,
    tier: manifest.tier,
    required_artifacts: requiredArtifacts,
    present_artifacts: presentArtifacts,
    ready: requiredArtifacts.every((artifact) => presentArtifacts.includes(artifact)),
  };
}

function requiredArtifactsForLane(manifest: LaneManifest): string[] {
  const tierRule = TIER_VERIFICATION_MAP[manifest.tier] ?? TIER_VERIFICATION_MAP.T3;
  const manifestArtifacts = normalizePaths(manifest.expected_proof_paths);
  const proofArtifacts =
    manifestArtifacts.length > 0
      ? manifestArtifacts
      : tierRule.fallbackToDefaultProofPaths
        ? normalizePaths(defaultProofPaths(manifest.issue_id, manifest.tier))
        : [];

  return normalizePaths([...proofArtifacts, ...tierRule.extraArtifacts]);
}

function defaultArtifactExists(artifact: string, manifest: LaneManifest): boolean {
  if (artifact === 'pnpm test:db') {
    return manifest.expected_proof_paths.some((proofPath) => {
      try {
        const absolutePath = path.join(ROOT, proofPath);
        if (!fs.existsSync(absolutePath)) {
          return false;
        }
        return /pnpm test:db/i.test(fs.readFileSync(absolutePath, 'utf8'));
      } catch {
        return false;
      }
    });
  }

  return fs.existsSync(path.join(ROOT, artifact));
}

function summarizeLane(manifest: LaneManifest, linearBaseUrl: string): LaneSummary {
  return {
    issue_id: manifest.issue_id,
    branch: manifest.branch,
    executor: resolveExecutor(manifest),
    tier: manifest.tier,
    status: manifest.status,
    heartbeat_at: manifest.heartbeat_at,
    pr_url: manifest.pr_url,
    blockers: [...manifest.blocked_by],
    source_url: `${linearBaseUrl}/issue/${manifest.issue_id}/`,
  };
}

function compareLaneSummary(left: LaneSummary, right: LaneSummary): number {
  return left.issue_id.localeCompare(right.issue_id);
}

function isActiveLane(manifest: LaneManifest): boolean {
  return ACTIVE_LOCK_STATUSES.has(manifest.status);
}

function isBlockedLane(manifest: LaneManifest): boolean {
  return manifest.status === 'blocked' || manifest.blocked_by.length > 0;
}

function resolveExecutor(manifest: LaneManifest): string {
  return manifest.executor ?? manifest.created_by ?? manifest.lane_type ?? 'unknown';
}

function buildDispatchSlots(manifests: LaneManifest[]): ExecutionStateReport['dispatch_slots'] {
  const claudeUsed = manifests.filter((manifest) => classifyExecutor(manifest) === 'claude').length;
  const codexUsed = manifests.filter((manifest) => classifyExecutor(manifest) === 'codex').length;

  return {
    claude: {
      used: claudeUsed,
      max: MAX_CLAUDE_LANES,
      available: Math.max(0, MAX_CLAUDE_LANES - claudeUsed),
    },
    codex: {
      used: codexUsed,
      max: MAX_CODEX_LANES,
      available: Math.max(0, MAX_CODEX_LANES - codexUsed),
    },
  };
}

function classifyExecutor(manifest: LaneManifest): 'claude' | 'codex' | 'unknown' {
  const executor = String(manifest.executor ?? '').toLowerCase();
  const laneType = String(manifest.lane_type ?? '').toLowerCase();
  const createdBy = String(manifest.created_by ?? '').toLowerCase();
  const branch = String(manifest.branch ?? '').toLowerCase();

  if (executor === 'claude' || laneType === 'claude' || createdBy === 'claude') {
    return 'claude';
  }

  if (
    executor.startsWith('codex') ||
    laneType === 'codex' ||
    laneType.startsWith('codex-') ||
    createdBy.startsWith('codex') ||
    branch.startsWith('codex/')
  ) {
    return 'codex';
  }

  return 'unknown';
}

function topConditionCodes(conditions: MergeRiskConditionLike[], limit: number): string[] {
  const ordered = [...conditions].sort((left, right) => {
    const severityDelta = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return left.code.localeCompare(right.code);
  });

  const seen = new Set<string>();
  const codes: string[] = [];
  for (const condition of ordered) {
    if (seen.has(condition.code)) {
      continue;
    }
    seen.add(condition.code);
    codes.push(condition.code);
    if (codes.length >= limit) {
      break;
    }
  }

  return codes;
}

function normalizePaths(paths: string[]): string[] {
  return [...new Set(paths.map((entry) => entry.replaceAll('\\', '/').replace(/^\.\//, '')))]
    .sort((left, right) => left.localeCompare(right));
}

function fallbackBuildMergeRiskReport(input: MergeRiskBuilderInput): MergeRiskReportLike {
  const conditions = [
    ...detectFileOverlap(input.lanes),
    ...detectBlockedDeps(input.lanes),
    ...detectStaleHeartbeat(input.lanes, input.nowMs ?? Date.now()),
    ...detectMergedPrActiveManifests(input.lanes, input.mergedPrBranches),
    ...fallbackDetectDispatchSaturation(input.lanes),
  ];

  return {
    generated_at: input.generatedAt ?? new Date(input.nowMs ?? Date.now()).toISOString(),
    total_active_lanes: input.lanes.length,
    conditions,
    summary: {
      hard_fail: conditions.filter((condition) => condition.severity === 'hard_fail').length,
      block: conditions.filter((condition) => condition.severity === 'block').length,
      warning: conditions.filter((condition) => condition.severity === 'warning').length,
    },
  };
}

function detectFileOverlap(lanes: LaneManifest[]): MergeRiskConditionLike[] {
  const conditions: MergeRiskConditionLike[] = [];

  for (let index = 0; index < lanes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < lanes.length; otherIndex += 1) {
      const left = lanes[index];
      const right = lanes[otherIndex];
      const overlap = intersect(left.file_scope_lock, right.file_scope_lock);
      if (overlap.length === 0) {
        continue;
      }

      conditions.push({
        code: 'FILE_OVERLAP',
        severity: 'block',
        lanes: [left.issue_id, right.issue_id],
        detail: `Shared file_scope_lock paths: ${overlap.join(', ')}`,
      });
    }
  }

  return conditions;
}

function detectBlockedDeps(lanes: LaneManifest[]): MergeRiskConditionLike[] {
  const activeIds = new Set(lanes.map((lane) => lane.issue_id));

  return lanes
    .map((lane) => {
      const unresolved = uniqueSorted(
        lane.blocked_by.filter((issueId) => activeIds.has(issueId)),
      );
      if (unresolved.length === 0) {
        return null;
      }

      return {
        code: 'BLOCKED_DEP_NOT_DONE',
        severity: 'block' as const,
        lanes: [lane.issue_id, ...unresolved],
        detail: `Lane is blocked by active unresolved dependencies: ${unresolved.join(', ')}`,
      };
    })
    .filter(isDefined);
}

function detectStaleHeartbeat(
  lanes: LaneManifest[],
  nowMs: number,
): MergeRiskConditionLike[] {
  return lanes
    .map((lane) => {
      const heartbeatMs = Date.parse(String(lane.heartbeat_at ?? ''));
      if (Number.isNaN(heartbeatMs) || nowMs - heartbeatMs <= STALE_HEARTBEAT_MS) {
        return null;
      }

      const ageHours = Math.floor((nowMs - heartbeatMs) / (60 * 60 * 1000));
      return {
        code: 'STALE_LANE_HEARTBEAT',
        severity: 'warning' as const,
        lanes: [lane.issue_id],
        detail: `heartbeat_at is ${ageHours}h old for branch "${lane.branch}"`,
      };
    })
    .filter(isDefined);
}

function detectMergedPrActiveManifests(
  lanes: LaneManifest[],
  mergedPrBranches: string[],
): MergeRiskConditionLike[] {
  const mergedBranches = new Set(mergedPrBranches);
  return lanes
    .filter((lane) => mergedBranches.has(lane.branch))
    .map((lane) => ({
      code: 'MERGED_PR_ACTIVE_MANIFEST',
      severity: 'hard_fail' as const,
      lanes: [lane.issue_id],
      detail: `PR branch "${lane.branch}" is merged but manifest status is "${lane.status}"; run ops:lane-manifest record-merge before closeout`,
    }));
}

function fallbackDetectDispatchSaturation(lanes: LaneManifest[]): MergeRiskConditionLike[] {
  const claudeLanes = lanes.filter((lane) => classifyExecutor(lane) === 'claude');
  const codexLanes = lanes.filter((lane) => classifyExecutor(lane) === 'codex');
  const details: string[] = [];

  if (codexLanes.length >= MAX_CODEX_LANES) {
    details.push(`codex active lanes=${codexLanes.length} (max ${MAX_CODEX_LANES} - slot full)`);
  }
  if (claudeLanes.length >= MAX_CLAUDE_LANES) {
    details.push(`claude active lanes=${claudeLanes.length} (max ${MAX_CLAUDE_LANES} - slot full)`);
  }
  if (details.length === 0) {
    return [];
  }

  return [
    {
      code: 'DISPATCH_LIMIT_SATURATION',
      severity: 'block',
      lanes: [...codexLanes, ...claudeLanes].map((lane) => lane.issue_id),
      detail: details.join('; '),
    },
  ];
}

function intersect(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return uniqueSorted(left.filter((entry) => rightSet.has(entry)));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}

function main(): void {
  emitJson(buildExecutionStateReport(readAllManifests()));
}

const isDirectRun = process.argv[1] != null
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main();
}
