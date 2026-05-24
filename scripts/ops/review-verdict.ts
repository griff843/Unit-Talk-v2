#!/usr/bin/env tsx
/**
 * ops:review-verdict — Explicit Review Verdict Recorder (WFR-v2, Phase C)
 *
 * Usage:
 *   pnpm ops:review-verdict <ISSUE_ID> --pr <PR_NUMBER> --pass [--reviewer <executor>]
 *   pnpm ops:review-verdict <ISSUE_ID> --pr <PR_NUMBER> --fail --finding "description"
 *
 * Invariants enforced:
 *   - reviewer != executor (self-certification blocked)
 *   - verdict is invalidated if PR head changed since review
 *   - blocker history is append-only (resolved_findings accumulates)
 *   - --pass is rejected if unresolved blocking findings exist
 */

import { execFileSync } from 'node:child_process';
import {
  ROOT,
  emitJson,
  parseArgs,
  getFlag,
  getFlags,
  requireIssueId,
  readManifest,
} from './shared.js';
import {
  readReviewState,
  writeReviewState,
  isSelfCertification,
  isReviewStale,
  type Executor,
  type ReviewStateV1,
  type ReviewFinding,
} from './review-state-schema.js';

interface CliOptions {
  issueId: string;
  prNumber: number | null;
  verdict: 'pass' | 'fail' | null;
  reviewer: Executor | null;
  findings: string[];
  json: boolean;
}

interface VerdictResult {
  ok: boolean;
  verdict: 'pass' | 'fail' | null;
  issue_id: string;
  pr_number: number | null;
  reviewer: Executor | null;
  executor: Executor | null;
  failures: string[];
  warnings: string[];
  recorded_at: string;
}

function parseCliArgs(argv: string[]): CliOptions {
  const { positionals, flags, bools } = parseArgs(argv);
  const issueId = requireIssueId(positionals[0] ?? '');
  const prRaw = getFlag(flags, 'pr');
  const prNumber = prRaw != null ? Number(prRaw) : null;
  const isPass = bools.has('pass') || flags.has('pass');
  const isFail = bools.has('fail') || flags.has('fail');
  const reviewerRaw = getFlag(flags, 'reviewer') ?? null;

  return {
    issueId,
    prNumber: prNumber != null && Number.isFinite(prNumber) ? prNumber : null,
    verdict: isPass ? 'pass' : isFail ? 'fail' : null,
    reviewer: reviewerRaw as Executor | null,
    findings: getFlags(flags, 'finding'),
    json: bools.has('json') || flags.has('json'),
  };
}

function getCurrentPrHeadSha(prNumber: number): string | null {
  try {
    const out = execFileSync('gh', [
      'pr', 'view', String(prNumber),
      '--json', 'headRefOid',
      '--jq', '.headRefOid',
    ], { encoding: 'utf8', cwd: ROOT }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function run(options: CliOptions): VerdictResult {
  const { issueId, prNumber, verdict, findings } = options;
  const failures: string[] = [];
  const warnings: string[] = [];
  const recordedAt = new Date().toISOString();

  if (!verdict) {
    failures.push('Must supply --pass or --fail');
    return { ok: false, verdict: null, issue_id: issueId, pr_number: prNumber, reviewer: null, executor: null, failures, warnings, recorded_at: recordedAt };
  }

  // --- Load review state ---
  let state: ReviewStateV1;
  try {
    state = readReviewState(issueId, ROOT);
  } catch (err) {
    failures.push(`Review state not found — run ops:review first: ${String(err)}`);
    return { ok: false, verdict, issue_id: issueId, pr_number: prNumber, reviewer: null, executor: null, failures, warnings, recorded_at: recordedAt };
  }

  const executor = state.executor;

  // --- Determine reviewer ---
  let reviewer: Executor = options.reviewer ?? state.reviewer ?? ('claude' as Executor);

  // --- Self-certification check ---
  const candidateState: ReviewStateV1 = { ...state, reviewer };
  if (isSelfCertification(candidateState)) {
    failures.push(
      `Self-certification blocked: reviewer "${reviewer}" is the same as executor "${executor}". ` +
      `Use --reviewer to specify a different reviewer.`,
    );
  }

  // --- PR head staleness check ---
  let currentHead: string | null = null;
  if (prNumber != null) {
    currentHead = getCurrentPrHeadSha(prNumber);
  }

  if (currentHead && state.reviewed_head_sha) {
    if (isReviewStale(state, currentHead)) {
      failures.push(
        `Review is stale: PR head has changed from ${state.reviewed_head_sha} to ${currentHead}. ` +
        `Run ops:review again to get an updated packet, then re-review.`,
      );
      state.review_status = 'stale';
      state.re_review_count += 1;
      writeReviewState(state, ROOT);
      return {
        ok: false,
        verdict,
        issue_id: issueId,
        pr_number: prNumber,
        reviewer,
        executor,
        failures,
        warnings,
        recorded_at: recordedAt,
      };
    }
  } else if (prNumber != null && !currentHead) {
    warnings.push('Could not verify current PR head — staleness check skipped');
  }

  // --- Unresolved blockers check (--pass only) ---
  if (verdict === 'pass') {
    const unresolvedBlockers = state.findings.filter(
      f => f.severity === 'blocking' && f.resolved_at === null,
    );
    if (unresolvedBlockers.length > 0) {
      failures.push(
        `Cannot record PASS with ${unresolvedBlockers.length} unresolved blocking finding(s): ` +
        unresolvedBlockers.map(f => f.description).join('; '),
      );
    }
  }

  if (failures.length > 0) {
    return { ok: false, verdict, issue_id: issueId, pr_number: prNumber, reviewer, executor, failures, warnings, recorded_at: recordedAt };
  }

  // --- Append new findings (if --fail with --finding) ---
  if (verdict === 'fail' && findings.length > 0) {
    for (const desc of findings) {
      const finding: ReviewFinding = {
        id: `F${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: desc,
        severity: 'blocking',
        added_at: recordedAt,
        resolved_at: null,
      };
      state.findings.push(finding);
      state.blocking_findings.push(desc);
    }
  }

  // --- Record verdict ---
  state.reviewer = reviewer;
  state.review_status = verdict;
  state.updated_at = recordedAt;

  if (verdict === 'pass') {
    // Move all blocking findings to resolved
    for (const f of state.findings) {
      if (f.severity === 'blocking' && f.resolved_at === null) {
        f.resolved_at = recordedAt;
        state.resolved_findings.push(f.description);
      }
    }
    state.blocking_findings = [];
  }

  writeReviewState(state, ROOT);

  return {
    ok: true,
    verdict,
    issue_id: issueId,
    pr_number: prNumber,
    reviewer,
    executor,
    failures,
    warnings,
    recorded_at: recordedAt,
  };
}

function printHuman(result: VerdictResult): void {
  console.log(`ops:review-verdict ${result.issue_id}${result.pr_number != null ? ` PR #${result.pr_number}` : ''}`);
  console.log(`Reviewer: ${result.reviewer ?? 'unknown'}`);
  console.log(`Executor: ${result.executor ?? 'unknown'}`);

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of result.warnings) console.log(`  WARN  ${w}`);
  }
  if (result.failures.length > 0) {
    console.log('\nFailures:');
    for (const f of result.failures) console.log(`  FAIL  ${f}`);
  }

  console.log(`\nVerdict recorded: ${result.verdict?.toUpperCase() ?? 'NONE'} (ok=${result.ok})`);
}

const options = parseCliArgs(process.argv.slice(2));
const result = run(options);

if (options.json) {
  emitJson(result);
} else {
  printHuman(result);
}

process.exitCode = result.ok ? 0 : 1;
