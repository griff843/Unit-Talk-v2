/**
 * pre-merge-authorization — mandatory pre-merge authorization gate (UTV2-1592)
 *
 * Re-evaluates required GitHub checks and the pm-verdict/v1 approval comment
 * against a PR's CURRENT LIVE head SHA, immediately before a merge command is
 * allowed to run. This exists because a prior lane's incident showed that
 * static/branch-snapshot proof can go stale between "the decision was made"
 * and "the merge actually ran" -- a check can go missing, or a new commit can
 * land, after approval was granted but before `gh pr merge` executes.
 *
 * Design constraints (see docs/06_status/lanes/UTV2-1592.json for the
 * PM-approved outcome contract):
 *   - Reuses truth-check-lib.ts's exported GitHub-fetching primitives and
 *     evaluateRequiredChecksWithHeadFallback -- does not reimplement check
 *     matching.
 *   - Reuses merge-gate-verdict.cjs's parseVerdict/validateT1Verdicts (the
 *     same schema-and-staleness validator merge-gate.yml itself uses) via
 *     createRequire, since that file is CommonJS.
 *   - `mergeSha` is always passed as null and `allowAdminMergeGateBypass` is
 *     always false: the admin-merge-gate-bypass path exists ONLY for
 *     retroactive post-merge truth-check and must never apply pre-merge.
 *   - Matches the required context "Merge Gate" by exact string identity.
 *     "Merge Gate Evaluator" (the job name) is never accepted as a
 *     substitute -- evaluateRequiredCheckResults already matches by exact
 *     context/name, so this falls out of reusing it rather than requiring
 *     new matching logic.
 *   - The PR's head SHA is fetched as the LAST step before the authorization
 *     decision is returned, specifically so a last-second push between "the
 *     other fetches ran" and "the decision was made" is still caught.
 *
 * This module is invoked from scripts/ops/merge-wrapper.ts's `pr-merge`
 * branch via a synchronous subprocess call (`pnpm exec tsx
 * scripts/ops/pre-merge-authorization.ts`), NOT via a direct in-process
 * import: runMergeWrapper's public contract is synchronous (its result is
 * consumed synchronously by scripts/ops/ops-merge-wrapper.ts, out of this
 * lane's file scope), while this module's core logic is inherently
 * asynchronous (it re-fetches live GitHub state). The CLI entry point below
 * is what bridges the two: it prints the authorization receipt as JSON to
 * stdout and exits 0 when authorized, 1 otherwise.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  evaluateRequiredChecksWithHeadFallback,
  fetchCommitChecks,
  fetchGitHubPullRequest,
  fetchGitHubPullRequestComments,
  fetchRequiredChecks,
  parsePullRequestUrl,
  type CommitCheckResult,
  type RequiredCheckIdentity,
} from './truth-check-lib.js';
import {
  emitJson,
  getFlag,
  parseArgs,
  readConfiguredEnvValue,
} from './shared.js';

const require = createRequire(import.meta.url);
const mergeGateVerdict = require('./merge-gate-verdict.cjs') as {
  parseVerdict: (body: string | null | undefined) => ParsedPmVerdict | null;
  validateT1Verdicts: (
    verdicts: Array<{
      user: string | null;
      userType: string | null;
      parsed: ParsedPmVerdict;
      createdAt: string;
    }>,
    ctx: { prNumber: number; headSha: string; authorizedReviewers: Set<string> },
  ) => string[];
};
const { parseVerdict, validateT1Verdicts } = mergeGateVerdict;

interface ParsedPmVerdict {
  verdict: 'APPROVED' | 'CHANGES_REQUIRED';
  issueId: string;
  prNumber: number | null;
  headSha: string | null;
}

type PullRequestComment = Awaited<ReturnType<typeof fetchGitHubPullRequestComments>>[number];

// Must match the CODEOWNERS-derived reviewer set merge-gate.yml and
// truth-check-lib.ts's own PM_VERDICT_CODEOWNERS use. Kept as a local
// constant rather than importing truth-check-lib's private set, since that
// set is not part of this lane's declared export surface.
const AUTHORIZED_PM_REVIEWERS = new Set(['griff843']);

export interface PreMergeAuthorizationInput {
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
}

export interface PullRequestAuthorizationState {
  /** The PR's CURRENT live head SHA, or null when it could not be resolved. */
  headSha: string | null;
  /** The PR's label names, used to resolve the merge-authority tier. */
  labels: string[];
}

export interface PreMergeAuthorizationDeps {
  /**
   * Fetches the PR's CURRENT live head SHA *and* its labels in one call.
   * Called last, closest to the decision. Preferred over `fetchHeadSha`:
   * the tier that decides whether a pm-verdict is required must be read from
   * the same instant as the head SHA it is being evaluated against.
   */
  fetchPullRequestState?: (
    input: PreMergeAuthorizationInput,
  ) => Promise<PullRequestAuthorizationState>;
  /**
   * Legacy head-SHA-only fetch. Still honoured so existing callers/fixtures
   * keep working, but it surfaces no labels, so the tier resolves to null and
   * this module falls back to REQUIRING a pm-verdict (see
   * `pmVerdictRequiredForTier`). Prefer `fetchPullRequestState`.
   *
   * @deprecated Use `fetchPullRequestState`.
   */
  fetchHeadSha?: (input: PreMergeAuthorizationInput) => Promise<string | null>;
  /** Fetches the required-check context list from branch protection. */
  fetchRequiredCheckContexts?: (input: PreMergeAuthorizationInput) => Promise<RequiredCheckIdentity[]>;
  /** Fetches check-run/status evidence for a specific commit SHA. */
  fetchChecksForSha?: (
    input: PreMergeAuthorizationInput & { sha: string; requiredChecks: RequiredCheckIdentity[] },
  ) => Promise<CommitCheckResult>;
  /** Fetches the PR's issue comments (to locate the latest pm-verdict/v1). */
  fetchComments?: (input: PreMergeAuthorizationInput) => Promise<PullRequestComment[]>;
}

export interface RequiredCheckReceiptEntry {
  context: string;
  matched: boolean;
  source: 'status' | 'check_run' | null;
  candidateId: number | null;
  conclusion: string | null;
  passed: boolean;
}

export interface PmVerdictReceipt {
  commentUrl: string | null;
  parsedHeadSha: string | null;
  valid: boolean;
}

export type MergeAuthorityTier = 'T1' | 'T2' | 'T3';

/**
 * Resolves the merge-authority tier from a PR's label names, using the same
 * `tier:T[123]` convention every other tier consumer in this repo reads
 * (scripts/ops/executor-result-validate.ts's resolveTier, merge-gate.yml).
 * Returns null when no tier label is present.
 */
export function resolveTierFromLabels(labels: string[]): MergeAuthorityTier | null {
  const tierLabel = labels.find((label) => /^tier:T[123]$/i.test(label));
  return tierLabel ? (tierLabel.split(':')[1]!.toUpperCase() as MergeAuthorityTier) : null;
}

/**
 * Whether a schema-valid pm-verdict/v1 comment is REQUIRED for this tier.
 *
 * Per CLAUDE.md's Verification-expectations table, only T1 requires a
 * pm-verdict/v1 APPROVED comment. T2 is satisfied by a GitHub review approval
 * OR a verdict, and T3 needs neither -- and "Merge Gate", which is already one
 * of the four required checks this module evaluates, is the ratified single
 * source of truth that encodes that per-tier OR-logic. Re-requiring a verdict
 * here for T2/T3 double-gates them against a rule that does not apply.
 *
 * Unknown tier (null) fails CLOSED: absent a proven T2/T3 classification this
 * returns true, so a PR with a missing or malformed tier label is held to the
 * strictest rule rather than silently relaxed. Only a *proven* T2/T3 relaxes.
 */
export function pmVerdictRequiredForTier(tier: MergeAuthorityTier | null): boolean {
  return tier !== 'T2' && tier !== 'T3';
}

export interface TierReceipt {
  /** Resolved tier, or null when no `tier:T[123]` label was present. */
  resolved: MergeAuthorityTier | null;
  /** Where the tier came from -- 'pr_labels', or 'unresolved' when absent. */
  source: 'pr_labels' | 'unresolved';
  /** Whether a valid pm-verdict/v1 was required to authorize this merge. */
  pmVerdictRequired: boolean;
}

/**
 * The authorization-receipt schema. Keep this shape stable -- it is the
 * artifact both merge-wrapper.ts's gate and this module's CLI/tests key on.
 */
export interface PreMergeAuthorizationReceipt {
  prNumber: number;
  headSha: string;
  requiredChecks: RequiredCheckReceiptEntry[];
  pmVerdict: PmVerdictReceipt;
  /** Tier resolution and whether it required a pm-verdict. Diagnostic + auditable. */
  tier: TierReceipt;
  authorized: boolean;
  reason?: string;
}

function buildPmVerdictReceipt(
  comments: PullRequestComment[],
  ctx: { prNumber: number; headSha: string },
): { pmVerdict: PmVerdictReceipt; errors: string[] } {
  const verdicts = comments
    .map((comment) => ({
      user: comment.user?.login ?? null,
      userType: comment.user?.type ?? null,
      parsed: parseVerdict(comment.body ?? null),
      createdAt: comment.created_at ?? '',
      htmlUrl: comment.html_url ?? null,
    }))
    .filter(
      (entry): entry is typeof entry & { parsed: ParsedPmVerdict } => entry.parsed !== null,
    );

  const errors = validateT1Verdicts(
    verdicts.map(({ user, userType, parsed, createdAt }) => ({ user, userType, parsed, createdAt })),
    { prNumber: ctx.prNumber, headSha: ctx.headSha, authorizedReviewers: AUTHORIZED_PM_REVIEWERS },
  );

  // Prefer the latest AUTHORIZED verdict for the receipt's display fields --
  // that is the one validateT1Verdicts itself actually evaluated. Fall back
  // to the raw latest parsed comment only so an all-unauthorized fixture
  // still surfaces something diagnostic instead of nulling everything out.
  const authorizedVerdicts = verdicts.filter(
    (entry) => entry.userType !== 'Bot' && AUTHORIZED_PM_REVIEWERS.has(entry.user ?? ''),
  );
  const latest = authorizedVerdicts.at(-1) ?? verdicts.at(-1) ?? null;

  return {
    pmVerdict: {
      commentUrl: latest?.htmlUrl ?? null,
      parsedHeadSha: latest?.parsed.headSha ?? null,
      valid: errors.length === 0,
    },
    errors,
  };
}

/**
 * Evaluates whether a PR is authorized to merge RIGHT NOW: required checks
 * must be green on the PR's live head SHA (exact-identity match, no admin
 * bypass), and the latest pm-verdict/v1 comment must be a schema-valid
 * APPROVED verdict bound to that same live head SHA.
 *
 * The head-SHA fetch happens LAST -- after required checks and comments have
 * already been fetched -- so it reflects the freshest possible state right
 * before the caller is told whether it may proceed to actually merge.
 */
export async function evaluatePreMergeAuthorization(
  input: PreMergeAuthorizationInput,
  deps: PreMergeAuthorizationDeps = {},
): Promise<PreMergeAuthorizationReceipt> {
  const fetchRequiredCheckContexts =
    deps.fetchRequiredCheckContexts ??
    (({ owner, repo, token }: PreMergeAuthorizationInput) => fetchRequiredChecks(owner, repo, token));
  const fetchChecksForSha =
    deps.fetchChecksForSha ??
    ((args: PreMergeAuthorizationInput & { sha: string; requiredChecks: RequiredCheckIdentity[] }) =>
      fetchCommitChecks({
        owner: args.owner,
        repo: args.repo,
        sha: args.sha,
        token: args.token,
        requiredChecks: args.requiredChecks,
      }));
  const fetchComments =
    deps.fetchComments ??
    (({ owner, repo, prNumber, token }: PreMergeAuthorizationInput) =>
      fetchGitHubPullRequestComments(owner, repo, prNumber, token));
  // A caller that supplied only the legacy head-SHA fetch gets no labels, so
  // the tier stays unresolved and pmVerdictRequiredForTier() holds the PR to
  // the strict rule. That is deliberate: never relax on absent data.
  const fetchPullRequestState =
    deps.fetchPullRequestState ??
    (deps.fetchHeadSha
      ? async (args: PreMergeAuthorizationInput): Promise<PullRequestAuthorizationState> => ({
          headSha: await deps.fetchHeadSha!(args),
          labels: [],
        })
      : async ({
          owner,
          repo,
          prNumber,
          token,
        }: PreMergeAuthorizationInput): Promise<PullRequestAuthorizationState> => {
          const pullRequest = await fetchGitHubPullRequest(owner, repo, prNumber, token);
          return {
            headSha: pullRequest.head?.sha ?? null,
            labels: (pullRequest.labels ?? [])
              .map((label) => label?.name)
              .filter((name): name is string => typeof name === 'string'),
          };
        });

  // Fetches that do not depend on the live head SHA go first.
  const requiredChecks = await fetchRequiredCheckContexts(input);
  const comments = await fetchComments(input);

  // Race-prevention: fetch the live head SHA LAST, as close as possible to
  // the authorization decision, so a push landing after the checks/comments
  // fetches above is still caught rather than evaluated against stale state.
  // Labels ride along on the same fetch so the tier and the head SHA are read
  // from one instant -- a relabel racing the decision cannot split them.
  const { headSha, labels } = await fetchPullRequestState(input);
  const tier = resolveTierFromLabels(labels);
  const verdictRequired = pmVerdictRequiredForTier(tier);
  const tierReceipt: TierReceipt = {
    resolved: tier,
    source: tier ? 'pr_labels' : 'unresolved',
    pmVerdictRequired: verdictRequired,
  };

  if (!headSha) {
    return {
      prNumber: input.prNumber,
      headSha: '',
      requiredChecks: [],
      pmVerdict: { commentUrl: null, parsedHeadSha: null, valid: false },
      tier: tierReceipt,
      authorized: false,
      reason: "could not resolve the pull request's current head SHA",
    };
  }

  const requiredCheckResult = await evaluateRequiredChecksWithHeadFallback({
    mergeSha: null,
    headSha,
    requiredChecks,
    // Hard requirement: the admin-merge-gate-bypass path is for retroactive
    // post-merge truth-check only. It must never apply here.
    allowAdminMergeGateBypass: false,
    fetchChecks: (sha) => fetchChecksForSha({ ...input, sha, requiredChecks }),
  });

  const { pmVerdict, errors: verdictErrors } = buildPmVerdictReceipt(comments, {
    prNumber: input.prNumber,
    headSha,
  });

  const receiptChecks: RequiredCheckReceiptEntry[] = (requiredCheckResult.evidence ?? []).map((entry) => ({
    context: entry.context,
    matched: entry.matched,
    source: entry.source,
    candidateId: entry.candidate_id,
    conclusion: entry.conclusion,
    passed: entry.passed,
  }));

  const reasons: string[] = [];
  if (!requiredCheckResult.passed) {
    reasons.push(
      `required checks missing or failing on head ${headSha}: ${requiredCheckResult.missing.join(', ')}`,
    );
  }
  // Verdict defects only block when the tier actually requires a verdict.
  // On T2/T3 they are still recorded in the receipt's pmVerdict block for
  // diagnostics, but they are not merge-blocking reasons -- surfacing a
  // T1-only failure message on a T2 PR is the exact defect this lane fixes
  // (observed live on a T2 PR whose four required checks were all green).
  if (verdictErrors.length > 0 && verdictRequired) {
    reasons.push(...verdictErrors);
  }

  const authorized = requiredCheckResult.passed && (!verdictRequired || pmVerdict.valid);

  return {
    prNumber: input.prNumber,
    headSha,
    requiredChecks: receiptChecks,
    pmVerdict,
    tier: tierReceipt,
    authorized,
    ...(reasons.length > 0 ? { reason: reasons.join(' | ') } : {}),
  };
}

interface CliInput {
  prUrl?: string;
  owner?: string;
  repo?: string;
  pr?: string;
}

function cliInput(argv: string[]): CliInput {
  const { flags } = parseArgs(argv);
  return {
    prUrl: getFlag(flags, 'pr-url'),
    owner: getFlag(flags, 'owner'),
    repo: getFlag(flags, 'repo'),
    pr: getFlag(flags, 'pr'),
  };
}

async function runCli(): Promise<void> {
  const parsed = cliInput(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN?.trim() || readConfiguredEnvValue('GITHUB_TOKEN');

  if (!token) {
    emitJson({
      authorized: false,
      reason: 'GITHUB_TOKEN is required',
      prNumber: null,
      headSha: null,
      requiredChecks: [],
      pmVerdict: { commentUrl: null, parsedHeadSha: null, valid: false },
      tier: { resolved: null, source: 'unresolved', pmVerdictRequired: true },
    });
    process.exitCode = 1;
    return;
  }

  let owner: string;
  let repo: string;
  let prNumber: number;

  if (parsed.prUrl) {
    const ref = parsePullRequestUrl(parsed.prUrl);
    owner = ref.owner;
    repo = ref.repo;
    prNumber = ref.number;
  } else if (parsed.owner && parsed.repo && parsed.pr) {
    owner = parsed.owner;
    repo = parsed.repo;
    prNumber = Number.parseInt(parsed.pr, 10);
  } else {
    emitJson({
      authorized: false,
      reason:
        'Usage: pre-merge-authorization.ts --pr-url <github-pr-url> OR --owner <owner> --repo <repo> --pr <number>',
    });
    process.exitCode = 1;
    return;
  }

  if (!Number.isFinite(prNumber)) {
    emitJson({ authorized: false, reason: `Invalid --pr value: ${parsed.pr ?? ''}` });
    process.exitCode = 1;
    return;
  }

  const receipt = await evaluatePreMergeAuthorization({ owner, repo, prNumber, token });
  emitJson(receipt);
  process.exitCode = receipt.authorized ? 0 : 1;
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  void runCli().catch((error) => {
    emitJson({
      authorized: false,
      reason: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    process.exitCode = 1;
  });
}
