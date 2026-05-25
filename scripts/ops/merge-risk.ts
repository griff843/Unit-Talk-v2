import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ACTIVE_LOCK_STATUSES, pathsOverlap, type LaneManifest } from './shared.js';
import { loadConcurrencyConfig } from './concurrency-config.js';

export interface MergeRiskCondition {
  code: string;
  severity: 'hard_fail' | 'block' | 'warning';
  lanes: string[];
  detail: string;
}

export interface MergeRiskReport {
  generated_at: string;
  total_active_lanes: number;
  conditions: MergeRiskCondition[];
  summary: {
    hard_fail: number;
    block: number;
    warning: number;
  };
}

interface PullRequestSummary {
  number: number;
  title?: string;
  headRefName: string;
  url?: string;
}

interface SharedModule {
  ROOT: string;
  emitJson: (value: unknown) => void;
  readAllManifests: () => LaneManifest[];
}

const STALE_HEARTBEAT_MS = 72 * 60 * 60 * 1000;
const TIER_C_EXACT_PATHS = new Set([
  'packages/db/src/lifecycle.ts',
  'packages/db/src/repositories.ts',
  'packages/db/src/runtime-repositories.ts',
  'packages/db/src/database.types.ts',
  'apps/api/src/distribution-service.ts',
  'apps/api/src/auth.ts',
]);
const TIER_C_PATH_PREFIXES = [
  'supabase/migrations/',
  'packages/contracts/src/',
  'packages/domain/src/',
  'apps/worker/',
];

function manifestStatus(manifest: LaneManifest): string {
  return String(manifest.status ?? '').toLowerCase();
}

function activeLanesOnly(lanes: LaneManifest[]): LaneManifest[] {
  return lanes.filter((lane) => ACTIVE_LOCK_STATUSES.has(lane.status));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function laneFiles(lane: LaneManifest): string[] {
  return Array.isArray(lane.file_scope_lock) ? lane.file_scope_lock : [];
}

function blockedByIds(lane: LaneManifest): string[] {
  return Array.isArray(lane.blocked_by) ? lane.blocked_by : [];
}

function touchesTierC(lane: LaneManifest): boolean {
  return laneFiles(lane).some((filePath) =>
    TIER_C_EXACT_PATHS.has(filePath) || TIER_C_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix)),
  );
}

function classifyExecutor(lane: LaneManifest): 'codex' | 'claude' | 'unknown' {
  const executor = String(lane.executor ?? '').toLowerCase();
  const laneType = String(lane.lane_type ?? '').toLowerCase();
  const createdBy = String(lane.created_by ?? '').toLowerCase();
  const branch = String(lane.branch ?? '').toLowerCase();

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

export function detectFileOverlap(lanes: LaneManifest[]): MergeRiskCondition[] {
  const activeLanes = activeLanesOnly(lanes);
  const conditions: MergeRiskCondition[] = [];

  for (let index = 0; index < activeLanes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < activeLanes.length; otherIndex += 1) {
      const left = activeLanes[index];
      const right = activeLanes[otherIndex];
      const overlap = uniqueSorted(
        laneFiles(left).filter((leftPath) => laneFiles(right).some((rightPath) => pathsOverlap(leftPath, rightPath))),
      );
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

export function detectBranchNoPr(
  lanes: LaneManifest[],
  remoteBranches: string[],
  openPrBranches: string[],
): MergeRiskCondition[] {
  const activeLanes = activeLanesOnly(lanes);
  const remoteSet = new Set(remoteBranches);
  const openSet = new Set(openPrBranches);

  return activeLanes
    .filter((lane) => remoteSet.has(lane.branch) && !openSet.has(lane.branch))
    .map((lane) => ({
      code: 'ACTIVE_BRANCH_NO_PR',
      severity: 'warning' as const,
      lanes: [lane.issue_id],
      detail: `Branch "${lane.branch}" exists on origin but has no open PR`,
    }));
}

export function detectPrNoLane(
  lanes: LaneManifest[],
  openPrBranches: string[],
): MergeRiskCondition[] {
  const activeBranches = new Set(activeLanesOnly(lanes).map((lane) => lane.branch));

  return uniqueSorted(openPrBranches)
    .filter((branch) => !activeBranches.has(branch))
    .map((branch) => ({
      code: 'PR_NO_ACTIVE_LANE',
      severity: 'warning' as const,
      lanes: [],
      detail: `Open PR branch "${branch}" has no matching active lane manifest`,
    }));
}

export function detectMergedPrActiveLane(
  lanes: LaneManifest[],
  mergedPrBranches: string[],
): MergeRiskCondition[] {
  const activeLanes = activeLanesOnly(lanes);
  const mergedSet = new Set(mergedPrBranches);

  return activeLanes
    .filter((lane) => mergedSet.has(lane.branch))
    .map((lane) => ({
      code: 'MERGED_PR_ACTIVE_LANE',
      severity: 'hard_fail' as const,
      lanes: [lane.issue_id],
      detail: `Branch "${lane.branch}" already has a merged PR but lane remains ${manifestStatus(lane)}`,
    }));
}

export function detectBlockedDeps(lanes: LaneManifest[]): MergeRiskCondition[] {
  const activeLanes = activeLanesOnly(lanes);
  const activeIds = new Set(activeLanes.map((lane) => lane.issue_id));
  const conditions: MergeRiskCondition[] = [];

  for (const lane of activeLanes) {
    const unresolved = uniqueSorted(
      blockedByIds(lane).filter((issueId) => activeIds.has(issueId)),
    );
    if (unresolved.length === 0) {
      continue;
    }

    conditions.push({
      code: 'BLOCKED_DEP_NOT_DONE',
      severity: 'block',
      lanes: [lane.issue_id, ...unresolved],
      detail: `Lane is blocked by active unresolved dependencies: ${unresolved.join(', ')}`,
    });
  }

  return conditions;
}

export function detectStaleHeartbeat(
  lanes: LaneManifest[],
  nowMs = Date.now(),
): MergeRiskCondition[] {
  const activeLanes = activeLanesOnly(lanes);
  const conditions: MergeRiskCondition[] = [];

  for (const lane of activeLanes) {
    const heartbeatMs = Date.parse(String(lane.heartbeat_at ?? ''));
    if (Number.isNaN(heartbeatMs)) {
      continue;
    }

    const ageMs = nowMs - heartbeatMs;
    if (ageMs <= STALE_HEARTBEAT_MS) {
      continue;
    }

    const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
    conditions.push({
      code: 'STALE_LANE_HEARTBEAT',
      severity: 'warning',
      lanes: [lane.issue_id],
      detail: `heartbeat_at is ${ageHours}h old for branch "${lane.branch}"`,
    });
  }

  return conditions;
}

export function detectDispatchSaturation(lanes: LaneManifest[]): MergeRiskCondition[] {
  const cfg = (() => { try { return loadConcurrencyConfig(); } catch { return null; } })();
  const maxClaude = cfg?.executors.claude ?? 2;
  const maxCodex = cfg?.executors.codex ?? 4;

  const activeLanes = activeLanesOnly(lanes);
  const codexLanes = activeLanes.filter((lane) => classifyExecutor(lane) === 'codex');
  const claudeLanes = activeLanes.filter((lane) => classifyExecutor(lane) === 'claude');
  const saturated = codexLanes.length >= maxCodex || claudeLanes.length >= maxClaude;

  if (!saturated) {
    return [];
  }

  const detailParts: string[] = [];
  if (codexLanes.length >= maxCodex) {
    detailParts.push(`codex active lanes=${codexLanes.length} (max ${maxCodex} — slot full)`);
  }
  if (claudeLanes.length >= maxClaude) {
    detailParts.push(`claude active lanes=${claudeLanes.length} (max ${maxClaude} — slot full)`);
  }

  return [
    {
      code: 'DISPATCH_LIMIT_SATURATION',
      severity: 'block',
      lanes: [...codexLanes, ...claudeLanes].map((lane) => lane.issue_id),
      detail: detailParts.join('; '),
    },
  ];
}

export function detectTierCConflict(lanes: LaneManifest[]): MergeRiskCondition[] {
  const activeTierCLanes = activeLanesOnly(lanes).filter((lane) => touchesTierC(lane));
  const conditions: MergeRiskCondition[] = [];

  for (let index = 0; index < activeTierCLanes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < activeTierCLanes.length; otherIndex += 1) {
      const left = activeTierCLanes[index];
      const right = activeTierCLanes[otherIndex];
      const leftTierC = laneFiles(left).filter((filePath) =>
        TIER_C_EXACT_PATHS.has(filePath) || TIER_C_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix)),
      );
      const rightTierC = laneFiles(right).filter((filePath) =>
        TIER_C_EXACT_PATHS.has(filePath) || TIER_C_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix)),
      );

      conditions.push({
        code: 'TIER_C_CONFLICT',
        severity: 'hard_fail',
        lanes: [left.issue_id, right.issue_id],
        detail: `Both active lanes touch Tier C paths (${uniqueSorted([...leftTierC, ...rightTierC]).join(', ')})`,
      });
    }
  }

  return conditions;
}

export function buildMergeRiskReport(input: {
  lanes: LaneManifest[];
  remoteBranches: string[];
  openPrBranches: string[];
  mergedPrBranches: string[];
  nowMs?: number;
  generatedAt?: string;
}): MergeRiskReport {
  const conditions = [
    ...detectFileOverlap(input.lanes),
    ...detectBranchNoPr(input.lanes, input.remoteBranches, input.openPrBranches),
    ...detectPrNoLane(input.lanes, input.openPrBranches),
    ...detectMergedPrActiveLane(input.lanes, input.mergedPrBranches),
    ...detectBlockedDeps(input.lanes),
    ...detectTierCConflict(input.lanes),
    ...detectStaleHeartbeat(input.lanes, input.nowMs),
    ...detectDispatchSaturation(input.lanes),
  ];

  return {
    generated_at: input.generatedAt ?? new Date(input.nowMs ?? Date.now()).toISOString(),
    total_active_lanes: activeLanesOnly(input.lanes).length,
    conditions,
    summary: {
      hard_fail: conditions.filter((condition) => condition.severity === 'hard_fail').length,
      block: conditions.filter((condition) => condition.severity === 'block').length,
      warning: conditions.filter((condition) => condition.severity === 'warning').length,
    },
  };
}

function runCommand(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error((result.stderr ?? '').trim() || `Command failed: ${command} ${args.join(' ')}`);
  }

  return (result.stdout ?? '').trim();
}

function queryPullRequests(
  root: string,
  state: 'open' | 'merged',
  fields: string,
  limit?: number,
): PullRequestSummary[] {
  const args = ['pr', 'list', '--state', state, '--json', fields];
  if (limit != null) {
    args.push('--limit', String(limit));
  }

  const stdout = runCommand('gh', args, root);
  const parsed = JSON.parse(stdout) as PullRequestSummary[];
  return Array.isArray(parsed) ? parsed : [];
}

function queryRemoteBranches(root: string): string[] {
  const stdout = runCommand('git', ['ls-remote', '--heads', 'origin'], root);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[1] ?? '')
    .filter((ref) => ref.startsWith('refs/heads/'))
    .map((ref) => ref.slice('refs/heads/'.length));
}

async function main(): Promise<void> {
  const shared = (await import('./shared.js')) as SharedModule;
  const args = new Set(process.argv.slice(2));
  if (args.has('--help')) {
    process.stdout.write('Usage: npx tsx scripts/ops/merge-risk.ts [--json]\n');
    process.exitCode = 0;
    return;
  }

  const lanes = activeLanesOnly(shared.readAllManifests());
  const openPrs = queryPullRequests(shared.ROOT, 'open', 'number,title,headRefName,url');
  const mergedPrs = queryPullRequests(shared.ROOT, 'merged', 'number,headRefName', 50);
  const remoteBranches = queryRemoteBranches(shared.ROOT);

  const report = buildMergeRiskReport({
    lanes,
    remoteBranches,
    openPrBranches: openPrs.map((pr) => pr.headRefName),
    mergedPrBranches: mergedPrs.map((pr) => pr.headRefName),
  });

  shared.emitJson(report);
  process.exitCode = report.summary.hard_fail > 0 ? 1 : 0;
}

const isDirectRun = process.argv[1] != null
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  void main().catch((error: unknown) => {
    console.error('[merge-risk] fatal:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
