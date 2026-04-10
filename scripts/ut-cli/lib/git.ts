import path from 'node:path';

import micromatch from 'micromatch';

import { ToolError } from './result.js';
import type { ShellAdapter, ShellResult } from '../types.js';

function ensureOk(result: ShellResult, command: string): string {
  if (result.status !== 0) {
    throw new ToolError(result.stderr.trim() || result.stdout.trim() || `${command} failed`);
  }
  return result.stdout.trim();
}

export function git(shell: ShellAdapter, repoRoot: string, args: string[]): string {
  return ensureOk(shell.run('git', args, { cwd: repoRoot }), `git ${args.join(' ')}`);
}

export function gh(shell: ShellAdapter, repoRoot: string, args: string[]): string {
  return ensureOk(shell.run('gh', args, { cwd: repoRoot }), `gh ${args.join(' ')}`);
}

export function getCurrentBranch(shell: ShellAdapter, repoRoot: string): string {
  return git(shell, repoRoot, ['branch', '--show-current']);
}

export function fetchRemote(shell: ShellAdapter, repoRoot: string, remote: string): void {
  git(shell, repoRoot, ['fetch', remote]);
}

export function ensureLocalMainUpToDate(
  shell: ShellAdapter,
  repoRoot: string,
  remote: string,
  baseBranch: string,
): void {
  const local = git(shell, repoRoot, ['rev-parse', baseBranch]);
  const remoteHead = git(shell, repoRoot, ['rev-parse', `${remote}/${baseBranch}`]);
  if (local !== remoteHead) {
    throw new Error(`${baseBranch} is not up to date with ${remote}/${baseBranch}`);
  }
}

export function getHeadSha(shell: ShellAdapter, repoRoot: string): string {
  return git(shell, repoRoot, ['rev-parse', 'HEAD']);
}

export function createAndCheckoutBranch(
  shell: ShellAdapter,
  repoRoot: string,
  branchName: string,
  baseBranch: string,
): void {
  git(shell, repoRoot, ['checkout', '-b', branchName, baseBranch]);
}

export function listOpenPullRequests(
  shell: ShellAdapter,
  repoRoot: string,
): Array<{ number: number; headRefName: string }> {
  const output = gh(shell, repoRoot, ['pr', 'list', '--state', 'open', '--json', 'number,headRefName']);
  return JSON.parse(output) as Array<{ number: number; headRefName: string }>;
}

export function getPullRequestFiles(shell: ShellAdapter, repoRoot: string, prNumber: number): string[] {
  const output = gh(shell, repoRoot, ['pr', 'view', String(prNumber), '--json', 'files']);
  const parsed = JSON.parse(output) as { files?: Array<{ path: string }> };
  return (parsed.files ?? []).map((file) => normalizePath(file.path));
}

export function findCollidingPullRequests(
  shell: ShellAdapter,
  repoRoot: string,
  allowedFiles: string[],
  lifecycleSpineFiles: string[],
): Array<{ number: number; files: string[] }> {
  const matchers = [...allowedFiles, ...lifecycleSpineFiles];
  const pulls = listOpenPullRequests(shell, repoRoot);
  const collisions: Array<{ number: number; files: string[] }> = [];
  for (const pr of pulls) {
    const files = getPullRequestFiles(shell, repoRoot, pr.number);
    const matched = files.filter((file) => micromatch.isMatch(file, matchers, { dot: true }));
    if (matched.length > 0) {
      collisions.push({ number: pr.number, files: matched });
    }
  }
  return collisions;
}

export function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

export function getCommitSubjectsSince(
  shell: ShellAdapter,
  repoRoot: string,
  startingSha: string,
): Array<{ sha: string; subject: string; body: string }> {
  const output = git(shell, repoRoot, ['log', '--format=%H%x1f%s%x1f%b%x1e', `${startingSha}..HEAD`]);
  if (!output) {
    return [];
  }
  return output
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, body] = entry.split('\x1f');
      return {
        sha,
        subject,
        body: body ?? '',
      };
    });
}

export function ensureBranchPushedAndSynced(
  shell: ShellAdapter,
  repoRoot: string,
  branchName: string,
  remote: string,
): void {
  const local = git(shell, repoRoot, ['rev-parse', branchName]);
  const remoteResult = shell.run('git', ['rev-parse', `${remote}/${branchName}`], {
    cwd: repoRoot,
    allowNonZero: true,
  });
  if (remoteResult.status !== 0) {
    throw new Error(`branch ${branchName} is not pushed to ${remote}`);
  }
  const remoteSha = remoteResult.stdout.trim();
  if (local !== remoteSha) {
    throw new Error(`branch ${branchName} is not up to date with ${remote}/${branchName}`);
  }
}

export function existingPrForBranch(shell: ShellAdapter, repoRoot: string, branchName: string): boolean {
  const output = gh(shell, repoRoot, ['pr', 'list', '--head', branchName, '--json', 'number']);
  const parsed = JSON.parse(output) as Array<{ number: number }>;
  return parsed.length > 0;
}

export function createPullRequest(
  shell: ShellAdapter,
  repoRoot: string,
  args: string[],
): { number: number; url: string } {
  const output = gh(shell, repoRoot, args);
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const url = lines.find((line) => line.startsWith('http'));
  if (!url) {
    throw new ToolError('gh pr create did not return a PR URL');
  }
  const numberMatch = url.match(/\/pull\/(\d+)/);
  if (!numberMatch) {
    throw new ToolError('could not parse PR number from gh output');
  }
  return { number: Number(numberMatch[1]), url };
}

export function getMergedPullRequest(
  shell: ShellAdapter,
  repoRoot: string,
  prNumber: number,
): { state: string; mergeCommitSha: string | null } {
  const output = gh(shell, repoRoot, ['pr', 'view', String(prNumber), '--json', 'state,mergeCommit']);
  const parsed = JSON.parse(output) as { state: string; mergeCommit?: { oid?: string } | null };
  return {
    state: parsed.state,
    mergeCommitSha: parsed.mergeCommit?.oid ?? null,
  };
}
