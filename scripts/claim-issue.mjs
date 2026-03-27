import {
  createBranch,
  defaultQueuePath,
  deriveBranchName,
  ensureCleanWorktree,
  ensureDependenciesDone,
  formatIssueForStateReference,
  parseQueue,
  readText,
  requireCurrentBranch,
  updateIssueField,
  updateQueueHealth,
  updateQueueStateReference,
  writeText,
} from './queue-lib.mjs';

const args = process.argv.slice(2);
const issueId = args.find((arg) => !arg.startsWith('--'));
const laneFlagIndex = args.indexOf('--lane');
const queueFlagIndex = args.indexOf('--queue-file');
const dryRun = args.includes('--dry-run');

if (!issueId) {
  throw new Error(
    'Usage: node scripts/claim-issue.mjs <issue-id> [--lane codex] [--queue-file path] [--dry-run]',
  );
}

const expectedLane = laneFlagIndex >= 0 ? args[laneFlagIndex + 1] : null;
const queuePath = queueFlagIndex >= 0 ? args[queueFlagIndex + 1] : defaultQueuePath;
const markdown = readText(queuePath);
const issues = parseQueue(markdown);
const issue = issues.find((candidate) => candidate.id === issueId);

if (!issue) {
  throw new Error(`Issue not found: ${issueId}`);
}

if (expectedLane && issue.lane !== `lane:${expectedLane}`) {
  throw new Error(`${issueId} belongs to ${issue.lane}, not lane:${expectedLane}`);
}

if (issue.status !== 'READY') {
  throw new Error(`${issueId} must be READY to claim; found ${issue.status}`);
}

ensureDependenciesDone(issues, issue);

const branchName = deriveBranchName(issue);

if (!dryRun) {
  requireCurrentBranch('main');
  ensureCleanWorktree();
}

let updated = updateIssueField(markdown, issueId, 'Status', '**IN_PROGRESS**');
updated = updateIssueField(updated, issueId, 'Branch', `\`${branchName}\``);
updated = updateQueueHealth(updated);
updated = updateQueueStateReference(
  updated,
  issueId,
  formatIssueForStateReference(
    { ...issue, status: 'IN_PROGRESS', lane: issue.lane, tier: issue.tier },
    `branch created: \`${branchName}\``,
  ),
);

if (dryRun) {
  console.log(`[dry-run] would write ${queuePath}`);
  console.log(`[dry-run] would create branch ${branchName}`);
  console.log(branchName);
  process.exit(0);
}

writeText(queuePath, updated);
createBranch(branchName);
console.log(branchName);
