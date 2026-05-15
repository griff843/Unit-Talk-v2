#!/usr/bin/env tsx
/**
 * Validates that the lane's sync metadata declares the correct issue ID.
 * Exits 1 if there is a mismatch; exits 0 otherwise.
 *
 * Check order:
 *   1. .ops/sync/UTV2-NNN.yml  (per-issue file — preferred, no conflict risk)
 *   2. .ops/sync.yml            (legacy shared file — backward compat only)
 *
 * Skips silently when not on a lane branch (main, chore/*, docs/*, etc.).
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';

const LEGACY_SYNC_YML = '.ops/sync.yml';
const SYNC_DIR = '.ops/sync';
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
    process.exit(0);
  }

  // Check per-issue file first (preferred model)
  const perIssuePath = `${SYNC_DIR}/${branchIssue}.yml`;
  if (existsSync(perIssuePath)) {
    const syncIssue = extractIssueFromSync(perIssuePath);
    if (!syncIssue) {
      console.error(
        `\n[sync-check] MISSING: ${perIssuePath} exists but declares no issues.`,
      );
      console.error(`  Add entities.issues: [${branchIssue}] to ${perIssuePath}.\n`);
      process.exit(1);
    }
    if (syncIssue.toUpperCase() !== branchIssue.toUpperCase()) {
      console.error(
        `\n[sync-check] MISMATCH: ${perIssuePath} lists "${syncIssue}" but branch "${branch}" expects "${branchIssue}".`,
      );
      process.exit(1);
    }
    console.log(`[sync-check] OK (per-issue): branch "${branch}" ↔ ${perIssuePath}`);
    process.exit(0);
  }

  // Fall back to legacy .ops/sync.yml
  const syncIssue = extractIssueFromSync(LEGACY_SYNC_YML);
  if (!syncIssue) {
    // No sync metadata at all — skip (fibery-ci-enforcement will catch missing file)
    process.exit(0);
  }

  if (syncIssue.toUpperCase() !== branchIssue.toUpperCase()) {
    console.error(
      `\n[sync-check] MISMATCH: .ops/sync.yml lists "${syncIssue}" but branch "${branch}" expects "${branchIssue}".`,
    );
    console.error(
      `  Create .ops/sync/${branchIssue}.yml with entities.issues: [${branchIssue}] to fix this permanently.\n`,
    );
    process.exit(1);
  }

  console.log(`[sync-check] OK (legacy): branch "${branch}" ↔ sync.yml "${syncIssue}"`);
  process.exit(0);
}

main();
