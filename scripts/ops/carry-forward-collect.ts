#!/usr/bin/env tsx
/**
 * UTV2-1818 — trusted evidence collector for the approval carry-forward verifier.
 *
 * `approval-carry-forward.ts` is deliberately pure: every fact is injected, which
 * is what makes each condition testable against the exact case it names. This
 * module is the other half — it *produces* those facts, and its whole job is to
 * produce them from sources a PR author cannot write.
 *
 * The trust rule, stated once:
 *
 *   - Commit graph, ancestry and changed paths come from `git`, against a fresh
 *     `git fetch origin` — never from the PR payload, never from a local ref.
 *   - Required-check conclusions come from the check-runs API at the exact head.
 *   - Approvals and withdrawals come from the issue-comments and reviews APIs,
 *     and are accepted only from a CODEOWNERS login with `user.type === 'User'`.
 *   - The ONLY comment-derived value is the approval's own `Head SHA:`, and it
 *     is not trusted as an assertion: it is re-verified as a real commit and a
 *     real ancestor of the current head via `git merge-base --is-ancestor`.
 *
 * A receipt is an OUTPUT. Nothing here reads a previously posted receipt, by
 * design — if a receipt were ever an input, anyone with comment access could
 * forge one.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import {
  REQUIRED_CONTEXTS,
  evaluateCarryForward,
  renderReceipt,
  type CarryForwardInputs,
  type CarryForwardResult,
  type ChainCommit,
  type RequiredCheck,
  type WithdrawalSignal,
} from './approval-carry-forward.ts';

const require = createRequire(import.meta.url);
const { parseVerdict } = require('./merge-gate-verdict.cjs') as {
  parseVerdict: (
    body: string,
  ) => { verdict: string; issueId: string; prNumber: number | null; headSha: string | null } | null;
};

/** Must match `.github/CODEOWNERS` and merge-gate.yml's AUTHORIZED_REVIEWERS. */
export const AUTHORIZED_REVIEWERS = new Set(['griff843']);

export interface CollectOptions {
  prNumber: number;
  issueId: string;
  /**
   * Evaluate as if the PR head were this commit. Every fact is still measured
   * from real git history and the real check-runs API at that commit — this
   * selects WHICH head the question is asked at, it does not fabricate one.
   * Used to replay a historical head against the current policy.
   */
  atSha?: string;
  /** Replay only: carry forward from the approval pinned to this exact SHA. */
  fromSha?: string;
  /** Injected in tests; defaults to the real `gh` and `git`. */
  gh?: (args: string[]) => string;
  git?: (args: string[]) => string;
}

const realGh = (args: string[]): string =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const realGit = (args: string[]): string =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export interface CollectionFailure {
  ok: false;
  reason: string;
}
export interface Collection {
  ok: true;
  inputs: CarryForwardInputs;
}

/**
 * Fail closed on every ambiguity. A collector that guesses is worse than one
 * that refuses: the verdict it feeds is a merge-authority input.
 */
export function collect(opts: CollectOptions): Collection | CollectionFailure {
  const gh = opts.gh ?? realGh;
  const git = opts.git ?? realGit;

  const pr = JSON.parse(gh(['api', `repos/{owner}/{repo}/pulls/${opts.prNumber}`])) as {
    head: { sha: string };
    base: { ref: string };
    state: string;
  };
  if (pr.state !== 'open') return { ok: false, reason: `PR #${opts.prNumber} is ${pr.state}, not open` };
  const headSha = opts.atSha ?? pr.head.sha;

  // Fetch before any ancestry question is asked. Answering "is this on main?"
  // from a stale local ref is the one mistake that would let unreviewed code
  // through, because everything else keys off it.
  git(['fetch', '--quiet', 'origin', pr.base.ref]);

  // ── The surviving approval ───────────────────────────────────────────────
  const comments = JSON.parse(
    gh(['api', '--paginate', `repos/{owner}/{repo}/issues/${opts.prNumber}/comments`]),
  ) as { body: string; created_at: string; html_url: string; user?: { login?: string; type?: string } }[];

  const authorized = comments.filter(
    (c) => c.user?.type === 'User' && AUTHORIZED_REVIEWERS.has(c.user?.login ?? ''),
  );
  const approvals = authorized
    .map((c) => ({ comment: c, parsed: parseVerdict(c.body) }))
    .filter((v) => v.parsed !== null && v.parsed.verdict === 'APPROVED')
    // A verdict naming a different PR or a different issue is not this PR's approval.
    .filter((v) => v.parsed!.prNumber === null || v.parsed!.prNumber === opts.prNumber)
    .filter((v) => v.parsed!.issueId.toUpperCase() === opts.issueId.toUpperCase())
    // When replaying a historical head, an approval pinned to that same head is
    // the one being carried forward FROM only if it predates it.
    .filter((v) => v.parsed!.headSha?.toLowerCase() !== headSha.toLowerCase())
    .filter((v) =>
      opts.fromSha ? v.parsed!.headSha?.toLowerCase() === opts.fromSha.toLowerCase() : true,
    );

  if (approvals.length === 0) {
    return { ok: false, reason: 'no pm-verdict/v1 APPROVED comment from a CODEOWNERS member' };
  }
  // The most recent approval is the surviving one. An older approval cannot
  // revive a decision a newer one superseded.
  const approval = approvals[approvals.length - 1];
  const approvedSha = approval.parsed!.headSha;
  if (!approvedSha) {
    return { ok: false, reason: 'the approval carries no Head SHA; nothing to carry forward from' };
  }

  // The comment claims a SHA. Verify it names a real commit before using it.
  try {
    git(['cat-file', '-e', `${approvedSha}^{commit}`]);
  } catch {
    return { ok: false, reason: `approved head ${approvedSha} is not a commit in this repository` };
  }
  if (approvedSha === headSha) {
    return { ok: false, reason: 'head is unchanged; the original approval still applies directly' };
  }

  const isAncestor = (a: string, b: string): boolean => {
    try {
      git(['merge-base', '--is-ancestor', a, b]);
      return true;
    } catch {
      return false;
    }
  };

  const approvedShaIsAncestor = isAncestor(approvedSha, headSha);

  // ── The commit graph ─────────────────────────────────────────────────────
  const firstParentChain: ChainCommit[] = approvedShaIsAncestor
    ? git(['rev-list', '--first-parent', '--format=%H%x00%P%x00%s', `${approvedSha}..${headSha}`])
        .split('\n')
        .filter((line) => line && !line.startsWith('commit '))
        .map((line) => {
          const [sha, parents, subject] = line.split('\0');
          return { sha, parents: parents ? parents.split(' ').filter(Boolean) : [], subject };
        })
    : [];

  const changedPaths = approvedShaIsAncestor
    ? git(['diff', '--name-only', approvedSha, headSha]).split('\n').filter(Boolean)
    : [];

  // ── Required checks at this exact head ───────────────────────────────────
  const checkRuns = JSON.parse(
    gh(['api', '--paginate', `repos/{owner}/{repo}/commits/${headSha}/check-runs?per_page=100`]),
  ) as { check_runs?: { name: string; status: string; conclusion: string | null }[] };
  const runs = checkRuns.check_runs ?? [];

  // Absent is not green. Every required context must be resolved here or C4
  // refuses — which is the correct behaviour, not a gap to paper over.
  const requiredChecks: RequiredCheck[] = REQUIRED_CONTEXTS.map((context) => {
    const matching = runs.filter((r) => r.name === context);
    const latest = matching[matching.length - 1];
    return {
      context,
      conclusion: latest && latest.status === 'completed' ? latest.conclusion : null,
    };
  });

  // ── Withdrawals after the approval ───────────────────────────────────────
  const withdrawals: WithdrawalSignal[] = [];
  for (const c of authorized) {
    if (c.created_at <= approval.comment.created_at) continue;
    const parsed = parseVerdict(c.body);
    if (parsed && parsed.verdict !== 'APPROVED') {
      withdrawals.push({
        source: 'pm-verdict',
        createdAt: c.created_at,
        detail: `${parsed!.verdict} at ${c.html_url}`,
      });
    }
  }
  const reviews = JSON.parse(
    gh(['api', '--paginate', `repos/{owner}/{repo}/pulls/${opts.prNumber}/reviews`]),
  ) as { state: string; submitted_at: string; html_url: string; user?: { login?: string; type?: string } }[];
  for (const r of reviews) {
    if (r.user?.type !== 'User' || !AUTHORIZED_REVIEWERS.has(r.user?.login ?? '')) continue;
    if (r.state !== 'CHANGES_REQUESTED') continue;
    if (r.submitted_at <= approval.comment.created_at) continue;
    withdrawals.push({ source: 'github-review', createdAt: r.submitted_at, detail: r.html_url });
  }

  return {
    ok: true,
    inputs: {
      issueId: opts.issueId,
      headSha,
      approvedSha,
      approvedAt: approval.comment.created_at,
      approvalCommentUrl: approval.comment.html_url,
      firstParentChain,
      isAncestorOfMain: (sha: string) => isAncestor(sha, `origin/${pr.base.ref}`),
      approvedShaIsAncestor,
      changedPaths,
      requiredChecks,
      withdrawals,
    },
  };
}

export function collectAndEvaluate(opts: CollectOptions): CarryForwardResult | CollectionFailure {
  const collected = collect(opts);
  if (!collected.ok) return collected;
  return evaluateCarryForward(collected.inputs);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const prNumber = Number(args[args.indexOf('--pr') + 1]);
  const issueId = args[args.indexOf('--issue') + 1];
  const atAt = args.indexOf('--at');
  const atSha = atAt === -1 ? undefined : args[atAt + 1];
  const fromAt = args.indexOf('--from');
  const fromSha = fromAt === -1 ? undefined : args[fromAt + 1];
  if (!Number.isFinite(prNumber) || !issueId) {
    console.error('usage: carry-forward-collect --pr <n> --issue <UTV2-###> [--receipt <run-url>]');
    process.exit(2);
  }
  const result = collectAndEvaluate({ prNumber, issueId, atSha, fromSha });
  if ('ok' in result && result.ok === false) {
    console.log(JSON.stringify({ verdict: 'REFUSED', reason: result.reason }, null, 2));
    process.exit(1);
  }
  const r = result as CarryForwardResult;
  const receiptAt = args.indexOf('--receipt');
  console.log(receiptAt === -1 ? JSON.stringify(r, null, 2) : renderReceipt(r, args[receiptAt + 1]));
  process.exit(r.verdict === 'VERIFIED' ? 0 : 1);
}
