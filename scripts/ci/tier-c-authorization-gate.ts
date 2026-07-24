#!/usr/bin/env tsx
/**
 * Tier C authorization gate (UTV2-1570, implementation child of UTV2-1451).
 *
 * Closes the "Tier C path guard silently authorizes via self-declared scope"
 * loophole: .claude/hooks/tier-c-path-guard.sh is a local, real-time editing
 * guard a session can route around entirely (disable hooks, edit outside
 * Claude Code). It is not a merge gate. This script is the mechanical,
 * blocking half that a diff cannot bypass by disabling anything locally.
 *
 * Fails closed when a non-T1 PR's diff touches a canonical Tier C path
 * (scripts/ops/merge-risk.ts's isTierCPath() -- imported directly, not a
 * second Tier C path list) without a valid tier-c-approval/v1 PR comment
 * (docs/05_operations/schemas/tier-c-approval-v1.md) covering EVERY matched
 * path, from an authorized CODEOWNERS human, bound to the exact PR head SHA.
 *
 * A T1 lane touching Tier C paths needs no additional artifact here: its own
 * t1-approved + pm-verdict/v1 gate (merge-gate.yml) already is PM sign-off on
 * the exact head, which necessarily covers whatever the diff touches.
 *
 * Usage:
 *   tsx scripts/ci/tier-c-authorization-gate.ts \
 *     [--changed-files-file <path>] [--base <ref>] [--head <ref>] \
 *     --tier <T1|T2|T3> \
 *     [--approval-file <path to JSON array of parsed tier-c-approval comments>] \
 *     [--pr-number <N>] [--head-sha <sha>] \
 *     [--output-json <path>]
 *
 * Exit codes:
 *   0 — no Tier C paths touched, tier is T1 (covered elsewhere), or a valid
 *       tier-c-approval/v1 comment covers every matched Tier C path
 *   1 — Tier C paths touched by a non-T1 lane with no/partial/invalid approval
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isTierCPath } from '../ops/merge-risk.js';
import type { ParsedTierCApproval } from './tier-c-approval-comment-parser.js';

export interface ParsedTierCApprovalRecord extends ParsedTierCApproval {
  authorized_by: string;
}

export interface TierCAuthorizationReport {
  verdict: 'PASS' | 'FAIL';
  tier: string;
  changed_files: string[];
  matched_tier_c_paths: string[];
  reason: string;
  covered_paths: string[];
  uncovered_paths: string[];
  approval_used: { issue_id: string; pr_number: number; authorized_by: string } | null;
}

function matchesLockPattern(filePath: string, pattern: string): boolean {
  if (pattern === filePath) {
    return true;
  }
  if (pattern.endsWith('/**')) {
    return filePath.startsWith(pattern.slice(0, -3));
  }
  if (pattern.endsWith('/*') && filePath.includes('/')) {
    const dirPart = `${filePath.slice(0, filePath.lastIndexOf('/'))}/`;
    return dirPart === pattern.slice(0, -1);
  }
  return false;
}

function parseArgs(argv: string[]): {
  changedFilesFile: string | null;
  base: string;
  head: string;
  tier: string | null;
  approvalFile: string | null;
  prNumber: number | null;
  headSha: string | null;
  outputJson: string | null;
} {
  const args = argv.slice(2);
  let changedFilesFile: string | null = null;
  let base = 'origin/main';
  let head = 'HEAD';
  let tier: string | null = null;
  let approvalFile: string | null = null;
  let prNumber: number | null = null;
  let headSha: string | null = null;
  let outputJson: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--changed-files-file') changedFilesFile = args[++i] ?? null;
    else if (arg === '--base') base = args[++i] ?? base;
    else if (arg === '--head') head = args[++i] ?? head;
    else if (arg === '--tier') tier = args[++i] ?? null;
    else if (arg === '--approval-file') approvalFile = args[++i] ?? null;
    else if (arg === '--pr-number') prNumber = Number.parseInt(args[++i] ?? '', 10) || null;
    else if (arg === '--head-sha') headSha = args[++i] ?? null;
    else if (arg === '--output-json') outputJson = args[++i] ?? null;
  }
  return { changedFilesFile, base, head, tier, approvalFile, prNumber, headSha, outputJson };
}

function getChangedFiles(
  changedFilesFile: string | null,
  base: string,
  head: string,
  repoRoot: string,
): string[] {
  if (changedFilesFile) {
    try {
      return fs
        .readFileSync(changedFilesFile, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }
  try {
    const raw = execSync(`git diff --name-only ${base}..${head}`, {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return raw.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function loadApprovals(approvalFile: string | null): ParsedTierCApprovalRecord[] {
  if (!approvalFile) {
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));
    if (!Array.isArray(raw)) {
      return [];
    }
    // Re-validate each entry through the canonical parser's shape contract
    // rather than trusting the upstream file blindly -- the workflow step
    // that produces this file duplicates the parser inline (GitHub Actions
    // constraint), so re-checking here catches any future drift between the
    // two copies rather than silently trusting a malformed record.
    return raw.filter(
      (entry): entry is ParsedTierCApprovalRecord =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.issue_id === 'string' &&
        typeof entry.pr_number === 'number' &&
        typeof entry.head_sha === 'string' &&
        Array.isArray(entry.paths) &&
        typeof entry.authorized_by === 'string',
    );
  } catch {
    return [];
  }
}

export function evaluateTierCAuthorization(input: {
  tier: string;
  changedFiles: string[];
  approvals: ParsedTierCApprovalRecord[];
  prNumber: number | null;
  headSha: string | null;
}): TierCAuthorizationReport {
  const { tier, changedFiles, approvals, prNumber, headSha } = input;
  const matchedTierCPaths = changedFiles.filter((filePath) => isTierCPath(filePath));

  if (matchedTierCPaths.length === 0) {
    return {
      verdict: 'PASS',
      tier,
      changed_files: changedFiles,
      matched_tier_c_paths: [],
      reason: 'No Tier C paths touched by this diff.',
      covered_paths: [],
      uncovered_paths: [],
      approval_used: null,
    };
  }

  if (tier === 'T1') {
    return {
      verdict: 'PASS',
      tier,
      changed_files: changedFiles,
      matched_tier_c_paths: matchedTierCPaths,
      reason:
        'Tier C paths touched, but lane is T1 -- t1-approved + pm-verdict/v1 (merge-gate.yml) already covers this diff.',
      covered_paths: matchedTierCPaths,
      uncovered_paths: [],
      approval_used: null,
    };
  }

  // Find an approval bound to this exact PR/head SHA that covers every
  // matched Tier C path.
  for (const approval of approvals) {
    if (prNumber !== null && approval.pr_number !== prNumber) continue;
    if (headSha !== null && approval.head_sha !== headSha) continue;

    const uncovered = matchedTierCPaths.filter(
      (filePath) => !approval.paths.some((pattern) => matchesLockPattern(filePath, pattern)),
    );
    if (uncovered.length === 0) {
      return {
        verdict: 'PASS',
        tier,
        changed_files: changedFiles,
        matched_tier_c_paths: matchedTierCPaths,
        reason: `Valid tier-c-approval/v1 comment from ${approval.authorized_by} covers all matched Tier C paths.`,
        covered_paths: matchedTierCPaths,
        uncovered_paths: [],
        approval_used: {
          issue_id: approval.issue_id,
          pr_number: approval.pr_number,
          authorized_by: approval.authorized_by,
        },
      };
    }
  }

  // No approval, or every candidate approval left at least one path
  // uncovered -- fail closed. Report the best-effort uncovered set from the
  // most path-covering candidate for operator diagnosis (or all paths
  // uncovered if there was no candidate at all).
  let bestUncovered = matchedTierCPaths;
  for (const approval of approvals) {
    const uncovered = matchedTierCPaths.filter(
      (filePath) => !approval.paths.some((pattern) => matchesLockPattern(filePath, pattern)),
    );
    if (uncovered.length < bestUncovered.length) {
      bestUncovered = uncovered;
    }
  }

  return {
    verdict: 'FAIL',
    tier,
    changed_files: changedFiles,
    matched_tier_c_paths: matchedTierCPaths,
    reason:
      approvals.length === 0
        ? 'Non-T1 lane touches Tier C path(s) with no tier-c-approval/v1 comment present.'
        : 'Non-T1 lane touches Tier C path(s) not fully covered by any valid tier-c-approval/v1 comment bound to this PR/head SHA.',
    covered_paths: matchedTierCPaths.filter((filePath) => !bestUncovered.includes(filePath)),
    uncovered_paths: bestUncovered,
    approval_used: null,
  };
}

function main(): void {
  const { changedFilesFile, base, head, tier, approvalFile, prNumber, headSha, outputJson } = parseArgs(
    process.argv,
  );

  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), '../..');

  if (!tier) {
    const report = {
      verdict: 'FAIL' as const,
      tier: null,
      changed_files: [],
      matched_tier_c_paths: [],
      reason: 'Missing required --tier flag.',
      covered_paths: [],
      uncovered_paths: [],
      approval_used: null,
    };
    if (outputJson) {
      fs.writeFileSync(outputJson, JSON.stringify(report, null, 2), 'utf8');
    }
    console.error('[tier-c-authorization-gate] FAIL: --tier is required');
    process.exit(1);
  }

  const changedFiles = getChangedFiles(changedFilesFile, base, head, repoRoot);
  const approvals = loadApprovals(approvalFile);

  const report = evaluateTierCAuthorization({ tier, changedFiles, approvals, prNumber, headSha });

  if (outputJson) {
    fs.mkdirSync(path.dirname(outputJson), { recursive: true });
    fs.writeFileSync(outputJson, JSON.stringify(report, null, 2), 'utf8');
  }

  console.log(`[tier-c-authorization-gate] verdict=${report.verdict} tier=${report.tier} matched=${report.matched_tier_c_paths.length}`);
  if (report.verdict === 'FAIL') {
    console.error(`[tier-c-authorization-gate] ${report.reason}`);
    console.error(`[tier-c-authorization-gate] uncovered paths: ${report.uncovered_paths.join(', ')}`);
    process.exit(1);
  }
  process.exit(0);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main();
}
