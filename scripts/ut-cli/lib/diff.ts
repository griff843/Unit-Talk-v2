import path from 'node:path';

import { git, normalizePath } from './git.js';
import type { ShellAdapter } from '../types.js';

function parseLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
}

export interface DiffSummary {
  committed: string[];
  staged: string[];
  unstaged: string[];
  untracked: string[];
  all: string[];
  stats: Array<{ path: string; additions: number; deletions: number }>;
}

export function collectDiffSummary(
  shell: ShellAdapter,
  repoRoot: string,
  startingSha: string,
): DiffSummary {
  const committed = parseLines(git(shell, repoRoot, ['diff', '--name-only', `${startingSha}..HEAD`]));
  const staged = parseLines(git(shell, repoRoot, ['diff', '--cached', '--name-only']));
  const unstaged = parseLines(git(shell, repoRoot, ['diff', '--name-only']));
  const untracked = parseLines(git(shell, repoRoot, ['ls-files', '--others', '--exclude-standard']));
  const statOutput = git(shell, repoRoot, ['diff', '--numstat', `${startingSha}..HEAD`]);
  const stats = statOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, filePath] = line.split('\t');
      return {
        path: normalizePath(filePath),
        additions: additions === '-' ? 0 : Number(additions),
        deletions: deletions === '-' ? 0 : Number(deletions),
      };
    });
  const all = Array.from(new Set([...committed, ...staged, ...unstaged, ...untracked])).sort();
  return {
    committed,
    staged,
    unstaged,
    untracked,
    all,
    stats,
  };
}

export function isMigrationPath(filePath: string): boolean {
  return normalizePath(filePath).startsWith('supabase/migrations/') && filePath.endsWith('.sql');
}

export function repoJoin(repoRoot: string, relativePath: string): string {
  return path.join(repoRoot, relativePath.split('/').join(path.sep));
}
