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

export type ConditionId = 'C1' | 'C2' | 'C3' | 'C4';

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
}

export interface CarryForwardResult {
  schema: typeof CARRY_FORWARD_SCHEMA;
  verdict: 'VERIFIED' | 'REFUSED';
  issue_id: string;
  original_verdict_sha: string;
  original_verdict_url: string;
  current_head_sha: string;
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
    'supabase/migrations/**',
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

  const foreign = input.firstParentChain.filter((c) => !input.isAncestorOfMain(c.parents[1]!));
  if (foreign.length > 0) {
    return {
      id: 'C1',
      title,
      status: 'fail',
      detail: `merge(s) whose second parent is not on origin/main: ${foreign
        .map((c) => `${c.sha.slice(0, 9)} <- ${c.parents[1]!.slice(0, 9)}`)
        .join('; ')}`,
    };
  }

  return {
    id: 'C1',
    title,
    status: 'pass',
    detail: `${input.firstParentChain.length} commit(s) since the approved SHA, all merges from origin/main`,
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

export function evaluateCarryForward(input: CarryForwardInputs): CarryForwardResult {
  const c1 = evaluateC1(input);
  const c2 = evaluateC2(input);
  const c3 = evaluateC3(input);
  const c4 = evaluateC4(input);
  const conditions = [c1, c2, c3.result, c4];
  const refusals = conditions.filter((c) => c.status === 'fail').map((c) => `${c.id}: ${c.detail}`);

  return {
    schema: CARRY_FORWARD_SCHEMA,
    verdict: refusals.length === 0 ? 'VERIFIED' : 'REFUSED',
    issue_id: input.issueId,
    original_verdict_sha: input.approvedSha,
    original_verdict_url: input.approvalCommentUrl,
    current_head_sha: input.headSha,
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
