#!/usr/bin/env tsx
/**
 * Validates that .ops/sync.yml issue ID matches the current git branch.
 * Exits 1 if they mismatch — used as a pre-push guard.
 *
 * Usage: tsx scripts/ops/sync-check.ts
 *
 * Skips silently if:
 *   - Not on a lane branch (main, chore/*, docs/*, etc.)
 *   - .ops/sync.yml does not exist
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';

const SYNC_YML = '.ops/sync.yml';
const BRANCH_PATTERN = /^(?:claude|codex)\/utv2-(\d+)-/i;

function getCurrentBranch(): string {
  return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
}

function extractIssueFromBranch(branch: string): string | null {
  const m = branch.match(BRANCH_PATTERN);
  return m ? `UTV2-${m[1]}` : null;
}

function extractIssueFromSync(syncPath: string): string | null {
  if (!existsSync(syncPath)) return null;
  const content = readFileSync(syncPath, 'utf8');
  const parsed = parseYaml(content) as { entities?: { issues?: string[] } };
  const issues = parsed?.entities?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  return issues[0];
}

function main(): void {
  const branch = getCurrentBranch();
  const branchIssue = extractIssueFromBranch(branch);

  if (!branchIssue) {
    // Not a lane branch — skip
    process.exit(0);
  }

  const syncIssue = extractIssueFromSync(SYNC_YML);

  if (!syncIssue) {
    // No sync.yml or no issues listed — skip (fibery-ci-enforcement will catch missing file)
    process.exit(0);
  }

  if (syncIssue.toUpperCase() !== branchIssue.toUpperCase()) {
    console.error(
      `\n[sync-check] MISMATCH: .ops/sync.yml lists "${syncIssue}" but branch "${branch}" expects "${branchIssue}".`,
    );
    console.error(`  Update .ops/sync.yml to reference ${branchIssue} before pushing.\n`);
    process.exit(1);
  }

  console.log(`[sync-check] OK: branch "${branch}" ↔ sync.yml "${syncIssue}"`);
  process.exit(0);
}

main();
