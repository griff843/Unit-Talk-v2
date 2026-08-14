#!/usr/bin/env tsx
/**
 * UTV2-1668 -- governed terminal supersession for unmerged lanes.
 *
 * A lane whose implementation will never merge had no truthful terminal
 * transition. `merged`/`done` would fabricate shipped work; staying active
 * holds a scope lock and executor capacity forever. `superseded` already
 * existed as a status (UTV2-1619 capability 13) but the only way to reach it
 * was a raw `ops:lane-manifest update --status`, which verifies nothing. This
 * command is the governed path, and `lane-manifest update` now refuses.
 *
 * Every check fails CLOSED. An unreachable GitHub, an ambiguous PR identity, a
 * disagreeing head SHA -- none of them are permission to proceed. The whole
 * point is that this command can end a lane without shipping it, so it must
 * never be able to do that on a lane that actually shipped.
 *
 * Usage:
 *   npx tsx scripts/ops/lane-supersede.ts UTV2-### \
 *     --reason <text> --successor UTV2-### --source-pr <#|url> \
 *     --rejected-head <sha> --actor <id>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertStatusTransition,
  emitJson,
  getRepoRoot,
  readManifest,
  manifestExists,
  writeManifest,
  requireIssueId,
  ACTIVE_LOCK_STATUSES,
  TOTAL_CAPACITY_STATUSES,
  EXECUTOR_CAPACITY_STATUSES,
  TYPE_CAPACITY_STATUSES,
  SUCCESS_TERMINAL_STATUSES,
  type LaneManifest,
  type SupersessionRecord,
} from './shared.js';
import { releaseLease, readAllLeases } from './lease-registry.js';
import { acquireMergeLock, releaseMergeLock, defaultMergeLockOwner } from './merge-mutex.js';

export const SUPERSESSION_TX_DIR = '.ops/supersession';

/**
 * A lease still HOLDS its file scope in both of these states.
 *
 * Mirrors `ACTIVE_NON_RECLAIMED` in `lease-registry.ts`, which is module-private
 * there. Checking only `active` would report a lane released while a
 * `stale_reclaim_required` lease keeps blocking new work -- the reservation path
 * treats both as held, so the release post-condition must too.
 */
export const LEASE_STATES_STILL_HELD: ReadonlySet<string> = new Set(['active', 'stale_reclaim_required']);

/** Ordered stages. A crash leaves the receipt at the last completed stage. */
export const TX_STAGES = ['verified', 'manifest_committed', 'lease_released', 'complete'] as const;
export type TxStage = (typeof TX_STAGES)[number];

export interface SupersessionTransaction {
  transaction_id: string;
  issue_id: string;
  stage: TxStage;
  inputs: SupersedeInputs;
  updated_at: string;
}

export interface SupersedeInputs {
  issueId: string;
  reason: string;
  actor: string;
  successor: string;
  sourcePr: string;
  rejectedHead: string;
}

export interface SupersedeResult {
  ok: boolean;
  code: string;
  message: string;
  issue_id?: string;
  stage?: TxStage;
  transaction_id?: string;
  idempotent?: boolean;
  verification?: Record<string, unknown>;
  exit_code: number;
}

// ── input validation ─────────────────────────────────────────────────────────

/**
 * All inputs are mandatory (PM correction 1). A supersession with a missing
 * actor or reason is an unattributable terminal, and a successor equal to the
 * source issue is a lane superseding itself -- a cycle that would satisfy the
 * "requirement transferred" claim while transferring nothing.
 */
export function validateInputs(raw: Partial<SupersedeInputs>): { ok: true; value: SupersedeInputs } | { ok: false; code: string; message: string } {
  const missing = (['issueId', 'reason', 'actor', 'successor', 'sourcePr', 'rejectedHead'] as const)
    .filter((key) => {
      const v = raw[key];
      return typeof v !== 'string' || v.trim().length === 0;
    });
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'missing_required_input',
      message:
        `Missing required argument(s): ${missing.join(', ')}. ` +
        'Usage: npx tsx scripts/ops/lane-supersede.ts UTV2-### --reason <text> ' +
        '--successor UTV2-### --source-pr <#|url> --rejected-head <sha> --actor <id>',
    };
  }
  let issueId: string;
  let successor: string;
  try {
    issueId = requireIssueId(String(raw.issueId).trim());
    successor = requireIssueId(String(raw.successor).trim());
  } catch (error) {
    return { ok: false, code: 'invalid_issue_id', message: (error as Error).message };
  }
  if (issueId === successor) {
    return {
      ok: false,
      code: 'successor_equals_source',
      message: `Successor ${successor} may not equal the superseded issue ${issueId}`,
    };
  }
  const rejectedHead = String(raw.rejectedHead).trim();
  if (!/^[0-9a-f]{40}$/i.test(rejectedHead)) {
    return {
      ok: false,
      code: 'invalid_rejected_head',
      message: `--rejected-head must be a full 40-character commit SHA; received "${rejectedHead}"`,
    };
  }
  return {
    ok: true,
    value: {
      issueId,
      successor,
      rejectedHead: rejectedHead.toLowerCase(),
      reason: String(raw.reason).trim(),
      actor: String(raw.actor).trim(),
      sourcePr: normalizePrNumber(String(raw.sourcePr).trim()),
    },
  };
}

/** Accepts `123`, `#123` or a PR URL; returns the bare number as a string. */
export function normalizePrNumber(value: string): string {
  const url = value.match(/\/pull\/(\d+)\b/);
  if (url) return url[1] as string;
  const bare = value.match(/^#?(\d+)$/);
  return bare ? (bare[1] as string) : value;
}

/**
 * `owner/repo` from a PR URL, or null when the value carries no repository.
 *
 * A bare number is repository-relative, so comparing numbers alone lets a
 * manifest URL pointing at ANOTHER repository agree with `--source-pr 123`,
 * while `gh pr view 123` then attests PR #123 in THIS repository. An unrelated
 * closed PR would authorize the supersession.
 */
export function prRepoFromUrl(value: string): string | null {
  const m = value.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** `owner/repo` of the checkout the command is acting in. */
export function currentRepoSlug(
  runner: (args: string[]) => { status: number | null; stdout: string } = defaultGh,
): string | null {
  const r = runner(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  if (r.status !== 0) return null;
  const slug = (r.stdout ?? '').trim();
  return slug.length > 0 ? slug : null;
}

// ── GitHub authority ─────────────────────────────────────────────────────────

export interface PrTruth {
  ok: boolean;
  reason: string;
  number?: string;
  state?: string;
  merged?: boolean;
  mergedAt?: string | null;
  headRefOid?: string;
  headRefName?: string;
}

/**
 * Authoritative PR state.
 *
 * Deliberately does NOT consult `mergeCommit`: GitHub populates that field for
 * unmerged PRs (it is the *potential* merge commit), so treating it as merge
 * evidence would refuse legitimate supersessions. `merged` and `mergedAt` are
 * the authoritative signals.
 */
export function readPrTruth(
  prNumber: string,
  runner: (args: string[]) => { status: number | null; stdout: string } = defaultGh,
): PrTruth {
  const result = runner(['pr', 'view', prNumber, '--json', 'number,state,merged,mergedAt,headRefOid,headRefName']);
  if (result.status !== 0) {
    return { ok: false, reason: `unable to read PR #${prNumber} from GitHub; refusing to proceed on unverified state` };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: `GitHub returned unparseable JSON for PR #${prNumber}` };
  }
  const state = typeof parsed.state === 'string' ? parsed.state : undefined;
  const headRefOid = typeof parsed.headRefOid === 'string' ? parsed.headRefOid : undefined;
  if (!state || !headRefOid) {
    return { ok: false, reason: `GitHub response for PR #${prNumber} is missing state or head SHA` };
  }
  return {
    ok: true,
    reason: 'read from GitHub',
    number: String(parsed.number ?? prNumber),
    state,
    merged: parsed.merged === true,
    mergedAt: (parsed.mergedAt as string | null) ?? null,
    headRefOid,
    headRefName: typeof parsed.headRefName === 'string' ? parsed.headRefName : undefined,
  };
}

/**
 * The CURRENT main SHA according to GitHub, not local `origin/main`.
 *
 * A local ref is only as fresh as the last fetch. Proving a head is not an
 * ancestor of a stale main proves nothing about whether the work has since
 * landed, and this command's entire authority rests on that question.
 */
export function readRemoteMainSha(
  runner: (args: string[]) => { status: number | null; stdout: string } = defaultGh,
): { ok: boolean; sha?: string; reason: string } {
  const r = runner(['api', 'repos/{owner}/{repo}/commits/main', '--jq', '.sha']);
  if (r.status !== 0) {
    return { ok: false, reason: 'unable to read the current main SHA from GitHub; refusing to judge ancestry against stale local state' };
  }
  const sha = (r.stdout ?? '').trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    return { ok: false, reason: `GitHub returned an unusable main SHA: "${sha}"` };
  }
  return { ok: true, sha: sha.toLowerCase(), reason: 'read from GitHub' };
}

/**
 * Actor authority, attested by GitHub rather than by the caller.
 *
 * `--actor` alone is a self-declared string: the party ending the lane would be
 * the same party vouching for who they are. That is the self-attestation defect
 * this family of controls exists to close, so the declared actor must match the
 * authenticated GitHub identity.
 */
export function verifyActorAuthority(
  declaredActor: string,
  runner: (args: string[]) => { status: number | null; stdout: string } = defaultGh,
): { ok: boolean; login?: string; reason: string } {
  const r = runner(['api', 'user', '--jq', '.login']);
  if (r.status !== 0) {
    return { ok: false, reason: 'unable to resolve an authenticated GitHub identity; actor authority cannot be self-attested' };
  }
  const login = (r.stdout ?? '').trim();
  if (!login) {
    return { ok: false, reason: 'GitHub returned no authenticated login; refusing a self-attested actor' };
  }
  if (login.toLowerCase() !== declaredActor.toLowerCase()) {
    return {
      ok: false,
      login,
      reason: `--actor "${declaredActor}" does not match the authenticated GitHub identity "${login}"`,
    };
  }
  return { ok: true, login, reason: 'actor matches the authenticated GitHub identity' };
}

function defaultCurrentBranch(): string {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: 'pipe' });
  return r.status === 0 ? (r.stdout ?? '').trim() : '';
}

/**
 * A named, resolvable branch -- never a detached HEAD.
 *
 * `git rev-parse --abbrev-ref HEAD` yields the literal string `HEAD` when
 * detached and the resolver yields `''` when the command fails. Neither can
 * equal the superseded lane's branch, so a bare inequality check silently
 * PASSES for a detached checkout: the terminal record would be written into a
 * checkout no branch carries, the shared lease released, and success reported
 * with nothing persisted anywhere a reviewer can see. The acting branch must be
 * positively established, not merely different.
 */
export function resolveActingBranch(branch: string): { ok: boolean; branch?: string; reason: string } {
  const value = branch.trim();
  if (value.length === 0) {
    return { ok: false, reason: 'unable to resolve the current branch; refusing to write a terminal record from an unknown checkout' };
  }
  if (value === 'HEAD') {
    return { ok: false, reason: 'HEAD is detached; a terminal record must be written from a named acting-lane branch' };
  }
  return { ok: true, branch: value, reason: 'named acting branch resolved' };
}

function defaultGh(args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync('gh', args, { encoding: 'utf8', stdio: 'pipe' });
  return { status: r.status, stdout: r.stdout ?? '' };
}

/** True when `sha` is an ancestor of `baseRef` -- i.e. the content DID land. */
export function isAncestorOfBase(
  cwd: string,
  sha: string,
  baseRef = 'origin/main',
  runner: (args: string[]) => number | null = (args) => spawnSync('git', args, { cwd, stdio: 'pipe' }).status,
): { ok: boolean; ancestor: boolean; reason: string } {
  const exists = runner(['cat-file', '-e', `${sha}^{commit}`]);
  if (exists !== 0) {
    return { ok: false, ancestor: false, reason: `commit ${sha} is not present locally; cannot prove it is unmerged` };
  }
  const status = runner(['merge-base', '--is-ancestor', sha, baseRef]);
  if (status === 0) return { ok: true, ancestor: true, reason: `${sha} is an ancestor of ${baseRef}` };
  if (status === 1) return { ok: true, ancestor: false, reason: `${sha} is not an ancestor of ${baseRef}` };
  return { ok: false, ancestor: false, reason: `unable to evaluate ancestry of ${sha} against ${baseRef}` };
}

// ── durable staged transaction ───────────────────────────────────────────────

/**
 * The receipt must survive a crash in ONE worktree and be found by a resume run
 * in ANOTHER. A per-worktree path would hide an interrupted transaction from
 * every other checkout, so recovery would silently restart instead of resuming
 * -- and a half-applied supersession is exactly the state that must stay
 * visible. `--git-common-dir` resolves to the shared `.git` for every worktree
 * of a repository, so its parent is the one durable root they all agree on.
 */
export function durableRoot(cwd = process.cwd()): string {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd, encoding: 'utf8', stdio: 'pipe',
  });
  if (r.status !== 0) return getRepoRoot();
  const commonDir = (r.stdout ?? '').trim();
  if (!commonDir) return getRepoRoot();
  return path.dirname(commonDir);
}

export function transactionPath(issueId: string, root?: string): string {
  return path.join(root ?? durableRoot(), SUPERSESSION_TX_DIR, `${issueId}.json`);
}

/**
 * Deterministic transaction identity derived from the inputs.
 *
 * Two runs with identical inputs produce the same id and are therefore the same
 * transaction (idempotent resume). Any differing input produces a different id,
 * which is how a conflicting re-run is detected rather than silently applied.
 */
export function transactionId(input: SupersedeInputs): string {
  return [input.issueId, input.successor, input.sourcePr, input.rejectedHead, input.actor, input.reason]
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .join('|');
}

export function readTransaction(issueId: string, root?: string): SupersessionTransaction | null {
  const file = transactionPath(issueId, root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SupersessionTransaction;
  } catch {
    return null;
  }
}

export function writeTransaction(tx: SupersessionTransaction, root?: string): void {
  const file = transactionPath(tx.issue_id, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(tx, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// ── post-conditions ──────────────────────────────────────────────────────────

/**
 * The command must not report success until the resources are actually gone.
 * Asserting the status sets is not decoration: `superseded` being absent from
 * them is the entire mechanism by which capacity and locks are released, so it
 * is verified at runtime rather than assumed from a constant.
 */
export function verifyReleased(
  manifest: LaneManifest,
  leases: ReadonlyArray<{ issue_id?: string; status?: string }>,
): { ok: boolean; failures: string[]; checks: Record<string, boolean> } {
  const checks = {
    status_is_superseded: manifest.status === 'superseded',
    excluded_from_lock_conflict: !ACTIVE_LOCK_STATUSES.has(manifest.status),
    excluded_from_total_capacity: !TOTAL_CAPACITY_STATUSES.has(manifest.status),
    excluded_from_executor_capacity: !EXECUTOR_CAPACITY_STATUSES.has(manifest.status),
    excluded_from_type_capacity: !TYPE_CAPACITY_STATUSES.has(manifest.status),
    asserts_no_success: !SUCCESS_TERMINAL_STATUSES.has(manifest.status),
    no_merge_sha_claim: manifest.merge_sha == null,
    lease_not_active: !leases.some(
      (lease) => lease.issue_id === manifest.issue_id && LEASE_STATES_STILL_HELD.has(String(lease.status)),
    ),
  };
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return { ok: failures.length === 0, failures, checks };
}

// ── orchestration ────────────────────────────────────────────────────────────

export interface SupersedeDeps {
  root?: string;
  /** Current checkout branch; used to refuse writing from the superseded lane's own branch. */
  currentBranch?: () => string;
  /** Injected serialization for tests; production uses the shared merge mutex. */
  acquireLock?: () => { ok: boolean; code?: string };
  releaseLock?: () => void;
  gh?: (args: string[]) => { status: number | null; stdout: string };
  gitStatus?: (args: string[]) => number | null;
  leaseRegistryDir?: string;
  now?: () => string;
}

export function supersedeLane(raw: Partial<SupersedeInputs>, deps: SupersedeDeps = {}): SupersedeResult {
  const validated = validateInputs(raw);
  if (!validated.ok) {
    return { ok: false, code: validated.code, message: validated.message, exit_code: 1 };
  }
  const input = validated.value;
  const root = deps.root ?? durableRoot();
  const now = deps.now ?? (() => new Date().toISOString());
  const txId = transactionId(input);

  if (!manifestExists(input.issueId)) {
    return { ok: false, code: 'manifest_not_found', message: `No lane manifest for ${input.issueId}`, exit_code: 1 };
  }
  const manifest = readManifest(input.issueId);

  // Idempotency and conflict, decided BEFORE any GitHub call so a completed
  // transaction re-run is cheap and a conflicting one is refused early.
  const existingTx = readTransaction(input.issueId, root);
  if (manifest.status === 'superseded' || existingTx) {
    const priorId = manifest.supersession?.transaction_id ?? existingTx?.transaction_id;
    if (priorId && priorId !== txId) {
      return {
        ok: false,
        code: 'supersession_conflict',
        message:
          `${input.issueId} already has a supersession transaction with different inputs. ` +
          'Refusing to overwrite an existing terminal record.',
        exit_code: 1,
      };
    }
    if (manifest.status === 'superseded' && existingTx?.stage === 'complete') {
      const leases = readAllLeases(deps.leaseRegistryDir);
      const verified = verifyReleased(manifest, leases);
      return {
        ok: verified.ok,
        code: verified.ok ? 'supersession_noop' : 'supersession_incomplete',
        message: verified.ok
          ? `${input.issueId} is already superseded with identical inputs`
          : `${input.issueId} is superseded but resources remain held: ${verified.failures.join(', ')}`,
        issue_id: input.issueId,
        stage: 'complete',
        transaction_id: txId,
        idempotent: true,
        verification: verified.checks,
        exit_code: verified.ok ? 0 : 1,
      };
    }
  }

  // The supersession record must land on `main` through the acting lane, never
  // by writing to the superseded lane's own branch -- that branch belongs to a
  // closed PR and is preserved as failure evidence. Running from it would
  // rewrite the very history this command exists to keep intact.
  const acting = resolveActingBranch((deps.currentBranch ?? defaultCurrentBranch)());
  if (!acting.ok) {
    return { ok: false, code: 'acting_branch_unresolved', message: acting.reason, exit_code: 1 };
  }
  const branchNow = acting.branch as string;
  if (manifest.branch && branchNow === manifest.branch) {
    return {
      ok: false,
      code: 'refuses_to_write_superseded_branch',
      message:
        `Refusing to supersede ${input.issueId} from its own branch "${branchNow}". ` +
        'Run from the acting lane so the record persists to main without altering the closed PR branch.',
      exit_code: 1,
    };
  }

  // A lane that shipped may never be relabelled non-shipped.
  if (SUCCESS_TERMINAL_STATUSES.has(manifest.status) || manifest.merge_sha != null) {
    return {
      ok: false,
      code: 'lane_already_shipped',
      message:
        `${input.issueId} is status "${manifest.status}"` +
        (manifest.merge_sha ? ` with merge_sha ${manifest.merge_sha}` : '') +
        '; shipped work cannot be superseded',
      exit_code: 1,
    };
  }

  // Agreed PR identity: the manifest and the operator must name the same PR.
  const manifestPr = manifest.pr_url ? normalizePrNumber(manifest.pr_url) : null;
  if (!manifestPr) {
    return {
      ok: false,
      code: 'pr_identity_unresolved',
      message: `${input.issueId} manifest has no pr_url; PR identity cannot be agreed and supersession fails closed`,
      exit_code: 1,
    };
  }
  if (manifestPr !== input.sourcePr) {
    return {
      ok: false,
      code: 'pr_identity_conflict',
      message: `Manifest PR #${manifestPr} disagrees with --source-pr #${input.sourcePr}; refusing on ambiguous identity`,
      exit_code: 1,
    };
  }
  // A bare PR number is repository-relative. `gh pr view <n>` attests the PR in
  // THIS repository, so a manifest URL pointing elsewhere would let an
  // unrelated closed PR authorize the supersession.
  const manifestRepo = manifest.pr_url ? prRepoFromUrl(manifest.pr_url) : null;
  const actingRepo = currentRepoSlug(deps.gh);
  if (!manifestRepo || !actingRepo) {
    return {
      ok: false,
      code: 'pr_repo_unresolved',
      message: `unable to establish repository identity (manifest=${manifestRepo ?? 'none'}, checkout=${actingRepo ?? 'none'}); refusing to authorize from a number alone`,
      exit_code: 1,
    };
  }
  if (manifestRepo.toLowerCase() !== actingRepo.toLowerCase()) {
    return {
      ok: false,
      code: 'pr_repo_conflict',
      message: `manifest PR belongs to ${manifestRepo} but this checkout is ${actingRepo}; a PR number alone may not authorize supersession`,
      exit_code: 1,
    };
  }

  const pr = readPrTruth(input.sourcePr, deps.gh);
  if (!pr.ok) {
    return { ok: false, code: 'pr_state_unverifiable', message: pr.reason, exit_code: 1 };
  }
  if (pr.state !== 'CLOSED' || pr.merged === true || pr.mergedAt != null) {
    return {
      ok: false,
      code: 'pr_not_closed_unmerged',
      message: `PR #${input.sourcePr} is state=${pr.state} merged=${pr.merged} mergedAt=${pr.mergedAt}; only a closed, unmerged PR may be superseded`,
      exit_code: 1,
    };
  }
  if ((pr.headRefOid ?? '').toLowerCase() !== input.rejectedHead) {
    return {
      ok: false,
      code: 'rejected_head_mismatch',
      message: `--rejected-head ${input.rejectedHead} does not match PR #${input.sourcePr} head ${pr.headRefOid}`,
      exit_code: 1,
    };
  }
  const authority = verifyActorAuthority(input.actor, deps.gh);
  if (!authority.ok) {
    return { ok: false, code: 'actor_authority_unverified', message: authority.reason, exit_code: 1 };
  }

  const remoteMain = readRemoteMainSha(deps.gh);
  if (!remoteMain.ok) {
    return { ok: false, code: 'main_sha_unverifiable', message: remoteMain.reason, exit_code: 1 };
  }
  const ancestry = isAncestorOfBase(root, input.rejectedHead, remoteMain.sha as string, deps.gitStatus);
  if (!ancestry.ok) {
    return { ok: false, code: 'ancestry_unverifiable', message: ancestry.reason, exit_code: 1 };
  }
  if (ancestry.ancestor) {
    return {
      ok: false,
      code: 'rejected_head_on_main',
      message: `${input.rejectedHead} is an ancestor of GitHub main ${remoteMain.sha}; this work shipped and cannot be superseded`,
      exit_code: 1,
    };
  }

  // FINDING 1: validation and the terminal write must be one serialized
  // critical section. GitHub state is a SNAPSHOT: between reading it and
  // committing `superseded`, the PR can be reopened and merged, or its head can
  // land on main -- and the local post-condition never re-reads GitHub, so that
  // ordering reports success for work that shipped. Two concurrent invocations
  // could likewise both pass the receipt check and overwrite each other.
  const lock = deps.acquireLock
    ? deps.acquireLock()
    : acquireMergeLock({
        issue_id: input.issueId,
        branch: branchNow,
        pr: `#${input.sourcePr}`,
        cwd: root,
        reason: `supersede ${input.issueId}`,
        owner: defaultMergeLockOwner(),
      });
  if (!lock.ok) {
    return {
      ok: false,
      code: 'merge_mutex_unavailable',
      message: `refusing to supersede without the serialized merge lock: ${lock.code ?? 'unavailable'}`,
      exit_code: 1,
    };
  }
  try {
    return commitSupersession(input, manifest, pr, txId, root, now, deps, remoteMain.sha as string);
  } finally {
    if (deps.releaseLock) deps.releaseLock();
    else releaseMergeLock({ issue_id: input.issueId, branch: branchNow });
  }
}

/** The serialized critical section: re-verify, then commit and release. */
function commitSupersession(
  input: SupersedeInputs,
  manifest: LaneManifest,
  pr: PrTruth,
  txId: string,
  root: string,
  now: () => string,
  deps: SupersedeDeps,
  mainSha: string,
): SupersedeResult {
  // Re-read PR state INSIDE the lock. The pre-lock read decided whether to
  // bother; this one is the decision of record.
  const confirmed = readPrTruth(input.sourcePr, deps.gh);
  if (!confirmed.ok) {
    return { ok: false, code: 'pr_state_unverifiable', message: confirmed.reason, exit_code: 1 };
  }
  if (confirmed.state !== 'CLOSED' || confirmed.merged === true || confirmed.mergedAt != null) {
    return {
      ok: false,
      code: 'pr_not_closed_unmerged',
      message: `PR #${input.sourcePr} changed under the lock to state=${confirmed.state} merged=${confirmed.merged}; refusing`,
      exit_code: 1,
    };
  }
  const reAncestry = isAncestorOfBase(root, input.rejectedHead, mainSha, deps.gitStatus);
  if (!reAncestry.ok || reAncestry.ancestor) {
    return {
      ok: false,
      code: 'rejected_head_on_main',
      message: `${input.rejectedHead} landed on main before the terminal write; this work shipped and cannot be superseded`,
      exit_code: 1,
    };
  }

  writeTransaction({ transaction_id: txId, issue_id: input.issueId, stage: 'verified', inputs: input, updated_at: now() }, root);

  const record: SupersessionRecord = {
    reason: input.reason,
    actor: input.actor,
    at: now(),
    source_pr: `#${input.sourcePr}`,
    source_branch: pr.headRefName ?? manifest.branch,
    rejected_head: input.rejectedHead,
    successor_issue_id: input.successor,
    claim: 'source_pr_did_not_merge',
    transaction_id: txId,
  };
  assertStatusTransition(manifest.status, 'superseded');
  writeManifest({ ...manifest, status: 'superseded', closed_at: record.at, supersession: record });
  writeTransaction({ transaction_id: txId, issue_id: input.issueId, stage: 'manifest_committed', inputs: input, updated_at: now() }, root);

  // `releaseLease` returns `lease_invalid_existing` for BOTH "no lease file"
  // and "lease is corrupt", so the code alone cannot distinguish "nothing to
  // release" from a real failure. Decide it from lease presence instead: a lane
  // with no lease is already released, which is the common case on resume.
  const heldLease = readAllLeases(deps.leaseRegistryDir).find(
    (lease) => lease.issue_id === input.issueId && lease.status !== 'released',
  );
  const release = heldLease
    ? releaseLease(
        { issue_id: input.issueId, actor: input.actor, reason: `superseded by ${input.successor}` },
        { registryDir: deps.leaseRegistryDir },
      )
    : { ok: true, code: 'lease_absent', message: 'no held lease to release' };
  if (!release.ok) {
    return {
      ok: false,
      code: 'lease_release_failed',
      message: `Manifest committed but lease release failed (${release.code}): ${release.message}. Re-run to resume.`,
      issue_id: input.issueId,
      stage: 'manifest_committed',
      transaction_id: txId,
      exit_code: 1,
    };
  }
  writeTransaction({ transaction_id: txId, issue_id: input.issueId, stage: 'lease_released', inputs: input, updated_at: now() }, root);

  const finalManifest = readManifest(input.issueId);
  const verified = verifyReleased(finalManifest, readAllLeases(deps.leaseRegistryDir));
  if (!verified.ok) {
    return {
      ok: false,
      code: 'supersession_incomplete',
      message: `Supersession did not fully release resources: ${verified.failures.join(', ')}. Re-run to resume.`,
      issue_id: input.issueId,
      stage: 'lease_released',
      transaction_id: txId,
      verification: verified.checks,
      exit_code: 1,
    };
  }
  writeTransaction({ transaction_id: txId, issue_id: input.issueId, stage: 'complete', inputs: input, updated_at: now() }, root);

  return {
    ok: true,
    code: 'lane_superseded',
    message: `${input.issueId} superseded by ${input.successor}; PR #${input.sourcePr} did not merge`,
    issue_id: input.issueId,
    stage: 'complete',
    transaction_id: txId,
    idempotent: false,
    verification: verified.checks,
    exit_code: 0,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function parseArgv(argv: string[]): Partial<SupersedeInputs> {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    issueId: argv.find((a) => !a.startsWith('--') && /^UTV2-\d+$/i.test(a)),
    reason: flag('reason'),
    actor: flag('actor'),
    successor: flag('successor'),
    sourcePr: flag('source-pr'),
    rejectedHead: flag('rejected-head'),
  };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const result = supersedeLane(parseArgv(argv));
  emitJson(result);
  return result.exit_code;
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === new URL(`file://${path.resolve(argv1)}`).href) {
  process.exitCode = main();
}

export { fileURLToPath };
