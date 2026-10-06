/**
 * Pure, testable core of executor-result validation.
 *
 * WORK-2026100501: required results are native Actions job results from an
 * eligible pull_request run. Comment and manual events only request a retry
 * of that original exact-head run; they never manufacture a check run.
 */

export const REQUIRED_CHECK_NAME = 'Executor Result Validation';
export const REFRESH_CHECK_NAME = 'Refresh Executor Result Validation';

export type PublicationAction = 'publish-native' | 'request-refresh' | 'ignore';

/** Resolves what an event may do to the required result. */
export function resolvePublicationAction(eventName: string, commentBody = ''): PublicationAction {
  if (eventName === 'pull_request') return 'publish-native';
  if (eventName === 'workflow_dispatch') return 'request-refresh';
  if (eventName === 'issue_comment' && commentBody.includes('EXECUTOR_RESULT:')) return 'request-refresh';
  return 'ignore';
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
/**
 * Issue-ID and branch shapes an executor result may declare.
 *
 * UTV2-1688: these two literals are DUPLICATED, on purpose, in
 * `.github/workflows/executor-result-validator.yml` -- an `actions/github-script`
 * `script:` block is a YAML string and cannot import this module, and the copy
 * inline in that workflow is the one that actually gates merges. The duplication
 * had already drifted once (the `bootstrap/` namespace was added to neither), so
 * `executor-result-validate.test.ts` now reads the workflow and asserts both
 * literals are byte-identical to these. Change one and the suite goes red.
 *
 * Widening a namespace is deliberately the ONLY thing these express. Every
 * binding rule below -- `Branch:` equals the PR head ref, the declared PR equals
 * the actual PR, the declared head SHA equals the current head -- is unchanged,
 * so a wider namespace can never stand in for a weaker attestation.
 */
export const EXECUTOR_RESULT_ISSUE_ID_RE = /^(UTV2|UNI|WORK)-\d+$/i;
export const EXECUTOR_RESULT_BRANCH_RE = /^(claude|codex|bootstrap)\/(utv2|uni|work)-\d+/i;

export function validateExecutorResultFields(r: ParsedExecutorResult, ctx: ValidationContext): string[] {
  const errors: string[] = [];

  if (!r.issueId || !EXECUTOR_RESULT_ISSUE_ID_RE.test(r.issueId)) {
    errors.push(`Invalid Issue ID: "${r.issueId || '<missing>'}". Must match UTV2-NNN, UNI-NNN or WORK-NNN.`);
  }

  if (!r.lane || !['claude', 'codex'].includes(r.lane.toLowerCase())) {
    errors.push(`Invalid Lane: "${r.lane || '<missing>'}". Must be "claude" or "codex".`);
  }

  if (!r.branch || !EXECUTOR_RESULT_BRANCH_RE.test(r.branch)) {
    errors.push(
      `Invalid branch: "${r.branch || '<missing>'}". Must match claude/, codex/ or bootstrap/ followed by utv2-NNN-*, uni-NNN-* or work-NNN-*.`,
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
// Usage: tsx scripts/ops/executor-result-validate.ts resolve-publication-action <event-name> [comment-body]

import { fileURLToPath } from 'node:url';

function main(): void {
  const [command, arg] = process.argv.slice(2);
  if (command === 'resolve-publication-action') {
    if (!arg) {
      console.error('Usage: executor-result-validate.ts resolve-publication-action <event-name> [comment-body]');
      process.exit(1);
    }
    process.stdout.write(resolvePublicationAction(arg, process.argv.slice(4).join(' ')));
    return;
  }
  console.error(`Unknown command: "${command}". Expected: resolve-publication-action <event-name> [comment-body]`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
