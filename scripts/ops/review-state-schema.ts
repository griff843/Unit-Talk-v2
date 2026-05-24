/**
 * Structured Review State Schema (Workflow Runtime v2, Phase B)
 *
 * Defines the shape of .ops/reviews/<ISSUE_ID>.json — the durable
 * record of who reviewed what, when, and with what verdict.
 *
 * Invariants enforced at runtime (not just types):
 *   - reviewer != executor (self-certification blocked)
 *   - verdict invalidated when PR head changes after review
 *   - blocker history is append-only (resolved_findings accumulates)
 */

import fs from 'node:fs';
import path from 'node:path';

export const REVIEW_STATE_SCHEMA_VERSION = 1 as const;
export const REVIEWS_DIR = '.ops/reviews';

export type ReviewStatus =
  | 'pending'
  | 'in_review'
  | 'pass'
  | 'fail'
  | 'stale'
  | 'invalidated';

export type PmVerdictStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'not_required';

export type Executor = 'claude' | 'codex' | 'codex-cli' | 'codex-cloud' | 'pm';

export interface ReviewGateResult {
  gate: string;
  verdict: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
  checked_at: string;
}

export interface ReviewFinding {
  id: string;
  description: string;
  severity: 'blocking' | 'advisory';
  added_at: string;
  resolved_at: string | null;
}

/**
 * Canonical review state record.
 *
 * Written to .ops/reviews/<ISSUE_ID>.json by ops:review and updated
 * by ops:review-verdict. Consumed by ops:pm-verdict and Merge Gate.
 */
export interface ReviewStateV1 {
  schema_version: 1;

  issue_id: string;
  pr_number: number;

  /** Executor who wrote the implementation. */
  executor: Executor;

  /** Reviewer (must differ from executor). */
  reviewer: Executor | null;

  tier: 'T1' | 'T2' | 'T3';
  lane_type: string;

  /**
   * The PR head SHA the reviewer inspected.
   * Verdict is invalidated if the current head differs.
   */
  reviewed_head_sha: string | null;

  findings: ReviewFinding[];

  /** Convenience accessors (derived from findings). */
  blocking_findings: string[];
  resolved_findings: string[];

  review_status: ReviewStatus;

  /** How many times the review was invalidated + re-requested. */
  re_review_count: number;

  pm_verdict_status: PmVerdictStatus;

  gate_results: ReviewGateResult[];

  /** File paths the lane declared in file_scope_lock. */
  lock_scope: string[];

  /** Files actually changed in the PR diff. */
  changed_files: string[];

  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ReviewStateValidationFailure {
  field: string;
  message: string;
}

export interface ReviewStateValidationResult {
  valid: boolean;
  failures: ReviewStateValidationFailure[];
}

const SHA_RE = /^[0-9a-f]{40}$/i;
const VALID_STATUSES = new Set<string>([
  'pending', 'in_review', 'pass', 'fail', 'stale', 'invalidated',
]);
const VALID_PM_STATUSES = new Set<string>([
  'pending', 'approved', 'rejected', 'not_required',
]);
const VALID_TIERS = new Set<string>(['T1', 'T2', 'T3']);
const VALID_EXECUTORS = new Set<string>([
  'claude', 'codex', 'codex-cli', 'codex-cloud', 'pm',
]);

export function validateReviewState(candidate: unknown): ReviewStateValidationResult {
  const failures: ReviewStateValidationFailure[] = [];

  if (candidate === null || typeof candidate !== 'object') {
    return {
      valid: false,
      failures: [{ field: 'root', message: 'review state must be a non-null object' }],
    };
  }

  const r = candidate as Record<string, unknown>;

  if (r['schema_version'] !== REVIEW_STATE_SCHEMA_VERSION) {
    failures.push({
      field: 'schema_version',
      message: `schema_version must be ${REVIEW_STATE_SCHEMA_VERSION}`,
    });
  }

  if (typeof r['issue_id'] !== 'string' || !r['issue_id']) {
    failures.push({ field: 'issue_id', message: 'issue_id must be a non-empty string' });
  }

  if (
    typeof r['pr_number'] !== 'number' ||
    !Number.isInteger(r['pr_number']) ||
    r['pr_number'] <= 0
  ) {
    failures.push({ field: 'pr_number', message: 'pr_number must be a positive integer' });
  }

  if (typeof r['executor'] !== 'string' || !VALID_EXECUTORS.has(r['executor'])) {
    failures.push({
      field: 'executor',
      message: `executor must be one of: ${[...VALID_EXECUTORS].join(', ')}`,
    });
  }

  if (!VALID_TIERS.has(r['tier'] as string)) {
    failures.push({ field: 'tier', message: `tier must be T1, T2, or T3` });
  }

  if (typeof r['lane_type'] !== 'string' || !r['lane_type']) {
    failures.push({ field: 'lane_type', message: 'lane_type must be a non-empty string' });
  }

  const reviewedHead = r['reviewed_head_sha'];
  if (reviewedHead !== null && reviewedHead !== undefined) {
    if (typeof reviewedHead !== 'string' || !SHA_RE.test(reviewedHead)) {
      failures.push({
        field: 'reviewed_head_sha',
        message: 'reviewed_head_sha must be a 40-char hex SHA or null',
      });
    }
  }

  if (!VALID_STATUSES.has(r['review_status'] as string)) {
    failures.push({
      field: 'review_status',
      message: `review_status must be one of: ${[...VALID_STATUSES].join(', ')}`,
    });
  }

  if (!VALID_PM_STATUSES.has(r['pm_verdict_status'] as string)) {
    failures.push({
      field: 'pm_verdict_status',
      message: `pm_verdict_status must be one of: ${[...VALID_PM_STATUSES].join(', ')}`,
    });
  }

  if (!Array.isArray(r['blocking_findings'])) {
    failures.push({ field: 'blocking_findings', message: 'must be an array' });
  }
  if (!Array.isArray(r['resolved_findings'])) {
    failures.push({ field: 'resolved_findings', message: 'must be an array' });
  }
  if (!Array.isArray(r['gate_results'])) {
    failures.push({ field: 'gate_results', message: 'must be an array' });
  }
  if (!Array.isArray(r['lock_scope'])) {
    failures.push({ field: 'lock_scope', message: 'must be an array' });
  }
  if (!Array.isArray(r['changed_files'])) {
    failures.push({ field: 'changed_files', message: 'must be an array' });
  }
  if (!Array.isArray(r['findings'])) {
    failures.push({ field: 'findings', message: 'must be an array' });
  }

  if (
    typeof r['re_review_count'] !== 'number' ||
    !Number.isInteger(r['re_review_count']) ||
    r['re_review_count'] < 0
  ) {
    failures.push({ field: 're_review_count', message: 'must be a non-negative integer' });
  }

  return { valid: failures.length === 0, failures };
}

/**
 * Self-certification check.
 * Returns true (blocked) when reviewer == executor.
 */
export function isSelfCertification(state: ReviewStateV1): boolean {
  return state.reviewer !== null && state.reviewer === state.executor;
}

/**
 * Staleness check.
 * The review verdict is invalid if the current head differs from reviewed_head_sha.
 */
export function isReviewStale(state: ReviewStateV1, currentHeadSha: string): boolean {
  if (!state.reviewed_head_sha) return false;
  if (!SHA_RE.test(currentHeadSha)) return false;
  return state.reviewed_head_sha !== currentHeadSha;
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

export function reviewStatePath(issueId: string, root = process.cwd()): string {
  return path.join(root, REVIEWS_DIR, `${issueId}.json`);
}

export function readReviewState(issueId: string, root = process.cwd()): ReviewStateV1 {
  const filePath = reviewStatePath(issueId, root);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Review state file not found: ${filePath}`);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  const result = validateReviewState(raw);
  if (!result.valid) {
    throw new Error(
      `Review state schema invalid: ${result.failures.map(f => `${f.field}: ${f.message}`).join('; ')}`,
    );
  }
  return raw as ReviewStateV1;
}

export function writeReviewState(state: ReviewStateV1, root = process.cwd()): void {
  const filePath = reviewStatePath(state.issue_id, root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
}

export function makeEmptyReviewState(
  issueId: string,
  prNumber: number,
  executor: Executor,
  tier: 'T1' | 'T2' | 'T3',
  laneType: string,
  lockScope: string[],
): ReviewStateV1 {
  const now = new Date().toISOString();
  return {
    schema_version: REVIEW_STATE_SCHEMA_VERSION,
    issue_id: issueId,
    pr_number: prNumber,
    executor,
    reviewer: null,
    tier,
    lane_type: laneType,
    reviewed_head_sha: null,
    findings: [],
    blocking_findings: [],
    resolved_findings: [],
    review_status: 'pending',
    re_review_count: 0,
    pm_verdict_status: 'pending',
    gate_results: [],
    lock_scope: lockScope,
    changed_files: [],
    created_at: now,
    updated_at: now,
  };
}
