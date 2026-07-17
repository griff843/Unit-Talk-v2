/**
 * Pure, testable core of executor-result validation.
 *
 * UTV2-1550: the pull_request-triggered preflight and the issue_comment /
 * workflow_dispatch-triggered validation must never share the required
 * "Executor Result Validation" check-run identity. GitHub's merge-eligibility
 * computation for a required status-check context is anchored to the
 * check-suite/run associated with the *original* triggering event for that
 * SHA — a later run with the same context name from a different trigger
 * (e.g. issue_comment superseding a stale pull_request-triggered failure)
 * does not reliably supersede it for merge-blocking purposes. Concretely:
 * pushing a new commit (pull_request: synchronize) re-evaluates any existing
 * (now-stale) executor-result comment and can create a *failing* run under
 * the required name before a corrected comment is ever posted; a later
 * successful issue_comment-triggered run under the same name does not
 * reliably clear that original failure for merge purposes.
 *
 * Fix: pull_request-triggered evaluation always uses a distinct,
 * non-required check name ("Executor Result Preflight"). Only
 * issue_comment/workflow_dispatch ever create the required
 * "Executor Result Validation" context, so there is exactly one
 * authoritative required identity per PR head.
 */

export const REQUIRED_CHECK_NAME = 'Executor Result Validation';
export const PREFLIGHT_CHECK_NAME = 'Executor Result Preflight';

export type TriggerEvent = 'pull_request' | 'issue_comment' | 'workflow_dispatch';

/** Resolves the check-run name for a given triggering event. */
export function resolveCheckName(eventName: string): string {
  return eventName === 'pull_request' ? PREFLIGHT_CHECK_NAME : REQUIRED_CHECK_NAME;
}

/** True only for the event types that may create the required context. */
export function isRequiredCheckName(eventName: string): boolean {
  return resolveCheckName(eventName) === REQUIRED_CHECK_NAME;
}

export interface ParsedExecutorResult {
  issueId: string | null;
  lane: string | null;
  branch: string | null;
  pr: string | null;
  headSha: string | null;
  proofPath: string | null;
}

/**
 * Parses a single PR comment body into an ExecutorResult, or null if the
 * comment is not a well-formed executor-result/v1 comment at all (missing
 * header/schema lines). Field-level defects are surfaced separately by
 * validateExecutorResultFields, not here — a structurally-recognized but
 * field-invalid comment still parses.
 */
export function parseExecutorResultComment(body: string | null | undefined): ParsedExecutorResult | null {
  if (!body) return null;
  const lines = body.split(/\r?\n/).map((l) =>
    l.trim().replace(/^\*\*(.+?)\*\*\s*/, '$1 ').replace(/^---$/, ''),
  );
  if (!lines.some((l) => l === 'EXECUTOR_RESULT: READY_FOR_REVIEW')) return null;
  if (!lines.some((l) => l === 'schema: executor-result/v1')) return null;

  const field = (name: string): string | null => {
    const re = new RegExp('^' + name + ':\\s+(.+)$', 'i');
    const hit = lines.find((l) => re.test(l));
    return hit ? hit.replace(re, '$1').trim() : null;
  };

  return {
    issueId: field('Issue'),
    lane: field('Lane'),
    branch: field('Branch'),
    pr: field('PR'),
    headSha: field('Head SHA'),
    proofPath: field('Proof Artifact'),
  };
}

/**
 * Parses every comment body, keeps only structurally-valid executor-result
 * comments, and returns the most recently posted one (last in input order) —
 * or null if no comment ever parsed. Caller supplies bodies pre-ordered by
 * creation time (oldest first), matching the GitHub API's default comment
 * ordering.
 */
export function selectLatestExecutorResult(commentBodies: Array<string | null | undefined>): ParsedExecutorResult | null {
  const parsed = commentBodies.map(parseExecutorResultComment).filter((r): r is ParsedExecutorResult => r !== null);
  return parsed.length > 0 ? parsed[parsed.length - 1] : null;
}

export interface ValidationContext {
  prNumber: number;
  headRef: string;
  headSha: string;
  prLabels: string[];
}

/**
 * Validates the field-level contents of an already-parsed executor result
 * against the PR it claims to describe. Does not touch the network — proof
 * file existence/content and CI conclusion are validated separately by the
 * workflow using GitHub API data, since those require live lookups this
 * module deliberately stays free of for testability.
 */
export function validateExecutorResultFields(r: ParsedExecutorResult, ctx: ValidationContext): string[] {
  const errors: string[] = [];

  if (!r.issueId || !/^(UTV2|UNI)-\d+$/i.test(r.issueId)) {
    errors.push(`Invalid Issue ID: "${r.issueId || '<missing>'}". Must match UTV2-NNN or UNI-NNN.`);
  }

  if (!r.lane || !['claude', 'codex'].includes(r.lane.toLowerCase())) {
    errors.push(`Invalid Lane: "${r.lane || '<missing>'}". Must be "claude" or "codex".`);
  }

  const branchRe = /^(claude|codex)\/(utv2|uni)-\d+/i;
  if (!r.branch || !branchRe.test(r.branch)) {
    errors.push(
      `Invalid branch: "${r.branch || '<missing>'}". Must match claude/utv2-NNN-*, codex/utv2-NNN-*, claude/uni-NNN-*, or codex/uni-NNN-*.`,
    );
  }
  if (r.branch && r.branch !== ctx.headRef) {
    errors.push(`Branch mismatch: comment declares "${r.branch}", PR head is "${ctx.headRef}".`);
  }

  const declaredPR = r.pr ? Number(String(r.pr).replace('#', '')) : null;
  if (!declaredPR || declaredPR !== ctx.prNumber) {
    errors.push(`PR mismatch: comment declares "${r.pr || '<missing>'}", actual is #${ctx.prNumber}.`);
  }

  if (!r.headSha) {
    errors.push('Head SHA missing from executor result.');
  } else if (r.headSha !== ctx.headSha) {
    errors.push(
      `HEAD SHA mismatch: comment has "${r.headSha}", current PR head is "${ctx.headSha}". Re-post executor result after pushing.`,
    );
  }

  return errors;
}

/** Resolves the T1/T2/T3 tier from a PR's label list, or null if absent. */
export function resolveTier(prLabels: string[]): 'T1' | 'T2' | 'T3' | null {
  const tierLabel = prLabels.find((l) => /^tier:T[123]$/i.test(l));
  return tierLabel ? (tierLabel.split(':')[1].toUpperCase() as 'T1' | 'T2' | 'T3') : null;
}

/** True when a proof artifact path is required for this result's tier. */
export function proofArtifactRequired(r: ParsedExecutorResult, prLabels: string[]): boolean {
  const tier = resolveTier(prLabels);
  const proofSkipped =
    !r.proofPath || r.proofPath.toLowerCase() === 'ci only' || r.proofPath.toLowerCase() === 'n/a';
  return proofSkipped && tier !== 'T3';
}

// ── CLI entrypoint ───────────────────────────────────────────────────────
// Usage: tsx scripts/ops/executor-result-validate.ts resolve-check-name <event-name>
// Invoked by executor-result-validator.yml so the check name the workflow
// uses is always the same tested definition as resolveCheckName() above —
// never a duplicated/hand-copied literal that could drift from it.

import { fileURLToPath } from 'node:url';

function main(): void {
  const [command, arg] = process.argv.slice(2);
  if (command === 'resolve-check-name') {
    if (!arg) {
      console.error('Usage: executor-result-validate.ts resolve-check-name <event-name>');
      process.exit(1);
    }
    process.stdout.write(resolveCheckName(arg));
    return;
  }
  console.error(`Unknown command: "${command}". Expected: resolve-check-name <event-name>`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
