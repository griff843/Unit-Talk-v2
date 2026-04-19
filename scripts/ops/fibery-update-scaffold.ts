import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { emitJson, getFlag, parseArgs } from './shared.js';
import { extractIssueIds } from './branch-discipline-guard.js';

type FiberyIssueUpdatePayload = {
  issue_id: string;
  source: 'git_commit_messages';
  commit_count: number;
  commits: Array<{
    sha: string;
    subject: string;
  }>;
  fibery: {
    operation: 'update_issue_from_commit_activity';
    entity_lookup: {
      field: 'Public Id';
      value: string;
    };
    fields: {
      last_commit_subject: string;
      last_commit_sha: string;
      referenced_commit_count: number;
    };
  };
};

type CommitInfo = {
  sha: string;
  subject: string;
};

export function buildFiberyPayloads(commits: CommitInfo[]): FiberyIssueUpdatePayload[] {
  const byIssue = new Map<string, CommitInfo[]>();
  for (const commit of commits) {
    for (const issueId of extractIssueIds(commit.subject)) {
      const entries = byIssue.get(issueId) ?? [];
      entries.push(commit);
      byIssue.set(issueId, entries);
    }
  }

  return [...byIssue.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([issueId, issueCommits]) => {
      const latest = issueCommits[0] ?? { sha: '', subject: '' };
      return {
        issue_id: issueId,
        source: 'git_commit_messages',
        commit_count: issueCommits.length,
        commits: issueCommits,
        fibery: {
          operation: 'update_issue_from_commit_activity',
          entity_lookup: {
            field: 'Public Id',
            value: issueId,
          },
          fields: {
            last_commit_subject: latest.subject,
            last_commit_sha: latest.sha,
            referenced_commit_count: issueCommits.length,
          },
        },
      };
    });
}

function readCommits(revRange: string): CommitInfo[] {
  const result = spawnSync('git', ['log', '--format=%H%x00%s', revRange], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(`git log failed: ${result.stderr.trim() || result.status}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha = '', subject = ''] = line.split('\0');
      return { sha, subject };
    });
}

export function main(argv = process.argv.slice(2)): number {
  const { flags } = parseArgs(argv);
  const revRange = getFlag(flags, 'range') ?? 'main..HEAD';
  const commits = readCommits(revRange);
  const payloads = buildFiberyPayloads(commits);
  emitJson({
    scaffold: true,
    integration_status: 'not_implemented',
    note: 'Payload shape only. No Fibery API request is sent.',
    rev_range: revRange,
    payloads,
  });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
