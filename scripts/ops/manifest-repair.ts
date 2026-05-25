import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ROOT,
  emitJson,
  getFlag,
  issueToManifestPath,
  manifestExists,
  parseArgs,
  relativeToRoot,
  requireIssueId,
} from './shared.js';

interface ManifestRepairPlan {
  schema_version: 1;
  issue_id: string;
  mode: 'dry_run';
  verdict: 'REPAIR_REQUIRED' | 'NOOP';
  manifest_path: string;
  reconstruction_sources: string[];
  required_inputs: string[];
  commands: string[];
}

function runGh(args: string[]): string {
  const result = spawnSync('gh', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr ?? '').trim() || `Command failed: gh ${args.join(' ')}`);
  }
  return (result.stdout ?? '').trim();
}

function prSource(prNumber: string | undefined): string[] {
  if (!prNumber) {
    return [];
  }
  const output = runGh([
    'pr',
    'view',
    prNumber,
    '--json',
    'number,url,headRefName,headRefOid,baseRefName,title,state,isDraft',
  ]);
  return [`github_pr:${output}`];
}

export function buildManifestRepairPlan(argv = process.argv.slice(2)): ManifestRepairPlan {
  const parsed = parseArgs(argv);
  const issueId = requireIssueId(getFlag(parsed.flags, 'issue') ?? '');
  const dryRun = parsed.bools.has('dry-run');
  if (!dryRun) {
    throw new Error('manifest repair is validator-first: rerun with --dry-run; no silent manifest writes are supported');
  }

  const manifestPath = issueToManifestPath(issueId);
  if (manifestExists(issueId)) {
    return {
      schema_version: 1,
      issue_id: issueId,
      mode: 'dry_run',
      verdict: 'NOOP',
      manifest_path: relativeToRoot(manifestPath),
      reconstruction_sources: [`lane_manifest:${relativeToRoot(manifestPath)}`],
      required_inputs: [],
      commands: [],
    };
  }

  const fromPr = getFlag(parsed.flags, 'from-pr');
  const sources = [
    ...prSource(fromPr),
    `expected_manifest:${relativeToRoot(manifestPath)}`,
  ];

  return {
    schema_version: 1,
    issue_id: issueId,
    mode: 'dry_run',
    verdict: 'REPAIR_REQUIRED',
    manifest_path: relativeToRoot(manifestPath),
    reconstruction_sources: sources,
    required_inputs: [
      'authoritative Linear tier',
      'executor and lane_type',
      'file_scope_lock',
      'preflight_token',
      'expected_proof_paths',
      'worktree_path or main-control justification',
    ],
    commands: [
      `pnpm ops:lane-manifest create --issue ${issueId} --tier <T1|T2|T3> --branch <branch> --preflight-token <path> --files <path>`,
      `pnpm ops:lane-link-pr --issue ${issueId} --pr ${fromPr ?? '<pr-number>'}`,
      `pnpm ops:orchestration-reconcile --issue ${issueId} --json`,
    ],
  };
}

function main(argv = process.argv.slice(2)): void {
  const parsed = parseArgs(argv);
  const json = parsed.bools.has('json');
  const plan = buildManifestRepairPlan(argv);
  if (json) {
    emitJson(plan);
    return;
  }
  console.log(`[ops:manifest-repair] ${plan.issue_id} ${plan.verdict}`);
  for (const input of plan.required_inputs) {
    console.log(`  required: ${input}`);
  }
  for (const command of plan.commands) {
    console.log(`  command: ${command}`);
  }
}

const isDirectRun = process.argv[1] != null
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error('[manifest-repair] fatal:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
