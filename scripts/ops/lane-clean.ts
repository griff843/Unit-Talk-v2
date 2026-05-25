import { fileURLToPath } from 'node:url';
import {
  emitJson,
  getFlag,
  parseArgs,
  requireIssueId,
} from './shared.js';
import {
  buildOrchestrationReconcilerReport,
  gitBranches,
  type BranchSnapshot,
  type LinearIssueSnapshot,
  type PullRequestSnapshot,
} from './orchestration-reconciler.js';
import { readAllLeases } from './lease-registry.js';
import { readAllManifests } from './shared.js';

interface LaneCleanPlan {
  schema_version: 1;
  issue_id: string;
  mode: 'dry_run';
  verdict: 'CLEANUP_READY' | 'BLOCKED' | 'NOOP';
  actions: Array<{
    command: string | null;
    reason: string;
    safe_to_apply: boolean;
  }>;
}

export function buildLaneCleanPlan(
  issueIdInput: string,
  surfaces: {
    linearIssues?: LinearIssueSnapshot[];
    branches?: BranchSnapshot[];
    pullRequests?: PullRequestSnapshot[];
  } = {},
): LaneCleanPlan {
  const issueId = requireIssueId(issueIdInput);
  const report = buildOrchestrationReconcilerReport({
    linearIssues: surfaces.linearIssues ?? [],
    leases: readAllLeases(),
    manifests: readAllManifests(),
    branches: surfaces.branches ?? gitBranches(),
    pullRequests: surfaces.pullRequests ?? [],
    issueId,
  });
  const actions = report.cleanup_plan.actions
    .filter((action) => action.issue_id === issueId)
    .map((action) => ({
      command: action.command,
      reason: action.reason,
      safe_to_apply: action.safe_to_apply,
    }));
  const blocked = report.state_machine.lanes.some((lane) => lane.issue_id === issueId && lane.fail_closed);
  return {
    schema_version: 1,
    issue_id: issueId,
    mode: 'dry_run',
    verdict: blocked ? 'BLOCKED' : actions.some((action) => action.safe_to_apply) ? 'CLEANUP_READY' : 'NOOP',
    actions,
  };
}

function main(argv = process.argv.slice(2)): void {
  const parsed = parseArgs(argv);
  const issueId = getFlag(parsed.flags, 'issue');
  if (!issueId) {
    throw new Error('Missing --issue UTV2-####');
  }
  if (!parsed.bools.has('dry-run')) {
    throw new Error('lane cleanup is validator-first: rerun with --dry-run; no branch/worktree deletion is automated here');
  }
  const json = parsed.bools.has('json');
  const plan = buildLaneCleanPlan(issueId);
  if (json) {
    emitJson(plan);
    return;
  }
  console.log(`[ops:lane-clean] ${plan.issue_id} ${plan.verdict}`);
  for (const action of plan.actions) {
    console.log(`  [${action.safe_to_apply ? 'SAFE' : 'BLOCKED'}] ${action.reason}`);
    if (action.command) {
      console.log(`    command: ${action.command}`);
    }
  }
}

const isDirectRun = process.argv[1] != null
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error('[lane-clean] fatal:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
