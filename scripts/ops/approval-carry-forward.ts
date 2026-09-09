#!/usr/bin/env tsx
/**
 * Approval carry-forward verifier (`approval-carry-forward/v1`).
 *
 * PM-authorized 2026-09-05. This module answers exactly one question:
 *
 *   Has a PM approval that was pinned to an earlier head SHA remained
 *   *factually* applicable at the current head?
 *
 * It is NOT an approval, and it never becomes one. It carries forward a PM
 * decision that already exists, and it asserts nothing whatsoever about the
 * implementation. The original `pm-verdict/v1` comment is never edited,
 * deleted or superseded.
 *
 * THE SECURITY PROPERTY EVERYTHING ELSE RESTS ON
 * ----------------------------------------------
 * The receipt is an OUTPUT, never an INPUT. A caller must recompute every
 * condition from git and the GitHub API and then emit the receipt. Nothing in
 * this repository may accept a receipt supplied as a comment, a file or a
 * workflow input — otherwise any actor with comment access could forge one,
 * which is precisely the failure this mechanism must not create.
 *
 * This module is pure and read-only: it performs no network call, writes no
 * file, and mutates nothing. All evidence is injected by the caller, which is
 * what makes each condition testable against the exact case it names.
 *
 * Merge authority is a reserved surface (`docs/mission/intent.md`, reserved
 * decision 7). Wiring this verifier into `.github/workflows/merge-gate.yml` is
 * therefore a separate, deliberately small change that requires PM review.
 * Until that lands, this ships as an operator tool and changes no gate.
 */

import micromatch from 'micromatch';

export const CARRY_FORWARD_SCHEMA = 'approval-carry-forward/v1';

export type ConditionId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7';

export interface ConditionResult {
  id: ConditionId;
  title: string;
  status: 'pass' | 'fail';
  detail: string;
}

export interface ChainCommit {
  sha: string;
  /** Full parent SHAs, in order. A merge commit has two or more. */
  parents: string[];
  subject: string;
}

export interface RequiredCheck {
  context: string;
  conclusion: string | null;
}

export interface WithdrawalSignal {
  /** Where the withdrawal came from — a PM can withdraw through either surface. */
  source: 'pm-verdict' | 'github-review';
  createdAt: string;
  detail: string;
}

export interface CarryForwardInputs {
  issueId: string;
  /** Current PR head. */
  headSha: string;
  /** Head SHA the surviving PM approval was pinned to. */
  approvedSha: string;
  /** ISO timestamp of the approving comment. */
  approvedAt: string;
  approvalCommentUrl: string;
  /**
   * `git rev-list --first-parent <approvedSha>..<headSha>`, resolved to commits.
   * Order is irrelevant to the evaluation.
   */
  firstParentChain: ChainCommit[];
  /**
   * True when `sha` is an ancestor of `origin/main` **as fetched during this
   * verification**. Never a local ref, never the PR's own base snapshot.
   */
  isAncestorOfMain: (sha: string) => boolean;
  /** True when `approvedSha` is genuinely an ancestor of `headSha`. */
  approvedShaIsAncestor: boolean;
  /** `git diff --name-only <approvedSha> <headSha>`. */
  changedPaths: string[];
  /** The four required contexts, as resolved at `headSha`. */
  requiredChecks: RequiredCheck[];
  /** Any changes-requested signal recorded after `approvedAt`. */
  withdrawals: WithdrawalSignal[];
  /**
   * C5. For every merge on the first-parent chain, the paths reported by
   * `git diff-tree --cc -r --name-only <sha>` *after* dropping the SHA header
   * line. A non-empty list is content present in no parent — an evil merge.
   *
   * Must cover every merge on `firstParentChain`; a missing entry is a refusal,
   * not a pass, because "we did not look" and "we looked and it was clean" are
   * the two answers this mechanism must never conflate.
   */
  mergeOwnContent: MergeOwnContent[];
  /**
   * C6. Blob identity for every path in `changedPaths`, at the resulting head
   * and at `mainAnchorSha`. `null` means the path does not exist at that ref.
   * Must cover every changed path, for the same reason as above.
   */
  blobIdentity: BlobIdentity[];
  /**
   * C6. The commit the head's incoming content is compared against: the newest
   * commit of the base branch actually contained in the head, i.e.
   * `git merge-base <headSha> origin/<base>`.
   *
   * Deliberately NOT `origin/main`'s tip. The tip moves on its own — the
   * readiness ledger writes to it on a schedule — so comparing against it would
   * refuse a correctly synced branch for a commit the branch has never seen,
   * making the control an always-refuse. The anchor is itself on main (asserted
   * by `mainAnchorIsOnMain`), so "identical to the anchor" is still "identical
   * to main"; it is only a statement about *which* commit of main.
   */
  mainAnchorSha: string;
  /** True when `mainAnchorSha` is an ancestor of the freshly fetched base ref. */
  mainAnchorIsOnMain: boolean;
  /**
   * C1 (widened). `git rev-list <approvedSha>..<headSha> --not origin/<base>`:
   * every commit reachable from the head, added since the approval, that the
   * base branch does not contain. Only the first-parent merge commits
   * themselves may appear here.
   */
  commitsNotOnMain: string[];
  /**
   * C7. `git patch-id --stable` over `git diff $(git merge-base origin/<base> X) X`
   * at the approved SHA and at the head. `null` when it could not be computed.
   */
  prDiffPatchId: { atApproved: string | null; atHead: string | null };
}

export interface MergeOwnContent {
  sha: string;
  /** Paths changed by the merge relative to *all* of its parents. */
  paths: string[];
}

export interface BlobIdentity {
  path: string;
  /** `git rev-parse <head>:<path>`, or null when the path is absent there. */
  atHead: string | null;
  /** `git rev-parse <mainAnchorSha>:<path>`, or null when absent. */
  atMain: string | null;
}

export interface CarryForwardResult {
  schema: typeof CARRY_FORWARD_SCHEMA;
  verdict: 'VERIFIED' | 'REFUSED';
  issue_id: string;
  original_verdict_sha: string;
  original_verdict_url: string;
  current_head_sha: string;
  /** The commit of the base branch the incoming content was compared against. */
  main_anchor_sha: string;
  /** The PR's own diff identity at the approved SHA and at the head. */
  pr_diff_patch_id: { atApproved: string | null; atHead: string | null };
  conditions: ConditionResult[];
  /** Every changed path with the rule that admitted it. Empty when refused. */
  admitted_paths: { path: string; rule: string }[];
  refusals: string[];
}

export const REQUIRED_CONTEXTS = [
  'verify',
  'Executor Result Validation',
  'Merge Gate',
  'P0 Protocol',
] as const;

/**
 * Paths that always require a fresh review. Evaluated BEFORE the allowlist, so
 * a later widening of the allowlist can never accidentally admit one of these.
 *
 * Deliberately enumerated as leaf patterns rather than as whole `docs/` and
 * `.ops/` subtrees: PM's instruction was explicitly not to exempt those
 * wholesale.
 */
export function denyPatternsFor(issueId: string): string[] {
  const id = issueId.toUpperCase();
  return [
    'docs/mission/**',
    'docs/05_operations/**',
    'docs/governance/**',
    '.github/**',
    'CODEOWNERS',
    '**/CODEOWNERS',
    '.lane/**',
    '.claude/**',
    '.agents/**',
    'scripts/**',
    'supabase/**',
    'deploy/**',
    // Named explicitly so this list and `.github/CODEOWNERS` agree by
    // construction rather than by both happening to be right. Both are already
    // caught by C2's reviewed-artifact patterns and by C3's deny-by-default;
    // enumerating them means a future widening of ALLOW_PATTERNS cannot admit
    // an owned surface by accident.
    'packages/db/**',
    'apps/api/src/controllers/**',
    // This lane's own governance surface. Another lane's bookkeeping is
    // permitted below; this issue's own is not, because it is the very
    // material the approval was given against.
    `docs/06_status/lanes/${id}.json`,
    `docs/06_status/proof/${id}/**`,
    `.ops/sync/${id}.yml`,
    `.ops/leases/${id}.json`,
  ];
}

/**
 * The complete set of bookkeeping paths an unattended `main` may introduce.
 *
 * These are deliberately written to match *any* lane's artifacts; this issue's
 * own are removed by the deny list above, which is evaluated first.
 */
export const ALLOW_PATTERNS = [
  'docs/06_status/lanes/UTV2-*.json',
  'docs/06_status/proof/UTV2-*/**',
  'docs/06_status/readiness/**',
  '.ops/sync/UTV2-*.yml',
  '.ops/leases/UTV2-*.json',
];

/**
 * Paths whose change means the reviewed artifact itself moved. Kept separate
 * from the deny list because C2 and C3 answer different questions: C2 asks
 * "did what was reviewed change?", C3 asks "is what arrived permitted?".
 */
export const REVIEWED_ARTIFACT_PATTERNS = [
  'apps/**',
  'packages/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  'package.json',
  '**/package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig*.json',
  '**/tsconfig*.json',
  '**/*.config.*',
  '.env*',
  'deploy/**',
  'docker-compose*',
  '**/Dockerfile*',
  'supabase/migrations/**',
];

function matches(path: string, patterns: string[]): boolean {
  return micromatch.isMatch(path, patterns, { dot: true });
}

/** C1 — a previously approved ancestor, and only main merges after it. */
export function evaluateC1(input: CarryForwardInputs): ConditionResult {
  const title = 'a previously approved ancestor, with only merges from authoritative main after it';

  if (!input.approvedShaIsAncestor) {
    return {
      id: 'C1',
      title,
      status: 'fail',
      detail: `approved SHA ${input.approvedSha} is not an ancestor of head ${input.headSha}; the branch was rewritten or replaced`,
    };
  }

  if (input.firstParentChain.length === 0) {
    return {
      id: 'C1',
      title,
      status: 'fail',
      detail: 'no commits between the approved SHA and the head; carry-forward does not apply to an unchanged head (the original verdict is still valid on its own)',
    };
  }

  const authored = input.firstParentChain.filter((c) => c.parents.length < 2);
  if (authored.length > 0) {
    return {
      id: 'C1',
      title,
      status: 'fail',
      detail: `newly authored commit(s) on the first-parent chain: ${authored
        .map((c) => `${c.sha.slice(0, 9)} ${c.subject}`)
        .join('; ')}`,
    };
  }

  // Every merged-in parent, not just the second. An octopus merge has three or
  // more, and checking only `parents[1]` would leave the rest unexamined.
  const foreign = input.firstParentChain.flatMap((c) =>
    c.parents
      .slice(1)
      .filter((parent) => !input.isAncestorOfMain(parent))
      .map((parent) => `${c.sha.slice(0, 9)} <- ${parent.slice(0, 9)}`),
  );
  if (foreign.length > 0) {
    return {
      id: 'C1',
      title,
      status: 'fail',
      detail: `merged parent(s) not on origin/main: ${foreign.join('; ')}`,
    };
  }

  // An independent cross-check, computed by a different git command against a
  // different question: what did the head actually gain that main does not
  // have? Only the chain's own merge commits may appear.
  //
  // Stated honestly, because the obvious motivation for it is wrong: a merge
  // whose second parent is an ancestor of main CANNOT drag in an off-main
  // commit through that parent's ancestry, since everything reachable from an
  // ancestor of main is also an ancestor of main. Measured on real git
  // (UTV2-1839): reverting this block alone changes no outcome in any scenario
  // that could be constructed. It is kept as redundancy, not as an
  // independently firing control — it fires only when the per-parent walk and
  // the reachability set disagree, which is a bug in the collector or a graph
  // that moved underneath it. The per-parent widening above is the part that
  // is load-bearing: reverting THAT admits a real octopus merge whose third
  // parent is off main.
  const chainShas = new Set(input.firstParentChain.map((c) => c.sha));
  const unaccounted = input.commitsNotOnMain.filter((sha) => !chainShas.has(sha));
  if (unaccounted.length > 0) {
    return {
      id: 'C1',
      title,
      status: 'fail',
      detail: `commit(s) reachable from the head but not from origin/main, and not the chain's own merges: ${unaccounted
        .map((s) => s.slice(0, 9))
        .join(', ')}`,
    };
  }

  return {
    id: 'C1',
    title,
    status: 'pass',
    detail: `${input.firstParentChain.length} commit(s) since the approved SHA, all merges from origin/main; nothing reachable from the head is off origin/main except those merges themselves`,
  };
}

/** C2 — reviewed implementation, tests, dependencies, config and proof unchanged. */
export function evaluateC2(input: CarryForwardInputs): ConditionResult {
  const title = 'the reviewed implementation, tests, dependencies, configuration and issue proof are unchanged';
  const id = input.issueId.toUpperCase();
  const ownProof = [
    `docs/06_status/proof/${id}/**`,
    `docs/06_status/lanes/${id}.json`,
  ];
  const touched = input.changedPaths.filter(
    (p) => matches(p, REVIEWED_ARTIFACT_PATTERNS) || matches(p, ownProof),
  );

  if (touched.length > 0) {
    return {
      id: 'C2',
      title,
      status: 'fail',
      detail: `reviewed artifacts changed since approval: ${touched.join(', ')}`,
    };
  }
  return { id: 'C2', title, status: 'pass', detail: 'no reviewed artifact changed since approval' };
}

/** C3 — incoming changes limited to explicitly permitted bookkeeping. */
export function evaluateC3(input: CarryForwardInputs): {
  result: ConditionResult;
  admitted: { path: string; rule: string }[];
} {
  const title = 'incoming changes are limited to explicitly permitted bookkeeping';
  const deny = denyPatternsFor(input.issueId);
  const allow = ALLOW_PATTERNS;
  const admitted: { path: string; rule: string }[] = [];
  const refused: string[] = [];

  for (const path of input.changedPaths) {
    // Deny first, always. A path on both lists is refused.
    const denyHit = deny.find((pattern) => matches(path, [pattern]));
    if (denyHit) {
      refused.push(`${path} (denied by ${denyHit})`);
      continue;
    }
    const allowHit = allow.find((pattern) => matches(path, [pattern]));
    if (allowHit) {
      admitted.push({ path, rule: allowHit });
      continue;
    }
    refused.push(`${path} (matches no permitted bookkeeping rule)`);
  }

  if (refused.length > 0) {
    return {
      result: { id: 'C3', title, status: 'fail', detail: refused.join('; ') },
      admitted: [],
    };
  }
  return {
    result: {
      id: 'C3',
      title,
      status: 'pass',
      detail: admitted.length === 0
        ? 'no files changed since approval'
        : `${admitted.length} bookkeeping path(s) admitted`,
    },
    admitted,
  };
}

/** C4 — checks green at the resulting head, and no later changes-requested. */
export function evaluateC4(input: CarryForwardInputs): ConditionResult {
  const title = 'required checks pass at the resulting head and no changes-requested decision followed';
  const problems: string[] = [];

  for (const context of REQUIRED_CONTEXTS) {
    // Merge Gate is the caller here; its own verdict cannot be an input to
    // its own decision, so it is excluded rather than asserted green.
    if (context === 'Merge Gate') continue;
    const check = input.requiredChecks.find((c) => c.context === context);
    if (!check) {
      problems.push(`required context "${context}" is absent at the head`);
    } else if (check.conclusion !== 'success') {
      problems.push(`required context "${context}" is ${check.conclusion ?? 'pending'}`);
    }
  }

  const approvedAtMs = Date.parse(input.approvedAt);
  const later = input.withdrawals.filter((w) => Date.parse(w.createdAt) > approvedAtMs);
  for (const w of later) {
    problems.push(`changes requested via ${w.source} after approval: ${w.detail}`);
  }

  if (problems.length > 0) {
    return { id: 'C4', title, status: 'fail', detail: problems.join('; ') };
  }
  return {
    id: 'C4',
    title,
    status: 'pass',
    detail: 'required contexts pass at the head and no changes-requested decision followed the approval',
  };
}

/**
 * C5 — no merge on the chain carried content of its own.
 *
 * A merge commit's tree is not obliged to be a function of its parents. Git
 * will happily record a "conflict resolution" that is neither side, and the
 * result is invisible to `git diff <parent> <merge>` in the direction anyone
 * normally looks. `git diff-tree --cc` reports exactly the paths where the
 * merge result differs from *every* parent, which is the definition of the
 * content nobody reviewed.
 *
 * This is not hypothetical on this repository: `c31b8ee191e1704a5ebca70e60e178b97a433d99`
 * ("Merge remote-tracking branch 'origin/main'") carries
 * `docs/06_status/lanes/UTV2-1514.json` in neither parent — on a path
 * `ALLOW_PATTERNS[0]` admits. Nineteen of the twenty most recent first-parent
 * merges on `main` report nothing, so the check is cheap, almost always empty,
 * and discriminating.
 */
export function evaluateC5(input: CarryForwardInputs): ConditionResult {
  const title = 'no merge on the chain introduced content of its own (no evil merge, no unreviewed conflict resolution)';

  const reported = new Map(input.mergeOwnContent.map((m) => [m.sha, m.paths]));
  const unmeasured = input.firstParentChain.filter((c) => !reported.has(c.sha));
  if (unmeasured.length > 0) {
    // Not measured is not clean. Refusing here is what keeps a collector that
    // silently skipped a commit from reading as a pass.
    return {
      id: 'C5',
      title,
      status: 'fail',
      detail: `no merge-content measurement for ${unmeasured
        .map((c) => c.sha.slice(0, 9))
        .join(', ')}; absence of evidence is not evidence of absence`,
    };
  }

  const offending = input.mergeOwnContent.filter((m) => m.paths.length > 0);
  if (offending.length > 0) {
    return {
      id: 'C5',
      title,
      status: 'fail',
      detail: `merge(s) carrying content present in no parent: ${offending
        .map((m) => `${m.sha.slice(0, 9)} (${m.paths.join(', ')})`)
        .join('; ')}`,
    };
  }

  return {
    id: 'C5',
    title,
    status: 'pass',
    detail:
      input.mergeOwnContent.length === 0
        ? 'no merges on the chain'
        : `${input.mergeOwnContent.length} merge(s) measured, none carrying content of its own`,
  };
}

/**
 * C6 — every incoming path holds literally main's content.
 *
 * C3 answers "is this path permitted?". C6 answers the harder question: is what
 * arrived at that path *the same bytes main has*, or merely something
 * path-shaped like it? Without C6, a path on the allowlist can carry arbitrary
 * content, because `changedPaths` is a two-dot diff of the head against itself
 * at two times and cannot distinguish main-originated content from content
 * authored on the branch.
 *
 * This is the enforcement half, and at path granularity it subsumes C5. Both
 * are kept: `--cc` is cheaper, names the offending merge rather than only the
 * offending path, and catches a resolution that a later commit reverted.
 */
export function evaluateC6(input: CarryForwardInputs): ConditionResult {
  const title = 'every path that changed since approval holds exactly the content main holds';

  if (!input.mainAnchorIsOnMain) {
    return {
      id: 'C6',
      title,
      status: 'fail',
      detail: `the comparison anchor ${input.mainAnchorSha.slice(0, 9)} is not an ancestor of the freshly fetched base branch; there is no authoritative main content to compare against`,
    };
  }

  const measured = new Map(input.blobIdentity.map((b) => [b.path, b]));
  const unmeasured = input.changedPaths.filter((p) => !measured.has(p));
  if (unmeasured.length > 0) {
    return {
      id: 'C6',
      title,
      status: 'fail',
      detail: `no blob measurement for ${unmeasured.join(', ')}; absence of evidence is not evidence of absence`,
    };
  }

  const divergent = input.blobIdentity.filter((b) => b.atHead !== b.atMain);
  if (divergent.length > 0) {
    return {
      id: 'C6',
      title,
      status: 'fail',
      detail: `path(s) whose content at the head is not main's content at ${input.mainAnchorSha.slice(0, 9)}: ${divergent
        .map(
          (b) =>
            `${b.path} (head ${b.atHead ? b.atHead.slice(0, 9) : 'absent'} vs main ${b.atMain ? b.atMain.slice(0, 9) : 'absent'})`,
        )
        .join('; ')}`,
    };
  }

  return {
    id: 'C6',
    title,
    status: 'pass',
    detail:
      input.blobIdentity.length === 0
        ? 'no files changed since approval'
        : `${input.blobIdentity.length} path(s) byte-identical to main at ${input.mainAnchorSha.slice(0, 9)}`,
  };
}

/**
 * C7 — the PR's own contribution, relative to its base, is unchanged.
 *
 * This is the headline claim: `git patch-id --stable` over
 * `git diff $(git merge-base origin/<base> X) X`, computed at the approved SHA
 * and at the head. Equal ids mean the diff the PM actually reviewed is byte-
 * identical to the diff that would merge now, independently of how much main
 * moved underneath it.
 *
 * It is deliberately NOT the enforcement. `patch-id` normalises away renames,
 * mode changes and hunk offsets, so an equal id is a strong statement and an
 * unequal one is decisive, but an *uncomputable* one must not be treated as a
 * refusal on its own — C6 is what actually holds the line. Hence: fail only
 * when both ids are known and differ.
 */
export function evaluateC7(input: CarryForwardInputs): ConditionResult {
  const title = "the PR's own diff against its base is byte-identical to the reviewed one";
  const { atApproved, atHead } = input.prDiffPatchId;

  if (atApproved && atHead && atApproved !== atHead) {
    return {
      id: 'C7',
      title,
      status: 'fail',
      detail: `patch-id changed: reviewed ${atApproved.slice(0, 12)} vs current ${atHead.slice(0, 12)}; the PR's contribution to its base is not what was approved`,
    };
  }

  if (!atApproved || !atHead) {
    return {
      id: 'C7',
      title,
      status: 'pass',
      detail: `patch-id unavailable (${!atApproved ? 'approved' : 'head'} side could not be computed); C6 is the enforcing condition and this claim is reported as unproven rather than asserted`,
    };
  }

  return {
    id: 'C7',
    title,
    status: 'pass',
    detail: `patch-id ${atHead.slice(0, 12)} identical at the approved SHA and at the head`,
  };
}

export function evaluateCarryForward(input: CarryForwardInputs): CarryForwardResult {
  const c1 = evaluateC1(input);
  const c2 = evaluateC2(input);
  const c3 = evaluateC3(input);
  const c4 = evaluateC4(input);
  const c5 = evaluateC5(input);
  const c6 = evaluateC6(input);
  const c7 = evaluateC7(input);
  const conditions = [c1, c2, c3.result, c4, c5, c6, c7];
  const refusals = conditions.filter((c) => c.status === 'fail').map((c) => `${c.id}: ${c.detail}`);

  return {
    schema: CARRY_FORWARD_SCHEMA,
    verdict: refusals.length === 0 ? 'VERIFIED' : 'REFUSED',
    issue_id: input.issueId,
    original_verdict_sha: input.approvedSha,
    original_verdict_url: input.approvalCommentUrl,
    current_head_sha: input.headSha,
    main_anchor_sha: input.mainAnchorSha,
    pr_diff_patch_id: input.prDiffPatchId,
    conditions,
    admitted_paths: refusals.length === 0 ? c3.admitted : [],
    refusals,
  };
}

/** Renders the human-readable receipt. Never parsed back in — output only. */
export function renderReceipt(result: CarryForwardResult, runUrl: string): string {
  const lines: string[] = [];
  lines.push(`APPROVAL_CARRY_FORWARD: ${result.verdict}`);
  lines.push(`schema: ${CARRY_FORWARD_SCHEMA}`);
  lines.push(`Issue: ${result.issue_id}`);
  lines.push(`Original-Verdict-SHA: ${result.original_verdict_sha}`);
  lines.push(`Original-Verdict-URL: ${result.original_verdict_url}`);
  lines.push(`Current-Head-SHA: ${result.current_head_sha}`);
  lines.push(`Main-Anchor-SHA: ${result.main_anchor_sha}`);
  lines.push(
    `PR-Diff-Patch-Id: ${result.pr_diff_patch_id.atApproved ?? 'unavailable'} (approved) / ${result.pr_diff_patch_id.atHead ?? 'unavailable'} (head)`,
  );
  lines.push(`Generated-By: ${runUrl}`);
  lines.push('');
  lines.push('Conditions:');
  for (const c of result.conditions) {
    lines.push(`- [${c.status === 'pass' ? 'x' : ' '}] ${c.id} — ${c.title}: ${c.detail}`);
  }
  if (result.admitted_paths.length > 0) {
    lines.push('');
    lines.push('Admitted paths:');
    for (const a of result.admitted_paths) {
      lines.push(`- ${a.path} (rule: ${a.rule})`);
    }
  }
  if (result.refusals.length > 0) {
    lines.push('');
    lines.push('Refusals:');
    for (const r of result.refusals) lines.push(`- ${r}`);
  }
  lines.push('');
  lines.push(
    'This receipt carries forward the PM decision recorded at Original-Verdict-SHA. It is not an independent review and asserts nothing about the implementation.',
  );
  return lines.join('\n');
}
