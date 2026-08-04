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
  /** The PR's label names -- mirrored evidence only, never the tier authority. */
  labels: string[];
  /** The PR's head branch name, used to locate the lane manifest. */
  headRef: string | null;
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
  /**
   * Reads the lane manifest for `issueId` at the PR's head SHA -- the
   * AUTHORITATIVE tier source. Returning null means "could not establish the
   * lane's tier", which fails closed to requiring a pm-verdict.
   */
  fetchLaneManifestAtHead?: (
    input: PreMergeAuthorizationInput & { issueId: string; headSha: string },
  ) => Promise<{ tier?: unknown } | null>;
}

/**
 * Extracts the lane issue id from a branch name (`codex/utv2-1661-slug` ->
 * `UTV2-1661`), which is how the manifest path is located.
 */
export function issueIdFromHeadRef(headRef: string): string | null {
  const match = /^(?:[a-z][a-z0-9-]*)\/(utv2|uni)-(\d+)(?:-|$)/i.exec(headRef);
  return match ? `${match[1]!.toUpperCase()}-${match[2]}` : null;
}

/**
 * True only when the exact `Merge Gate` context is present in the evidence for
 * THIS head and passed. An omitted context, an empty evidence set, an
 * unmatched entry, or a non-passing result all return false -- the caller then
 * keeps the verdict requirement in force.
 */
export function isMergeGateGreenOnHead(
  evidence: Array<{ context: string; matched: boolean; passed: boolean }> | null | undefined,
): boolean {
  if (!Array.isArray(evidence) || evidence.length === 0) return false;
  const entries = evidence.filter((entry) => entry.context === MERGE_GATE_CONTEXT);
  // Exactly one authoritative entry; zero means discovery omitted it, more than
  // one means the identity is ambiguous. Both fail closed.
  if (entries.length !== 1) return false;
  return entries[0]!.matched === true && entries[0]!.passed === true;
}

/**
 * Raised when the lane manifest could not be READ at the head. Distinct from
 * "the manifest is confirmed absent": absence is a knowable fact that resolves
 * the tier to null (strict), whereas an unreadable manifest is an UNKNOWN and
 * must never be mistaken for absence.
 */
export class LaneManifestLookupError extends Error {
  readonly code = 'lane_manifest_lookup_failed';
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'LaneManifestLookupError';
  }
}

/**
 * True only for a GitHub contents-API failure that positively proves the
 * manifest is absent at that ref. Auth loss, rate limiting, network failure and
 * 5xx are UNKNOWN, never absence. Mirrors the same discrimination the lane
 * governor applies, for the same reason.
 */
export function isConfirmedManifestAbsent(message: string, status: number | null): boolean {
  const text = (message || '').toLowerCase();
  if (status !== 404 && !/\b404\b/.test(text)) return false;
  if (/\b(401|403|429|5\d{2})\b/.test(text)) return false;
  if (/bad credentials|rate limit|abuse detection|could not resolve|timeout|timed out|connection reset|network|socket hang up/.test(text)) {
    return false;
  }
  return true;
}

/**
 * Decodes a contents-API payload into a lane manifest and checks that it is the
 * manifest it claims to be. A manifest whose `issue_id` does not match the id
 * derived from the head ref is a mis-binding, not a tier source, and is
 * rejected rather than trusted.
 */
export function decodeLaneManifestPayload(
  payload: { content?: unknown; encoding?: unknown },
  expectedIssueId: string,
): { tier?: unknown } {
  if (typeof payload?.content !== 'string' || payload.content.length === 0) {
    throw new LaneManifestLookupError(
      `The contents API returned no body for ${expectedIssueId}'s manifest; refusing to infer a tier from it.`,
    );
  }

  let decoded: string;
  try {
    decoded = Buffer.from(payload.content, 'base64').toString('utf8');
  } catch (error) {
    throw new LaneManifestLookupError(`Base64 decoding failed for ${expectedIssueId}'s manifest.`, error);
  }

  let parsed: { issue_id?: unknown; tier?: unknown };
  try {
    parsed = JSON.parse(decoded) as typeof parsed;
  } catch (error) {
    throw new LaneManifestLookupError(
      `${expectedIssueId}'s manifest at the PR head is not valid JSON; a malformed manifest is an unknown tier, not a T2/T3 one.`,
      error,
    );
  }

  if (typeof parsed.issue_id !== 'string' || parsed.issue_id.toUpperCase() !== expectedIssueId) {
    throw new LaneManifestLookupError(
      `Manifest identity mismatch: expected issue_id "${expectedIssueId}", manifest declares "${String(parsed.issue_id)}".`,
    );
  }

  return parsed;
}

/**
 * Production reader for the authoritative tier: fetches
 * docs/06_status/lanes/<ISSUE>.json at the PR's EXACT current head SHA.
 *
 * Pinning to the head SHA (not the branch name) matters -- a branch ref moves,
 * and the whole point of this module is that the decision is bound to the head
 * it was made against.
 *
 * Returns null only for a CONFIRMED absence, which resolves the tier to
 * unresolved and therefore keeps the strict pm-verdict requirement. Every other
 * failure throws LaneManifestLookupError, which the caller also treats as
 * strict -- so both branches fail closed, and neither can relax the gate.
 */
export async function defaultFetchLaneManifestAtHead(
  input: PreMergeAuthorizationInput & { issueId: string; headSha: string },
): Promise<{ tier?: unknown } | null> {
  const { owner, repo, token, issueId, headSha } = input;
  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/` +
    `docs/06_status/lanes/${issueId}.json?ref=${encodeURIComponent(headSha)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'unit-talk-pre-merge-authorization',
      },
    });
  } catch (error) {
    throw new LaneManifestLookupError(
      `Network failure reading ${issueId}'s manifest at ${headSha}: ${(error as Error)?.message ?? 'unknown'}`,
      error,
    );
  }

  if (response.status === 404) {
    // Confirmed absent: this PR head carries no manifest for that id. The tier
    // stays unresolved, which keeps the verdict requirement in force.
    return null;
  }

  if (!response.ok) {
    throw new LaneManifestLookupError(
      `Reading ${issueId}'s manifest at ${headSha} failed with HTTP ${response.status}. ` +
        'Refusing to treat an unreadable manifest as a T2/T3 classification.',
    );
  }

  let payload: { content?: unknown; encoding?: unknown };
  try {
    payload = (await response.json()) as typeof payload;
  } catch (error) {
    throw new LaneManifestLookupError(
      `The contents API response for ${issueId} at ${headSha} was not valid JSON.`,
      error,
    );
  }

  return decodeLaneManifestPayload(payload, issueId);
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

/** The exact required-check context whose green state may relax T2/T3. */
export const MERGE_GATE_CONTEXT = 'Merge Gate';

function normalizeTier(value: string | null | undefined): MergeAuthorityTier | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return upper === 'T1' || upper === 'T2' || upper === 'T3' ? upper : null;
}

/**
 * Reads the tier from a PR's label names (`tier:T[123]`).
 *
 * UTV2-1661 correction round: labels are MIRRORED EVIDENCE ONLY. A label is
 * mutable by anyone with write access and is not lane truth, so it must never
 * be the authority that relaxes a verdict requirement. It is used here solely
 * to cross-check the manifest and to fail closed on disagreement.
 */
export function resolveTierFromLabels(labels: string[]): MergeAuthorityTier | null {
  const tierLabel = labels.find((label) => /^tier:T[123]$/i.test(label));
  return tierLabel ? normalizeTier(tierLabel.split(':')[1]) : null;
}

/** Reads the authoritative tier from the lane manifest at the PR head. */
export function resolveTierFromManifest(manifest: { tier?: unknown } | null): MergeAuthorityTier | null {
  return normalizeTier(typeof manifest?.tier === 'string' ? manifest.tier : null);
}

/**
 * Decides whether a schema-valid pm-verdict/v1 comment is REQUIRED.
 *
 * Per CLAUDE.md, only T1 requires a pm-verdict/v1 APPROVED comment; T2 is
 * satisfied by a GitHub review approval OR a verdict, and T3 by green CI plus a
 * valid executor result. "Merge Gate" is the ratified encoder of that per-tier
 * OR-logic, so re-requiring a verdict here double-gates T2/T3.
 *
 * Three independent conditions must ALL hold before the requirement relaxes:
 *
 *  1. the AUTHORITATIVE tier (lane manifest at the PR head) is T2 or T3;
 *  2. the mirrored label tier does not DISAGREE with it -- a disagreement means
 *     one of the two is stale and the classification is unproven;
 *  3. the exact `Merge Gate` context is present and green ON THE CURRENT HEAD.
 *
 * Condition 3 closes the relabel/check race: without it, a PR could be
 * downgraded to T2 after a green run and skip the verdict on evidence that
 * never evaluated the current tier. If required-check discovery omits
 * `Merge Gate`, returns an empty set, or cannot bind the check to this head,
 * the requirement stays in force. Every unknown fails CLOSED.
 */
export function pmVerdictRequiredForTier(input: {
  manifestTier: MergeAuthorityTier | null;
  labelTier: MergeAuthorityTier | null;
  mergeGateGreenOnHead: boolean;
}): boolean {
  const { manifestTier, labelTier, mergeGateGreenOnHead } = input;
  if (manifestTier !== 'T2' && manifestTier !== 'T3') return true;
  if (labelTier !== null && labelTier !== manifestTier) return true;
  if (!mergeGateGreenOnHead) return true;
  return false;
}

export interface TierReceipt {
  /** Authoritative tier from the lane manifest at the PR head. */
  resolved: MergeAuthorityTier | null;
  /** Where the authority came from. */
  source: 'lane_manifest' | 'unresolved';
  /** Mirrored, non-authoritative label tier -- recorded for cross-check only. */
  labelTier: MergeAuthorityTier | null;
  /** True when the label contradicts the manifest (forces the strict path). */
  labelDisagreement: boolean;
  /** Whether the exact `Merge Gate` context was green on the current head. */
  mergeGateGreenOnHead: boolean;
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
          headRef: null,
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
            headRef: pullRequest.head?.ref ?? null,
          };
        });

  const fetchLaneManifestAtHead = deps.fetchLaneManifestAtHead ?? defaultFetchLaneManifestAtHead;

  // Fetches that do not depend on the live head SHA go first.
  const requiredChecks = await fetchRequiredCheckContexts(input);
  const comments = await fetchComments(input);

  // Race-prevention: fetch the live head SHA LAST, as close as possible to
  // the authorization decision, so a push landing after the checks/comments
  // fetches above is still caught rather than evaluated against stale state.
  // Labels ride along on the same fetch so the tier and the head SHA are read
  // from one instant -- a relabel racing the decision cannot split them.
  const { headSha, labels, headRef } = await fetchPullRequestState(input);
  const labelTier = resolveTierFromLabels(labels);

  if (!headSha) {
    return {
      prNumber: input.prNumber,
      headSha: '',
      requiredChecks: [],
      pmVerdict: { commentUrl: null, parsedHeadSha: null, valid: false },
      tier: {
        resolved: null,
        source: 'unresolved',
        labelTier,
        labelDisagreement: false,
        mergeGateGreenOnHead: false,
        pmVerdictRequired: true,
      },
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
  // Authoritative tier comes from the lane manifest AT THIS HEAD, never from
  // the mutable PR label. Any failure to read it leaves manifestTier null,
  // which fails closed to requiring a verdict.
  let manifestTier: MergeAuthorityTier | null = null;
  const issueId = headRef ? issueIdFromHeadRef(headRef) : null;
  if (issueId) {
    try {
      manifestTier = resolveTierFromManifest(
        await fetchLaneManifestAtHead({ ...input, issueId, headSha }),
      );
    } catch {
      manifestTier = null;
    }
  }

  const mergeGateGreenOnHead = isMergeGateGreenOnHead(receiptChecks);
  const verdictRequired = pmVerdictRequiredForTier({
    manifestTier,
    labelTier,
    mergeGateGreenOnHead,
  });
  const tierReceipt: TierReceipt = {
    resolved: manifestTier,
    source: manifestTier ? 'lane_manifest' : 'unresolved',
    labelTier,
    labelDisagreement: labelTier !== null && manifestTier !== null && labelTier !== manifestTier,
    mergeGateGreenOnHead,
    pmVerdictRequired: verdictRequired,
  };

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
      tier: {
        resolved: null,
        source: 'unresolved',
        labelTier: null,
        labelDisagreement: false,
        mergeGateGreenOnHead: false,
        pmVerdictRequired: true,
      },
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
