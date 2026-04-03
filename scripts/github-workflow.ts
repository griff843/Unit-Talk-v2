import { spawnSync } from 'node:child_process';

type GitHubPrSummary = {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  reviewDecision?: string | null;
  mergeStateStatus?: string | null;
  headRefName: string;
  baseRefName: string;
  statusCheckRollup?: Array<{
    __typename: string;
    conclusion?: string | null;
    status?: string | null;
    name?: string | null;
    context?: string | null;
    workflowName?: string | null;
  }> | null;
};

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  printUsage();
  process.exit(1);
}

try {
  switch (command) {
    case 'current':
      printSummary(resolveSelector(), { tolerateMissingCurrent: true });
      break;
    case 'summary':
      printSummary(resolveSelector(1));
      break;
    case 'checks':
      printChecks(resolveSelector(1));
      break;
    default:
      printUsage();
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function printSummary(
  selector?: string,
  options: { tolerateMissingCurrent?: boolean } = {},
): void {
  const pr = readPullRequest(selector, options);
  if (!pr) {
    console.log('(no pull request for current branch)');
    return;
  }

  const checks = summarizeChecks(pr.statusCheckRollup ?? []);

  console.log(`PR #${pr.number} | ${pr.state}${pr.isDraft ? ' | draft' : ''}`);
  console.log(`${pr.title}`);
  console.log(`${pr.headRefName} -> ${pr.baseRefName}`);
  console.log(`${pr.url}`);
  console.log(
    `review=${pr.reviewDecision ?? 'NONE'} | merge=${pr.mergeStateStatus ?? 'UNKNOWN'} | checks=${checks.passed}/${checks.total} passed`,
  );

  if (checks.failed.length > 0) {
    console.log(`failed: ${checks.failed.join(', ')}`);
  }
  if (checks.pending.length > 0) {
    console.log(`pending: ${checks.pending.join(', ')}`);
  }
}

function printChecks(selector?: string): void {
  const pr = readPullRequest(selector, { tolerateMissingCurrent: true });
  if (!pr) {
    console.log('(no pull request for current branch)');
    return;
  }

  const rollup = pr.statusCheckRollup ?? [];

  if (rollup.length === 0) {
    console.log('(no checks found)');
    return;
  }

  for (const check of rollup) {
    const name = check.name ?? check.context ?? check.workflowName ?? check.__typename;
    const state = check.conclusion ?? check.status ?? 'UNKNOWN';
    console.log(`${name} | ${state}`);
  }
}

function readPullRequest(
  selector?: string,
  options: { tolerateMissingCurrent?: boolean } = {},
): GitHubPrSummary | null {
  const json = runGh(
    [
      'pr',
      'view',
      ...(selector ? [selector] : []),
      '--json',
      'number,title,url,state,isDraft,reviewDecision,mergeStateStatus,headRefName,baseRefName,statusCheckRollup',
    ],
    options,
  );

  if (!json) {
    return null;
  }

  return JSON.parse(json) as GitHubPrSummary;
}

function runGh(command: string[], options: { tolerateMissingCurrent?: boolean } = {}): string | null {
  const result = spawnSync('gh', command, {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const message = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (options.tolerateMissingCurrent && message.includes('no pull requests found for branch')) {
      return null;
    }
    throw new Error(message || `gh ${command.join(' ')} failed`);
  }

  return result.stdout.trim();
}

function resolveSelector(index = 0): string | undefined {
  const candidate = args[index + 1];
  return candidate && !candidate.startsWith('--') ? candidate : undefined;
}

function summarizeChecks(checks: NonNullable<GitHubPrSummary['statusCheckRollup']>) {
  const normalized = checks.map((check) => {
    const name = check.name ?? check.context ?? check.workflowName ?? check.__typename;
    const state = (check.conclusion ?? check.status ?? 'UNKNOWN').toUpperCase();
    return { name, state };
  });

  return {
    total: normalized.length,
    passed: normalized.filter((check) => check.state === 'SUCCESS').length,
    failed: normalized
      .filter((check) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(check.state))
      .map((check) => check.name),
    pending: normalized
      .filter((check) => ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED', 'REQUESTED', 'WAITING'].includes(check.state))
      .map((check) => check.name),
  };
}

function printUsage(): void {
  console.log(`Usage:
  tsx scripts/github-workflow.ts current
  tsx scripts/github-workflow.ts summary [pr-number-or-url]
  tsx scripts/github-workflow.ts checks [pr-number-or-url]`);
}
