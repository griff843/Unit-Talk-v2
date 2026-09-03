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

export interface CheckNameOptions {
  /**
   * RMA/v1 PHASE 1 only: the trusted base checkout does not yet carry
   * scripts/ops/merge-authority.cjs.
   *
   * The required "Executor Result Validation" context is created only by
   * issue_comment / workflow_dispatch runs, and those events run the workflow
   * file from the *default branch* -- not from the PR head. So for the single
   * PR that first lands RMA, the required context is produced entirely by
   * main's pre-RMA validator, which rejects any branch outside
   * `(claude|codex)/(utv2|uni)-NNN`. No comment, label or verdict can clear
   * that, and the PR carrying the fix cannot install it before being judged by
   * it: a genuine bootstrap deadlock whose only other exit is a repo-owner
   * override of a required check.
   *
   * The exit that does not need an override: while the classifier is absent
   * from base, the pull_request-triggered run -- the one event whose workflow
   * file *does* come from the PR head -- creates the required context itself.
   * It is self-extinguishing. Once merge-authority.cjs is on main the
   * condition is false forever after, and UTV2-1550's one-authoritative-
   * identity rule below is restored in full. Re-entering it means deleting the
   * classifier from main, which is itself a merge-authority-surface change.
   */
  bootstrap?: boolean;
}

/** Resolves the check-run name for a given triggering event. */
export function resolveCheckName(eventName: string, opts: CheckNameOptions = {}): string {
  if (eventName !== 'pull_request') return REQUIRED_CHECK_NAME;
  return opts.bootstrap ? REQUIRED_CHECK_NAME : PREFLIGHT_CHECK_NAME;
}

/** True only for the event types that may create the required context. */
export function isRequiredCheckName(eventName: string, opts: CheckNameOptions = {}): boolean {
  return resolveCheckName(eventName, opts) === REQUIRED_CHECK_NAME;
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

  // RMA/v1: a Linear issue is no longer the execution primitive, so mission
  // branches carry none. Absent is fine; malformed is still a mistake.
  if (r.issueId && !/^(UTV2|UNI)-\d+$/i.test(r.issueId)) {
    errors.push(`Invalid Issue ID: "${r.issueId}". Must match UTV2-NNN or UNI-NNN when present.`);
  }

  if (!r.lane || !['claude', 'codex'].includes(r.lane.toLowerCase())) {
    errors.push(`Invalid Lane: "${r.lane || '<missing>'}". Must be "claude" or "codex".`);
  }

  // The load-bearing assertion is that the executor attests to THIS branch.
  // The old `(claude|codex)/(utv2|uni)-NNN` shape encoded the Linear coupling on
  // top of that and rejected mission branches outright.
  if (!r.branch) {
    errors.push('Branch missing from executor result.');
  } else if (r.branch !== ctx.headRef) {
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

/**
 * True when this result declares no usable proof artifact.
 *
 * Split deliberately from the question of whether one is *required*: what the
 * comment says is a property of the comment, while what the diff demands is a
 * property of the diff.
 */
export function proofArtifactMissing(r: ParsedExecutorResult): boolean {
  return (
    !r.proofPath || r.proofPath.toLowerCase() === 'ci only' || r.proofPath.toLowerCase() === 'n/a'
  );
}

/**
 * True when a proof artifact is required and absent.
 *
 * `reservedSurface` comes from scripts/ops/merge-authority.cjs — the same
 * classifier that drives Merge Gate. It replaces the previous `tier:T3` label
 * lookup, under which a missing or wrong label silently moved the evidence bar.
 * Risk is read off the diff, and no label can talk a reserved diff out of
 * carrying proof.
 */
export function proofArtifactRequired(r: ParsedExecutorResult, reservedSurface: boolean): boolean {
  return proofArtifactMissing(r) && reservedSurface;
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
      console.error('Usage: executor-result-validate.ts resolve-check-name <event-name> [--bootstrap]');
      process.exit(1);
    }
    const bootstrap = process.argv.slice(3).includes('--bootstrap');
    process.stdout.write(resolveCheckName(arg, { bootstrap }));
    return;
  }
  console.error(`Unknown command: "${command}". Expected: resolve-check-name <event-name>`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
