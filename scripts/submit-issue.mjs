import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildDefaultPrBody,
  buildDefaultPrTitle,
  defaultPrTemplatePath,
  defaultQueuePath,
  formatIssueForStateReference,
  parseQueue,
  readText,
  runAndRead,
  updateIssueField,
  updateQueueHealth,
  updateQueueStateReference,
  writeText,
} from './queue-lib.mjs';

const args = process.argv.slice(2);
const issueId = args.find((arg) => !arg.startsWith('--'));
const bodyFlagIndex = args.indexOf('--body-file');
const titleFlagIndex = args.indexOf('--title');
const queueFlagIndex = args.indexOf('--queue-file');
const dryRun = args.includes('--dry-run');

if (!issueId) {
  throw new Error(
    'Usage: node scripts/submit-issue.mjs <issue-id> [--title "..."] [--body-file path] [--queue-file path] [--dry-run]',
  );
}

const queuePath = queueFlagIndex >= 0 ? args[queueFlagIndex + 1] : defaultQueuePath;
const markdown = readText(queuePath);
const issues = parseQueue(markdown);
const issue = issues.find((candidate) => candidate.id === issueId);

if (!issue) {
  throw new Error(`Issue not found: ${issueId}`);
}

if (issue.status !== 'IN_PROGRESS') {
  throw new Error(`${issueId} must be IN_PROGRESS to submit; found ${issue.status}`);
}

const currentBranch = runAndRead('git', ['branch', '--show-current']);
if (issue.branch && issue.branch !== 'â€”' && issue.branch !== '—' && issue.branch !== currentBranch) {
  throw new Error(
    `${issueId} is assigned to branch ${issue.branch}; current branch is ${currentBranch}`,
  );
}

const prTitle = titleFlagIndex >= 0 ? args[titleFlagIndex + 1] : buildDefaultPrTitle(issue);
const providedBodyFile = bodyFlagIndex >= 0 ? args[bodyFlagIndex + 1] : null;
const bodyContents = providedBodyFile
  ? readText(path.resolve(providedBodyFile))
  : fs.existsSync(defaultPrTemplatePath)
    ? readText(defaultPrTemplatePath)
    : buildDefaultPrBody(issue);

const tempBodyFile = path.join(
  os.tmpdir(),
  `unit-talk-pr-body-${issueId}-${Date.now()}.md`,
);
fs.writeFileSync(tempBodyFile, bodyContents, 'utf8');

let prUrl = null;
try {
  if (dryRun) {
    console.log(`[dry-run] would create PR for ${issueId}`);
  } else {
    prUrl = runAndRead('gh', ['pr', 'create', '--title', prTitle, '--body-file', tempBodyFile]);
  }
} finally {
  fs.unlinkSync(tempBodyFile);
}

const prNumber = prUrl ? extractPrNumber(prUrl) : 0;

let updated = updateIssueField(markdown, issueId, 'Status', '**IN_REVIEW**');
updated = updateIssueField(updated, issueId, 'PR', dryRun ? '#0 (dry-run)' : `#${prNumber}`);
updated = updateQueueHealth(updated);
updated = updateQueueStateReference(
  updated,
  issueId,
  formatIssueForStateReference(
    { ...issue, status: 'IN_REVIEW', lane: issue.lane, tier: issue.tier },
    dryRun ? 'PR would be opened by submit-issue.mjs' : `PR #${prNumber} opened`,
  ),
);

if (!dryRun) {
  writeText(queuePath, updated);
}

const nextReady = parseQueue(updated).find(
  (candidate) => candidate.lane === issue.lane && candidate.status === 'READY',
);

if (dryRun) {
  console.log(`[dry-run] queue would move ${issueId} to IN_REVIEW`);
}

if (prUrl) {
  console.log(prUrl);
}

if (nextReady) {
  console.log(`next-ready: ${nextReady.id} ${nextReady.title}`);
} else {
  console.log('next-ready: none');
}

function extractPrNumber(url) {
  const match = url.match(/\/pull\/(\d+)$/);
  if (!match) {
    throw new Error(`Unable to parse PR number from gh output: ${url}`);
  }
  return Number.parseInt(match[1], 10);
}
