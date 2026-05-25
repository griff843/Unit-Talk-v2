import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
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
import { loadConcurrencyConfig } from './concurrency-config.js';
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
  started_at: string;
  heartbeat_at: string;
  lane_age_hours: number;
  heartbeat_age_hours: number;
  pr_url: string | null;
  pr_state: 'none' | 'linked' | 'open' | 'merged';
  check_state: 'unknown' | 'pending' | 'success' | 'failure';
  branch_drift: 'unknown' | 'remote_present' | 'remote_missing' | 'merged_pr_active_manifest';
  proof_ready: boolean;
  merge_ready: boolean;
  conflict_risk: 'clear' | MergeRiskConditionLike['severity'];
  recommended_action: string;
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
  checkStateByBranch?: Record<string, string>;
  checkStateByIssue?: Record<string, string>;
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
const _cc = (() => { try { return loadConcurrencyConfig(); } catch { return null; } })();
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
  const nowMs = options.nowMs ?? Date.now();

  const mergeRiskReport = (options.mergeRiskBuilder ?? fallbackBuildMergeRiskReport)({
    lanes: activeManifests,
    remoteBranches: options.mergeRiskInput?.remoteBranches ?? [],
    openPrBranches: options.mergeRiskInput?.openPrBranches ?? [],
    mergedPrBranches: options.mergeRiskInput?.mergedPrBranches ?? [],
    checkStateByBranch: options.mergeRiskInput?.checkStateByBranch,
    checkStateByIssue: options.mergeRiskInput?.checkStateByIssue,
    nowMs,
    generatedAt,
  });
  const proofReadiness = activeManifests
    .map((manifest) => buildProofReadiness(manifest, artifactExists))
    .sort((left, right) => left.issue_id.localeCompare(right.issue_id));

  return {
    generated_at: generatedAt,
    active_lanes: activeManifests
      .map((manifest) => summarizeLane(manifest, {
        nowMs,
        linearBaseUrl,
        proofReadiness,
        mergeRiskConditions: mergeRiskReport.conditions,
        remoteBranches: options.mergeRiskInput?.remoteBranches ?? [],
        openPrBranches: options.mergeRiskInput?.openPrBranches ?? [],
        mergedPrBranches: options.mergeRiskInput?.mergedPrBranches ?? [],
        checkStateByBranch: options.mergeRiskInput?.checkStateByBranch ?? {},
        checkStateByIssue: options.mergeRiskInput?.checkStateByIssue ?? {},
      }))
      .sort(compareLaneSummary),
    blocked_lanes: blockedManifests
      .map((manifest) => summarizeLane(manifest, {
        nowMs,
        linearBaseUrl,
        proofReadiness,
        mergeRiskConditions: mergeRiskReport.conditions,
        remoteBranches: options.mergeRiskInput?.remoteBranches ?? [],
        openPrBranches: options.mergeRiskInput?.openPrBranches ?? [],
        mergedPrBranches: options.mergeRiskInput?.mergedPrBranches ?? [],
        checkStateByBranch: options.mergeRiskInput?.checkStateByBranch ?? {},
        checkStateByIssue: options.mergeRiskInput?.checkStateByIssue ?? {},
      }))
      .sort(compareLaneSummary),
    dispatch_slots: buildDispatchSlots(activeManifests),
    merge_risk_summary: {
      hard_fail: mergeRiskReport.summary.hard_fail,
      block: mergeRiskReport.summary.block,
      warning: mergeRiskReport.summary.warning,
      top_conditions: topConditionCodes(mergeRiskReport.conditions, 3),
    },
    dispatch_dashboard: buildDispatchDashboard(activeManifests, {
      nowMs,
      mergeRiskConditions: mergeRiskReport.conditions,
    }),
    proof_readiness: proofReadiness,
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

function summarizeLane(
  manifest: LaneManifest,
  context: {
    nowMs: number;
    linearBaseUrl: string;
    proofReadiness: ProofReadiness[];
    mergeRiskConditions: MergeRiskConditionLike[];
    remoteBranches: string[];
    openPrBranches: string[];
    mergedPrBranches: string[];
    checkStateByBranch: Record<string, string>;
    checkStateByIssue: Record<string, string>;
  },
): LaneSummary {
  const proofReady = context.proofReadiness.find((entry) => entry.issue_id === manifest.issue_id)?.ready ?? false;
  const conflictRisk = conflictRiskForLane(manifest, context.mergeRiskConditions);
  const prState = prStateForLane(manifest, context.openPrBranches, context.mergedPrBranches);
  const checkState = checkStateForLane(manifest, context.checkStateByBranch, context.checkStateByIssue);
  const branchDrift = branchDriftForLane(manifest, context.remoteBranches, context.mergedPrBranches);
  const mergeReady = isLaneMergeReady({
    proofReady,
    conflictRisk,
    prState,
    checkState,
    branchDrift,
  });

  return {
    issue_id: manifest.issue_id,
    branch: manifest.branch,
    executor: resolveExecutor(manifest),
    tier: manifest.tier,
    status: manifest.status,
    started_at: manifest.started_at,
    heartbeat_at: manifest.heartbeat_at,
    lane_age_hours: ageHours(manifest.started_at, context.nowMs),
    heartbeat_age_hours: ageHours(manifest.heartbeat_at, context.nowMs),
    pr_url: manifest.pr_url,
    pr_state: prState,
    check_state: checkState,
    branch_drift: branchDrift,
    proof_ready: proofReady,
    merge_ready: mergeReady,
    conflict_risk: conflictRisk,
    recommended_action: recommendedActionForLane({
      proofReady,
      conflictRisk,
      prState,
      checkState,
      branchDrift,
      mergeReady,
    }),
    blockers: [...manifest.blocked_by],
    source_url: `${context.linearBaseUrl}/issue/${manifest.issue_id}/`,
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

function ageHours(timestamp: string, nowMs: number): number {
  const timestampMs = Date.parse(timestamp);
  if (Number.isNaN(timestampMs)) {
    return 0;
  }
  return Math.max(0, Math.round((nowMs - timestampMs) / (60 * 60 * 1000)));
}

function prStateForLane(
  manifest: LaneManifest,
  openPrBranches: string[],
  mergedPrBranches: string[],
): LaneSummary['pr_state'] {
  if (mergedPrBranches.includes(manifest.branch)) {
    return 'merged';
  }
  if (openPrBranches.includes(manifest.branch)) {
    return 'open';
  }
  return manifest.pr_url == null ? 'none' : 'linked';
}

function checkStateForLane(
  manifest: LaneManifest,
  checkStateByBranch: Record<string, string>,
  checkStateByIssue: Record<string, string>,
): LaneSummary['check_state'] {
  const raw = checkStateByIssue[manifest.issue_id] ?? checkStateByBranch[manifest.branch];
  const normalized = String(raw ?? '').toLowerCase();
  if (['success', 'succeeded', 'pass', 'passed', 'passing', 'green'].includes(normalized)) {
    return 'success';
  }
  if (['failure', 'failed', 'failing', 'error', 'cancelled', 'canceled', 'timed_out'].includes(normalized)) {
    return 'failure';
  }
  if (['pending', 'queued', 'in_progress', 'running', 'waiting'].includes(normalized)) {
    return 'pending';
  }
  return 'unknown';
}

function branchDriftForLane(
  manifest: LaneManifest,
  remoteBranches: string[],
  mergedPrBranches: string[],
): LaneSummary['branch_drift'] {
  if (mergedPrBranches.includes(manifest.branch)) {
    return 'merged_pr_active_manifest';
  }
  if (remoteBranches.length === 0) {
    return 'unknown';
  }
  return remoteBranches.includes(manifest.branch) ? 'remote_present' : 'remote_missing';
}

function conflictRiskForLane(
  manifest: LaneManifest,
  conditions: MergeRiskConditionLike[],
): LaneSummary['conflict_risk'] {
  const matching = conditions.filter((condition) => condition.lanes.includes(manifest.issue_id));
  if (matching.length === 0) {
    return 'clear';
  }
  return matching.sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity])[0].severity;
}

function isLaneMergeReady(input: {
  proofReady: boolean;
  conflictRisk: LaneSummary['conflict_risk'];
  prState: LaneSummary['pr_state'];
  checkState: LaneSummary['check_state'];
  branchDrift: LaneSummary['branch_drift'];
}): boolean {
  return input.proofReady
    && input.conflictRisk === 'clear'
    && (input.prState === 'open' || input.prState === 'linked')
    && input.checkState === 'success'
    && input.branchDrift !== 'remote_missing'
    && input.branchDrift !== 'merged_pr_active_manifest';
}

function recommendedActionForLane(input: {
  proofReady: boolean;
  conflictRisk: LaneSummary['conflict_risk'];
  prState: LaneSummary['pr_state'];
  checkState: LaneSummary['check_state'];
  branchDrift: LaneSummary['branch_drift'];
  mergeReady: boolean;
}): string {
  if (input.branchDrift === 'merged_pr_active_manifest') {
    return 'record merge evidence and close lane';
  }
  if (input.conflictRisk === 'hard_fail') {
    return 'resolve hard-fail merge risk';
  }
  if (input.conflictRisk === 'block') {
    return 'resolve blocking merge risk';
  }
  if (input.branchDrift === 'remote_missing') {
    return 'push branch before PR review';
  }
  if (input.prState === 'none') {
    return 'open PR';
  }
  if (!input.proofReady) {
    return 'complete proof artifacts';
  }
  if (input.checkState === 'failure') {
    return 'fix failing checks';
  }
  if (input.checkState === 'pending') {
    return 'wait for checks';
  }
  if (input.checkState === 'unknown') {
    return 'verify PR checks';
  }
  if (input.conflictRisk === 'warning') {
    return 'review merge warning';
  }
  return input.mergeReady ? 'ready to merge' : 'continue lane work';
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

function readLiveTelemetryInput(): Partial<Omit<MergeRiskBuilderInput, 'lanes'>> {
  const prTelemetry = readGitHubPrTelemetry();
  return {
    remoteBranches: readRemoteBranches(),
    openPrBranches: prTelemetry.openPrBranches,
    mergedPrBranches: prTelemetry.mergedPrBranches,
    checkStateByBranch: prTelemetry.checkStateByBranch,
  };
}

function readRemoteBranches(): string[] {
  const output = execFileText('git', [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/remotes/origin',
  ]);
  if (output == null) {
    return [];
  }

  return uniqueSorted(
    output
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry !== 'origin/HEAD')
      .map((entry) => entry.replace(/^origin\//, '')),
  );
}

function readGitHubPrTelemetry(): {
  openPrBranches: string[];
  mergedPrBranches: string[];
  checkStateByBranch: Record<string, string>;
} {
  const openPrs = readGhPrList('open');
  const mergedPrs = readGhPrList('merged');
  const checkStateByBranch: Record<string, string> = {};
  for (const pr of openPrs) {
    if (pr.headRefName == null) {
      continue;
    }
    checkStateByBranch[pr.headRefName] = summarizeStatusCheckRollup(pr.statusCheckRollup);
  }

  return {
    openPrBranches: uniqueSorted(openPrs.map((pr) => pr.headRefName).filter(isDefined)),
    mergedPrBranches: uniqueSorted(mergedPrs.map((pr) => pr.headRefName).filter(isDefined)),
    checkStateByBranch,
  };
}

function readGhPrList(state: 'open' | 'merged'): Array<{
  headRefName?: string;
  statusCheckRollup?: unknown[];
}> {
  const output = execFileText('gh', [
    'pr',
    'list',
    '--state',
    state,
    '--limit',
    state === 'open' ? '100' : '200',
    '--json',
    'headRefName,statusCheckRollup',
  ]);
  if (output == null) {
    return [];
  }

  try {
    const parsed = JSON.parse(output) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isObjectLike).map((entry) => ({
        headRefName: typeof entry.headRefName === 'string' ? entry.headRefName : undefined,
        statusCheckRollup: Array.isArray(entry.statusCheckRollup) ? entry.statusCheckRollup : undefined,
      }))
      : [];
  } catch {
    return [];
  }
}

function summarizeStatusCheckRollup(rollup: unknown[] | undefined): LaneSummary['check_state'] {
  if (rollup == null || rollup.length === 0) {
    return 'unknown';
  }

  let sawPending = false;
  for (const entry of rollup) {
    if (!isObjectLike(entry)) {
      continue;
    }
    const conclusion = typeof entry.conclusion === 'string' ? entry.conclusion.toLowerCase() : null;
    const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : null;
    if (conclusion != null && ['failure', 'failed', 'cancelled', 'canceled', 'timed_out', 'action_required'].includes(conclusion)) {
      return 'failure';
    }
    if (status != null && ['queued', 'in_progress', 'pending', 'waiting'].includes(status)) {
      sawPending = true;
    }
    if (conclusion == null && status == null) {
      sawPending = true;
    }
  }

  return sawPending ? 'pending' : 'success';
}

function execFileText(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
  } catch {
    return null;
  }
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function main(): void {
  emitJson(buildExecutionStateReport(readAllManifests(), {
    mergeRiskInput: readLiveTelemetryInput(),
  }));
}

const isDirectRun = process.argv[1] != null
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main();
}
