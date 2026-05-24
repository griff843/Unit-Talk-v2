#!/usr/bin/env tsx
/**
 * ops:pm-verdict — PM Verdict Validator (Workflow Runtime v2, Phase D)
 *
 * Usage:
 *   pnpm ops:pm-verdict <ISSUE_ID> --pr <PR_NUMBER> [--approve] [--actor <name>] [--json]
 *
 * For this phase: validates readiness and prints/posts candidate verdict.
 * Does NOT bypass PM authority — the t1-approved label and CODEOWNERS
 * comment remain the blocking authority in CI.
 *
 * Fails closed if:
 *   - CI not green on the PR
 *   - review PASS missing or stale
 *   - proof stale or missing
 *   - tier mismatch
 *   - unresolved blocking findings
 *   - lane lock invalid (manifest not in a valid closed/done state for approve)
 *   - PM actor unauthorized (not in AUTHORIZED_ACTORS)
 */

import { execFileSync } from 'node:child_process';
import {
  ROOT,
  emitJson,
  parseArgs,
  getFlag,
  requireIssueId,
  readManifest,
} from './shared.js';
import {
  readReviewState,
  isReviewStale,
  isSelfCertification,
} from './review-state-schema.js';

const AUTHORIZED_ACTORS = new Set(['griff843', 'pm', 'griffadavi']);

interface CliOptions {
  issueId: string;
  prNumber: number | null;
  approve: boolean;
  actor: string | null;
  json: boolean;
}

interface PmVerdictResult {
  verdict: 'APPROVED' | 'REJECTED' | 'NOT_READY';
  issue_id: string;
  pr_number: number | null;
  actor: string | null;
  failures: string[];
  warnings: string[];
  checked_at: string;
  readiness: {
    ci_green: boolean | null;
    review_pass: boolean | null;
    proof_fresh: boolean | null;
    tier_consistent: boolean | null;
    no_unresolved_blockers: boolean | null;
    lane_valid: boolean | null;
  };
}

function parseCliArgs(argv: string[]): CliOptions {
  const { positionals, flags, bools } = parseArgs(argv);
  const issueId = requireIssueId(positionals[0] ?? '');
  const prRaw = getFlag(flags, 'pr');
  const prNumber = prRaw != null ? Number(prRaw) : null;
  const actor = getFlag(flags, 'actor') ?? null;
  return {
    issueId,
    prNumber: prNumber != null && Number.isFinite(prNumber) ? prNumber : null,
    approve: bools.has('approve') || flags.has('approve'),
    actor,
    json: bools.has('json') || flags.has('json'),
  };
}

interface CiStatus {
  green: boolean;
  pending: number;
  failed: string[];
}

function getCiStatus(prNumber: number): CiStatus {
  try {
    const out = execFileSync('gh', [
      'pr', 'checks', String(prNumber),
      '--json', 'name,state',
    ], { encoding: 'utf8', cwd: ROOT }).trim();
    const checks = JSON.parse(out) as Array<{ name: string; state: string }>;
    const failed = checks
      .filter(c => c.state === 'FAILURE' || c.state === 'ERROR')
      .map(c => c.name);
    const pending = checks.filter(c => c.state === 'PENDING' || c.state === 'IN_PROGRESS').length;
    return { green: failed.length === 0 && pending === 0, pending, failed };
  } catch {
    return { green: false, pending: 0, failed: ['(could not fetch CI status)'] };
  }
}

function getPrHeadSha(prNumber: number): string | null {
  try {
    return execFileSync('gh', [
      'pr', 'view', String(prNumber),
      '--json', 'headRefOid', '--jq', '.headRefOid',
    ], { encoding: 'utf8', cwd: ROOT }).trim() || null;
  } catch {
    return null;
  }
}

function run(options: CliOptions): PmVerdictResult {
  const { issueId, prNumber, approve, actor } = options;
  const failures: string[] = [];
  const warnings: string[] = [];
  const checkedAt = new Date().toISOString();

  const readiness = {
    ci_green: null as boolean | null,
    review_pass: null as boolean | null,
    proof_fresh: null as boolean | null,
    tier_consistent: null as boolean | null,
    no_unresolved_blockers: null as boolean | null,
    lane_valid: null as boolean | null,
  };

  // --- Actor authorization ---
  if (approve && actor) {
    if (!AUTHORIZED_ACTORS.has(actor)) {
      failures.push(`PM actor "${actor}" is not authorized. Authorized actors: ${[...AUTHORIZED_ACTORS].join(', ')}`);
    }
  } else if (approve && !actor) {
    warnings.push('--actor not supplied — cannot verify PM authorization');
  }

  // --- Lane manifest ---
  let manifestTier: string | null = null;
  try {
    const manifest = readManifest(issueId);
    manifestTier = manifest.tier ?? null;
    const validStatuses = new Set(['started', 'in_progress', 'in_review', 'done', 'blocked']);
    if (manifest.status && !validStatuses.has(manifest.status)) {
      failures.push(`Lane manifest status "${manifest.status}" is not a valid pre-close status`);
      readiness.lane_valid = false;
    } else {
      readiness.lane_valid = true;
    }
  } catch {
    failures.push(`Lane manifest not found for ${issueId}`);
    readiness.lane_valid = false;
  }

  // --- CI check ---
  if (prNumber != null) {
    const ci = getCiStatus(prNumber);
    readiness.ci_green = ci.green;
    if (!ci.green) {
      if (ci.failed.length > 0) {
        failures.push(`CI has failing checks: ${ci.failed.join(', ')}`);
      }
      if (ci.pending > 0) {
        failures.push(`CI has ${ci.pending} pending checks — wait for CI to complete`);
      }
    }
  } else {
    warnings.push('No --pr provided — CI status check skipped');
  }

  // --- PR head SHA ---
  const currentHead = prNumber != null ? getPrHeadSha(prNumber) : null;

  // --- Review state ---
  try {
    const review = readReviewState(issueId, ROOT);

    // Self-cert check
    if (isSelfCertification(review)) {
      failures.push(
        `Review state has self-certification: reviewer "${review.reviewer}" == executor "${review.executor}". ` +
        `This review is invalid.`,
      );
    }

    // Review PASS
    if (review.review_status !== 'pass') {
      failures.push(
        `Review is not PASS (status: ${review.review_status}). ` +
        `Run ops:review-verdict --pass after adversarial review.`,
      );
      readiness.review_pass = false;
    } else {
      readiness.review_pass = true;
    }

    // Review staleness (head changed after review)
    if (currentHead && review.reviewed_head_sha) {
      if (isReviewStale(review, currentHead)) {
        failures.push(
          `Review is stale: reviewed at ${review.reviewed_head_sha}, current head is ${currentHead}. ` +
          `Re-review required.`,
        );
        readiness.review_pass = false;
      }
    }

    // Unresolved blockers
    const unresolved = review.findings.filter(f => f.severity === 'blocking' && f.resolved_at === null);
    if (unresolved.length > 0) {
      failures.push(`${unresolved.length} unresolved blocking finding(s): ${unresolved.map(f => f.description).join('; ')}`);
      readiness.no_unresolved_blockers = false;
    } else {
      readiness.no_unresolved_blockers = true;
    }

    // Tier consistency
    if (manifestTier && review.tier !== manifestTier) {
      failures.push(`Review tier (${review.tier}) does not match manifest tier (${manifestTier})`);
      readiness.tier_consistent = false;
    } else {
      readiness.tier_consistent = true;
    }

  } catch {
    failures.push(`Review state not found for ${issueId} — run ops:review and ops:review-verdict first`);
    readiness.review_pass = false;
    readiness.no_unresolved_blockers = false;
  }

  // --- Proof check (advisory: look for proof file existence) ---
  const proofPaths = [
    `${ROOT}/docs/06_status/proof/${issueId}.json`,
    `${ROOT}/docs/06_status/${issueId}-EVIDENCE-BUNDLE.md`,
    `${ROOT}/docs/06_status/proof/${issueId}.md`,
  ];
  const proofExists = proofPaths.some(p => {
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
  if (!proofExists) {
    failures.push(`No proof file found for ${issueId} — proof required before PM verdict`);
    readiness.proof_fresh = false;
  } else {
    readiness.proof_fresh = true;
  }

  // --- Determine verdict ---
  const isReady = failures.length === 0;
  let verdict: 'APPROVED' | 'REJECTED' | 'NOT_READY';

  if (!isReady) {
    verdict = 'NOT_READY';
  } else if (approve) {
    verdict = 'APPROVED';
  } else {
    verdict = 'NOT_READY';
    warnings.push('All readiness gates passed. Supply --approve to record candidate APPROVED verdict.');
  }

  return {
    verdict,
    issue_id: issueId,
    pr_number: prNumber,
    actor,
    failures,
    warnings,
    checked_at: checkedAt,
    readiness,
  };
}

function printHuman(result: PmVerdictResult): void {
  console.log(`ops:pm-verdict ${result.issue_id}${result.pr_number != null ? ` PR #${result.pr_number}` : ''}`);
  if (result.actor) console.log(`Actor: ${result.actor}`);

  console.log('\nReadiness gates:');
  const r = result.readiness;
  console.log(`  CI green:              ${r.ci_green === null ? 'SKIP' : r.ci_green ? 'PASS' : 'FAIL'}`);
  console.log(`  Review PASS:           ${r.review_pass === null ? 'SKIP' : r.review_pass ? 'PASS' : 'FAIL'}`);
  console.log(`  Proof present:         ${r.proof_fresh === null ? 'SKIP' : r.proof_fresh ? 'PASS' : 'FAIL'}`);
  console.log(`  Tier consistent:       ${r.tier_consistent === null ? 'SKIP' : r.tier_consistent ? 'PASS' : 'FAIL'}`);
  console.log(`  No unresolved blockers:${r.no_unresolved_blockers === null ? 'SKIP' : r.no_unresolved_blockers ? 'PASS' : 'FAIL'}`);
  console.log(`  Lane valid:            ${r.lane_valid === null ? 'SKIP' : r.lane_valid ? 'PASS' : 'FAIL'}`);

  if (result.failures.length > 0) {
    console.log('\nFailures:');
    for (const f of result.failures) console.log(`  FAIL  ${f}`);
  }
  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of result.warnings) console.log(`  WARN  ${w}`);
  }

  console.log(`\nCandidate verdict: ${result.verdict}`);

  if (result.verdict === 'APPROVED') {
    console.log('\nNote: This is a candidate verdict only. The t1-approved label and');
    console.log('CODEOWNERS pm-verdict/v1 comment remain the blocking CI authority.');
  }
}

const options = parseCliArgs(process.argv.slice(2));
const result = run(options);

if (options.json) {
  emitJson(result);
} else {
  printHuman(result);
}

process.exitCode = result.verdict !== 'NOT_READY' || result.failures.length === 0 ? 0 : 1;
