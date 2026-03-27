import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptDir, '..');
export const defaultQueuePath = path.join(
  projectRoot,
  'docs',
  '06_status',
  'ISSUE_QUEUE.md',
);
export const defaultPrTemplatePath = path.join(
  projectRoot,
  '.github',
  'pull_request_template.md',
);

const issueHeaderPattern = /^### (UTV2-\d+) .+$/gm;

export function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

export function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

export function parseQueue(markdown) {
  const matches = [...markdown.matchAll(issueHeaderPattern)];
  return matches.map((match, index) => {
    const headingLine = match[0];
    const id = match[1];
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(start, end).trimEnd();
    const tier = readIssueField(block, 'Tier');
    const heading = headingLine
      .replace(/^###\s+/, '')
      .replace(new RegExp(`^${escapeRegExp(id)}\\s+[—â€”-]\\s+`), '')
      .trim();

    return {
      id,
      heading,
      title: normalizeIssueTitle(heading, tier),
      tier,
      lane: stripBackticks(readIssueField(block, 'Lane')),
      status: normalizeStatus(readIssueField(block, 'Status')),
      blockedBy: readIssueField(block, 'Blocked by'),
      unlocks: readIssueField(block, 'Unlocks'),
      branch: stripBackticks(readIssueField(block, 'Branch')),
      pr: readIssueField(block, 'PR'),
      block,
      start,
      end,
    };
  });
}

export function readIssueField(block, fieldName) {
  const escaped = escapeRegExp(fieldName);
  const match = block.match(new RegExp(`\\| \\*\\*${escaped}\\*\\* \\|([^\\n]+)`, 'm'));
  if (!match) {
    throw new Error(`Unable to read field "${fieldName}" from issue block`);
  }
  return match[1].replace(/\|\s*$/, '').trim();
}

export function updateIssueField(markdown, issueId, fieldName, value) {
  return replaceIssueBlock(markdown, issueId, (block) => {
    const escaped = escapeRegExp(fieldName);
    const fieldPattern = new RegExp(
      `(\\| \\*\\*${escaped}\\*\\* \\| )([^\\n]+?)( \\|)`,
      'm',
    );

    if (!fieldPattern.test(block)) {
      throw new Error(`Unable to update field "${fieldName}" for ${issueId}`);
    }

    return block.replace(fieldPattern, `$1${value}$3`);
  });
}

export function replaceIssueBlock(markdown, issueId, updater) {
  const issues = parseQueue(markdown);
  const issue = issues.find((candidate) => candidate.id === issueId);
  if (!issue) {
    throw new Error(`Issue not found in queue: ${issueId}`);
  }

  const updatedBlock = updater(issue.block);
  return `${markdown.slice(0, issue.start)}${updatedBlock}${markdown.slice(issue.end)}`;
}

export function updateQueueHealth(markdown) {
  const issues = parseQueue(markdown);
  const lanes = ['lane:codex', 'lane:claude', 'lane:augment'];
  const statuses = ['IN_PROGRESS', 'IN_REVIEW', 'READY', 'BLOCKED', 'DONE'];

  const rows = lanes.map((lane) => {
    const issuesInLane = issues.filter((issue) => issue.lane === lane);
    const counts = Object.fromEntries(
      statuses.map((status) => [
        status,
        issuesInLane.filter((issue) => issue.status === status).length,
      ]),
    );
    return `| \`${lane}\` | ${counts.IN_PROGRESS} | ${counts.IN_REVIEW} | ${counts.READY} | ${counts.BLOCKED} | ${counts.DONE} |`;
  });

  const replacement = [
    '## Queue Health',
    '',
    '| Lane | IN_PROGRESS | IN_REVIEW | READY | BLOCKED | DONE |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    '---',
  ].join('\n');

  return markdown.replace(
    /## Queue Health[\s\S]*?---\n\n## Active Issues/,
    `${replacement}\n\n## Active Issues`,
  );
}

export function updateQueueStateReference(markdown, issueId, replacementLine) {
  const pattern = new RegExp(`^${escapeRegExp(issueId)}.*$`, 'm');
  if (!pattern.test(markdown)) {
    throw new Error(`Unable to update queue state reference for ${issueId}`);
  }
  return markdown.replace(pattern, replacementLine);
}

export function parseBlockedIssueIds(value) {
  return [...value.matchAll(/UTV2-\d+/g)].map((match) => match[0]);
}

export function slugifyIssueTitle(title) {
  return title
    .replace(/\([^)]*\)/g, ' ')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

export function deriveBranchName(issue) {
  const lane = issue.lane.replace('lane:', '');
  return `${lane}/${issue.id}-${slugifyIssueTitle(issue.title)}`;
}

export function normalizeIssueTitle(heading, tier) {
  const prefix = `${tier} `;
  return heading.startsWith(prefix) ? heading.slice(prefix.length).trim() : heading.trim();
}

export function normalizeStatus(value) {
  return value.replace(/\*\*/g, '').trim();
}

export function stripBackticks(value) {
  return value.replace(/^`|`$/g, '').replace(/\|\s*$/, '').trim();
}

export function formatIssueForStateReference(issue, note) {
  const lane = issue.lane.replace('lane:', '');
  return `${issue.id}  ${issue.tier.padEnd(3)} ${lane.padEnd(8)} ${issue.status.padEnd(11)} â† ${note}`;
}

export function ensureDependenciesDone(issues, issue) {
  const dependencyIds = parseBlockedIssueIds(issue.blockedBy);
  const unfinished = dependencyIds.filter((dependencyId) => {
    const dependency = issues.find((candidate) => candidate.id === dependencyId);
    return !dependency || dependency.status !== 'DONE';
  });

  if (unfinished.length > 0) {
    throw new Error(
      `${issue.id} cannot be claimed because dependencies are not DONE: ${unfinished.join(', ')}`,
    );
  }
}

export function requireCurrentBranch(expectedBranch) {
  const currentBranch = runAndRead('git', ['branch', '--show-current']);
  if (currentBranch !== expectedBranch) {
    throw new Error(`Expected current git branch to be ${expectedBranch}; found ${currentBranch}`);
  }
}

export function ensureCleanWorktree() {
  const status = runAndRead('git', ['status', '--short']);
  if (status.trim().length > 0) {
    throw new Error('Working tree must be clean before claiming an issue');
  }
}

export function createBranch(branchName) {
  runCommand('git', ['checkout', '-b', branchName]);
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const message = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(message || `${command} ${args.join(' ')} failed with exit ${result.status}`);
  }

  return result;
}

export function runAndRead(command, args, options = {}) {
  return runCommand(command, args, options).stdout.trim();
}

export function buildDefaultPrTitle(issue) {
  return `[${issue.tier}] ${issue.title} (${issue.id})`;
}

export function buildDefaultPrBody(issue) {
  return [
    '## Summary',
    '',
    '- ',
    '',
    '## Linked Issue',
    '',
    `- ${issue.id}`,
    '',
    '## Contracts Touched',
    '',
    '- `docs/05_operations/QUEUE_ORCHESTRATION_DESIGN.md`',
    '',
    '## Risks',
    '',
    '- ',
    '',
    '## Verification',
    '',
    '- [ ] `pnpm verify`',
  ].join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
