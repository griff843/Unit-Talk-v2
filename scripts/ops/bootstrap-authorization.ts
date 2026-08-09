/**
 * Governance bootstrap authorization (UTV2-1619 capability 18).
 *
 * Admits exactly one named governance lane past the concurrency caps, under an
 * authorization that lives on `main` and cannot be forged by the branch it
 * admits.
 *
 * WHY THIS EXISTS. Capability 13 (lane lifecycle capacity semantics) is what
 * legitimately releases capacity, and it lives inside UTV2-1619 -- the issue the
 * caps refuse to admit. Measured 2026-08-05: total 15/10, claude 11/4,
 * governance 8/3. A PM-directed read-only investigation of the three
 * multi-identity Merge Gate PRs (#1289, #1290, #1293) recovered no capacity --
 * all three are genuinely blocked on `CHANGES_REQUIRED` verdicts and a missing
 * `t1-approved` label. So PM authorization was real and had no mechanical
 * representation.
 *
 * WHY NOT A FLAG. `lane-start` deliberately refuses caller-supplied overrides:
 * "a caller-supplied override is not proof of PM authorization" (PM review
 * finding #3). That reasoning is correct and is preserved here. This module does
 * not add a flag; the caller cannot assert an authorization at all. The grant is
 * read from `origin/main`, so issuing one requires landing a reviewed governance
 * PR -- the same trust property `scope-override/v1` relies on: a branch's own
 * diff cannot change what `main` says.
 *
 * WHY NOT A CAP INCREASE. A raised cap admits any lane that asks. An
 * authorization admits precisely the one issue named in it and refuses
 * everything else, including a different lane type for the same issue.
 *
 * This is not a bypass. Every other concurrency rule still runs; an
 * authorization suppresses only the cap violations it explicitly covers, and the
 * admission is recorded so an authorized lane is never indistinguishable from
 * one admitted under the caps.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BOOTSTRAP_AUTHORIZATIONS_PATH = 'docs/governance/BOOTSTRAP_AUTHORIZATIONS.json';

export const LANE_MANIFEST_DIR = 'docs/06_status/lanes';

/**
 * The explicit bootstrap signal.
 *
 * Recognition must never follow from an issue ID alone: `UTV2-1619` appears in
 * the branch of every ordinary lane on this issue, and an authorization naming
 * it must not silently convert those lanes into bootstrap actions. The branch
 * namespace is the signal, and it is GitHub-attested (`pull_request.head.ref`)
 * rather than read out of the PR's own files, so a diff cannot manufacture it.
 */
export const BOOTSTRAP_BRANCH_NAMESPACE = 'bootstrap/';

/**
 * Statuses that make a lane manifest an ACTIVE normal-lane identity.
 *
 * Deliberately identical to `SELF_SCOPE_STATUSES` in
 * `scripts/ci/file-scope-guard.ts`. The two must agree: if this module called a
 * lane "normal" on a definition the guard did not share, a PR could land in the
 * gap where recognition refuses bootstrap authority *and* the guard refuses to
 * resolve an own-manifest -- which is precisely the deadlock the first
 * implementation produced. Both files run standalone from `origin/main` and
 * cannot import a shared constant, so the set is duplicated with this note.
 */
const ACTIVE_LANE_STATUSES = new Set([
  'started',
  'in_progress',
  'in_review',
  'blocked',
  'reopened',
  'merged',
]);

const ISSUE_ID_PATTERN = /\bUTV2-\d+\b/i;

/** Exit codes. A consumer must be able to branch on the outcome without parsing. */
export const EXIT_BOOTSTRAP_VALID = 0;
export const EXIT_BOOTSTRAP_USAGE = 2;
export const EXIT_BOOTSTRAP_RECOGNIZED_INVALID = 3;
export const EXIT_BOOTSTRAP_NOT_RECOGNIZED = 4;

/** Cap-violation codes an authorization is permitted to suppress. */
const SUPPRESSIBLE_VIOLATION_CODES = new Set([
  'total_cap_exceeded',
  'claude_cap_exceeded',
  'codex_cap_exceeded',
  'governance_type_cap_exceeded',
]);

/** The only lane type a bootstrap authorization may ever admit. */
const ALLOWED_LANE_TYPE = 'governance';

/** Tiers a bootstrap identity may declare. */
const VALID_TIERS = new Set(['T1', 'T2', 'T3']);

export const BOOTSTRAP_GOVERNANCE_ACTION_ALLOWED_FILES: ReadonlySet<string> = new Set([
  BOOTSTRAP_AUTHORIZATIONS_PATH,
  '.github/workflows/branch-discipline-guard.yml',
  '.github/workflows/file-scope-lock-check.yml',
  '.github/workflows/return-review-packet.yml',
  'scripts/ci/file-scope-guard.ts',
  'scripts/ci/file-scope-guard.test.ts',
  'scripts/ops/bootstrap-authorization.ts',
  'scripts/ops/bootstrap-authorization.test.ts',
  'scripts/ops/branch-discipline-guard.ts',
  'scripts/ops/pr-review-packet.ts',
  'scripts/ops/pr-review-packet.test.ts',
  'package.json',
  '.ops/sync/UTV2-1619.yml',
  'docs/06_status/lanes/UTV2-1619.json',
  'docs/06_status/proof/UTV2-1619/bootstrap-admission-receipt.json',
  'docs/06_status/proof/UTV2-1619/diff-summary.md',
  'docs/06_status/proof/UTV2-1619/verification.md',
  'docs/06_status/proof/UTV2-1619/model-routing.json',
  'scripts/ops/bootstrap-identity-e2e.test.ts',
]);

export type BootstrapGovernanceActionRefusalCode =
  | BootstrapAuthorizationRefusalCode
  | 'bootstrap_intent_absent'
  | 'normal_lane_identified'
  | 'no_issue_identity'
  | 'branch_issue_mismatch'
  | 'missing_source_sha'
  | 'issue_identity_mismatch'
  | 'tier_mismatch'
  | 'scope_violation'
  | 'malformed_proposed_authorization'
  | 'multiple_proposed_active_authorizations';

export type BootstrapGovernanceActionResult =
  | {
      recognized: true;
      valid: true;
      kind: 'bootstrap_governance_action';
      issue_id: string;
      lane_type: 'governance';
      tier: string;
      allowed_scope: string[];
      authority: BootstrapAuthorization;
      authority_source: { ref: 'origin/main'; sha: string; path: string };
    }
  | {
      recognized: boolean;
      valid: false;
      kind: 'bootstrap_governance_action';
      code: BootstrapGovernanceActionRefusalCode;
      message: string;
    };

export interface BootstrapAuthorization {
  issue_id: string;
  lane_type: string;
  /**
   * UTV2-1619 capability 19: the tier Merge Gate resolves when no lane manifest
   * exists. This is what makes the artifact a *governance identity* rather than
   * only an admission grant -- without it, a bootstrap PR is unmergeable, since
   * Merge Gate errors unconditionally on a missing authoritative tier and the
   * only producer of a lane manifest is the `lane-start` the caps refuse.
   */
  tier: string;
  authorized_by: string;
  authorized_at: string;
  expires_at: string;
  milestone: string;
  reason: string;
}

export type BootstrapAuthorizationRefusalCode =
  | 'no_authorization_file'
  | 'malformed_authorization_file'
  | 'no_authorization_for_issue'
  | 'lane_type_not_authorized'
  | 'lane_type_not_governance'
  | 'authorization_expired'
  | 'multiple_active_authorizations';

export type BootstrapAuthorizationResult =
  | { authorized: true; authorization: BootstrapAuthorization }
  | { authorized: false; code: BootstrapAuthorizationRefusalCode; message: string };

/**
 * Read the authorization file from `origin/main` rather than the working tree.
 *
 * This is the whole trust property. Reading the working-tree copy would let any
 * branch grant itself admission by adding a file -- exactly the
 * manifest-embedded `scope_override` loophole that `scope-override/v1` was
 * created to close. Returning null on any git failure is correct and
 * fail-closed: no readable authorization means no authorization.
 */
export function readAuthorizationsFromMain(cwd: string): string | null {
  try {
    return execFileSync('git', ['show', `origin/main:${BOOTSTRAP_AUTHORIZATIONS_PATH}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/**
 * Resolve the exact commit the authorization was read from.
 *
 * Recorded in the admission receipt so the grant can be re-verified later
 * against the precise content that authorized the admission. Without it, a
 * receipt names an authorization whose text may since have been edited or
 * removed, and the audit trail cannot be closed.
 */
export function resolveAuthorizationSourceSha(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'origin/main'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The explicit bootstrap signal, derived inside the trusted resolver.
 *
 * Derived here rather than passed in by the caller so that all three consumers
 * apply one rule read from `origin/main`. A workflow that computed intent in
 * shell would be three copies of a security-relevant predicate, each editable
 * independently of the resolver that trusts it.
 */
export function hasBootstrapIntent(branch: string | null | undefined): boolean {
  return typeof branch === 'string' && branch.startsWith(BOOTSTRAP_BRANCH_NAMESPACE);
}

export function extractIssueId(text: string | null | undefined): string | null {
  const match = typeof text === 'string' ? text.match(ISSUE_ID_PATTERN) : null;
  return match ? match[0].toUpperCase() : null;
}

export interface NormalLaneIdentity {
  identified: boolean;
  status: string | null;
  reason: string;
}

/**
 * Decide whether an ACTIVE normal lane already identifies this action.
 *
 * Step A of the recognition order. A manifest that resolves active for the
 * issue means the lane system already has an identity for this work, so the
 * bootstrap path must never be evaluated -- an authorization exists to cover
 * the case where no lane identity *can* be created, not to give a second
 * identity to work that already has one.
 *
 * A malformed manifest counts as identified. That direction is the fail-closed
 * one: the only thing an unreadable manifest can do here is withhold a
 * privileged path, never grant one.
 */
export function resolveNormalLaneIdentity(input: {
  manifestRaw: string | null;
  issueId: string;
}): NormalLaneIdentity {
  if (input.manifestRaw === null) {
    return { identified: false, status: null, reason: 'No lane manifest resolves for this issue.' };
  }
  let manifest: { issue_id?: unknown; status?: unknown };
  try {
    manifest = JSON.parse(input.manifestRaw) as { issue_id?: unknown; status?: unknown };
  } catch {
    return {
      identified: true,
      status: null,
      reason: 'Lane manifest is unreadable; refusing bootstrap rather than assuming no lane exists.',
    };
  }
  const manifestIssue = typeof manifest.issue_id === 'string' ? manifest.issue_id.toUpperCase() : null;
  const status = typeof manifest.status === 'string' ? manifest.status : null;
  if (manifestIssue !== input.issueId.toUpperCase()) {
    return { identified: false, status, reason: 'Lane manifest names a different issue.' };
  }
  if (status !== null && ACTIVE_LANE_STATUSES.has(status)) {
    return { identified: true, status, reason: `An active lane manifest (status "${status}") identifies this issue.` };
  }
  return {
    identified: false,
    status,
    reason: `Lane manifest for this issue is not active (status "${status ?? '<missing>'}").`,
  };
}

/**
 * Resolve the lane manifest the same way `scripts/ci/file-scope-guard.ts` does:
 * base content wins for a path that exists on base, and a manifest introduced
 * by this branch is pinned to the commit that first added it. Reading the head
 * tip instead would let a PR decide its own recognition by rewriting a file in
 * its own diff.
 */
export function readTrustedLaneManifest(cwd: string, issueId: string, headRef: string): string | null {
  const relativePath = `${LANE_MANIFEST_DIR}/${issueId.toUpperCase()}.json`;
  const fromBase = gitShow(cwd, `origin/main:${relativePath}`);
  if (fromBase !== null) return fromBase;

  const firstAdding = gitOutput(cwd, [
    'log', '--reverse', '--format=%H', '--diff-filter=A', `origin/main..${headRef}`, '--', relativePath,
  ]);
  const firstSha = firstAdding?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
  if (!firstSha) return null;
  return gitShow(cwd, `${firstSha}:${relativePath}`);
}

function gitOutput(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function gitShow(cwd: string, spec: string): string | null {
  return gitOutput(cwd, ['show', spec]);
}

export interface BootstrapBranchBinding {
  ok: boolean;
  errors: string[];
}

/**
 * Branch-discipline binding for a recognized bootstrap action.
 *
 * Lives in the trusted resolver rather than in `branch-discipline-guard.ts`
 * because that guard runs from the PR head, and `branch-discipline-guard.ts` is
 * itself inside the bootstrap allowlist -- a bootstrap PR could otherwise edit
 * the rule that binds it. The body is deliberately excluded: a governance
 * action routinely explains which other issues it recovers, and naming them is
 * not a discipline violation. Branch, title, and commit subjects are the
 * identity surface and must name only the authorized issue.
 */
export function evaluateBootstrapBranchBinding(input: {
  issueId: string;
  branch?: string;
  title?: string;
  commits?: string;
}): BootstrapBranchBinding {
  const expected = input.issueId.toUpperCase();
  const errors: string[] = [];
  const collect = (text: string | undefined): string[] => {
    const found = new Set<string>();
    for (const match of (text ?? '').matchAll(/\b(?:UTV2|UNI)-\d+\b/gi)) found.add(match[0].toUpperCase());
    return [...found].sort();
  };
  const branchIds = collect(input.branch);
  const bindingIds = collect([input.branch ?? '', input.title ?? '', input.commits ?? ''].join('\n'));
  if (branchIds.length !== 1 || branchIds[0] !== expected) {
    errors.push(`Bootstrap action branch must reference only ${expected}; found ${branchIds.join(', ') || '<none>'}.`);
  }
  if (bindingIds.length !== 1 || bindingIds[0] !== expected) {
    errors.push(
      `Bootstrap action branch, title, and commits must bind only ${expected}; found ${bindingIds.join(', ') || '<none>'}.`,
    );
  }
  return { ok: errors.length === 0, errors };
}

export interface BootstrapAdmissionReceipt {
  schema_version: 1;
  kind: 'bootstrap_admission_receipt';
  issue_id: string;
  lane_type: string;
  tier: string;
  branch: string;
  admitted_at: string;
  /** The grant, copied verbatim, as it read at admission time. */
  authorization: BootstrapAuthorization;
  authorization_source: {
    path: string;
    ref: string;
    /** Commit the grant was read from; null if it could not be resolved. */
    sha: string | null;
  };
  /** Cap violations the authorization suppressed. Never structural ones. */
  suppressed_violations: { code: string; message: string }[];
  /** Violations that still had to pass on their own merits. */
  remaining_violations: { code: string; message: string }[];
  /** The board the admission decision was made against. */
  board_at_admission: unknown;
  /**
   * Stated plainly so a later reader cannot mistake this for a normal
   * admission, which is the entire point of a bootstrap identity.
   */
  note: string;
}

export function buildBootstrapAdmissionReceipt(input: {
  authorization: BootstrapAuthorization;
  laneType: string;
  branch: string;
  admittedAt: string;
  sourceSha: string | null;
  suppressed: { code: string; message: string }[];
  remaining: { code: string; message: string }[];
  board: unknown;
}): BootstrapAdmissionReceipt {
  return {
    schema_version: 1,
    kind: 'bootstrap_admission_receipt',
    issue_id: input.authorization.issue_id,
    lane_type: input.laneType,
    tier: input.authorization.tier,
    branch: input.branch,
    admitted_at: input.admittedAt,
    authorization: input.authorization,
    authorization_source: {
      path: BOOTSTRAP_AUTHORIZATIONS_PATH,
      ref: 'origin/main',
      sha: input.sourceSha,
    },
    suppressed_violations: input.suppressed,
    remaining_violations: input.remaining,
    board_at_admission: input.board,
    note:
      'This lane was admitted under a bootstrap governance identity, not under the ' +
      'concurrency caps. It does not assert that normal lane admission occurred. Only ' +
      'capacity violations were suppressed; every structural rule was applied unchanged.',
  };
}

export function parseAuthorizations(raw: string): BootstrapAuthorization[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const document = parsed as { schema_version?: unknown; authorizations?: unknown };
  if (document.schema_version !== 1) return null;
  const list = document.authorizations;
  if (!Array.isArray(list)) return null;

  const required: (keyof BootstrapAuthorization)[] = [
    'issue_id',
    'lane_type',
    'tier',
    'authorized_by',
    'authorized_at',
    'expires_at',
    'milestone',
    'reason',
  ];
  const out: BootstrapAuthorization[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    for (const field of required) {
      const value = record[field];
      if (typeof value !== 'string' || value.trim() === '') return null;
    }
    if (!/^UTV2-\d+$/i.test(String(record['issue_id']))) return null;
    if (Number.isNaN(Date.parse(String(record['authorized_at'])))) return null;
    // Preserve the established fail-closed expiry classification: an
    // unparseable expiry is a structurally present grant that is always
    // expired, never a usable authorization.
    // An unrecognised tier fails the whole file rather than defaulting. A
    // bootstrap identity supplies the tier Merge Gate would otherwise read from
    // a lane manifest, so a wrong or invented tier would silently move a PR
    // between verification regimes.
    if (!VALID_TIERS.has(String(record['tier']).toUpperCase())) return null;
    out.push(record as unknown as BootstrapAuthorization);
  }
  return out;
}

function isExpired(authorization: BootstrapAuthorization, now: Date): boolean {
  const expiry = new Date(authorization.expires_at);
  if (Number.isNaN(expiry.getTime())) return true; // unparseable expiry fails closed
  return expiry.getTime() <= now.getTime();
}

function countActive(authorizations: BootstrapAuthorization[], now: Date): number {
  return authorizations.filter((authorization) => !isExpired(authorization, now)).length;
}

/**
 * Resolve a bootstrap PR from base authority only. The proposed/head document
 * is validated as payload but is never consulted as authority.
 *
 * RECOGNITION ORDER. The first two steps run before any authorization file is
 * read, and that ordering is load-bearing rather than stylistic:
 *
 *   A. Does an active normal lane identity already exist? If so, stop -- normal
 *      lane validation owns this PR and bootstrap is never evaluated.
 *   B. Did the action explicitly signal bootstrap identity? If not, stop.
 *   C. Only now read the grant from `origin/main`.
 *
 * Because a malformed or over-accumulated authorization file can only be
 * reached at step C, neither can change the outcome for a PR that is not
 * explicitly claiming bootstrap identity. That is the blast-radius property:
 * a bad grant fails closed for bootstrap actions and is invisible to everyone
 * else.
 */
export function resolveBootstrapGovernanceAction(input: {
  issueId: string;
  laneType: string;
  tier: string;
  changedFiles: string[];
  branch?: string;
  bootstrapIntent?: boolean;
  normalLaneIdentified?: boolean;
  normalLaneReason?: string;
  baseAuthorizationsRaw: string | null;
  baseSourceSha: string | null;
  proposedAuthorizationsRaw?: string | null;
  now?: Date;
}): BootstrapGovernanceActionResult {
  const now = input.now ?? new Date();

  // Step A -- an existing active lane identity always wins.
  if (input.normalLaneIdentified) {
    return {
      recognized: false,
      valid: false,
      kind: 'bootstrap_governance_action',
      code: 'normal_lane_identified',
      message:
        input.normalLaneReason ?? 'A manifest-backed execution lane already identifies this action.',
    };
  }

  // Step B -- explicit signalling. Never inferred from the issue ID.
  if (!input.bootstrapIntent) {
    return {
      recognized: false,
      valid: false,
      kind: 'bootstrap_governance_action',
      code: 'bootstrap_intent_absent',
      message: 'The action did not explicitly claim bootstrap governance identity.',
    };
  }

  if (!input.issueId || !ISSUE_ID_PATTERN.test(input.issueId)) {
    return {
      recognized: true,
      valid: false,
      kind: 'bootstrap_governance_action',
      code: 'no_issue_identity',
      message: 'A bootstrap action must carry exactly one UTV2-### identity.',
    };
  }

  if (input.branch !== undefined) {
    const branchIssue = extractIssueId(input.branch);
    if (branchIssue === null || branchIssue !== input.issueId.toUpperCase()) {
      return {
        recognized: true,
        valid: false,
        kind: 'bootstrap_governance_action',
        code: 'branch_issue_mismatch',
        message: `Bootstrap branch "${input.branch}" does not name ${input.issueId.toUpperCase()}.`,
      };
    }
  }

  // Step C -- authority, read from origin/main only.
  const authority = evaluateBootstrapAuthorization({
    issueId: input.issueId,
    laneType: input.laneType,
    authorizationsRaw: input.baseAuthorizationsRaw,
    now,
  });
  if (!authority.authorized) {
    // Past the intent gate, this IS a bootstrap action -- so every authority
    // failure is reported as a recognized refusal carrying the real reason.
    // Reporting "not recognized" here would hand the operator the least useful
    // answer available ("ordinary validation applies") for the case where they
    // most need to know their grant is missing, expired, or duplicated. It is
    // safe precisely because steps A and B already excluded every PR that did
    // not explicitly claim bootstrap identity.
    return {
      recognized: true,
      valid: false,
      kind: 'bootstrap_governance_action',
      code: authority.code,
      message: authority.message,
    };
  }
  if (!input.baseSourceSha || !/^[0-9a-f]{40}$/i.test(input.baseSourceSha)) {
    return {
      recognized: true,
      valid: false,
      kind: 'bootstrap_governance_action',
      code: 'missing_source_sha',
      message: 'Bootstrap authority source SHA from origin/main is missing or invalid.',
    };
  }
  if (authority.authorization.issue_id.toUpperCase() !== input.issueId.toUpperCase()) {
    return {
      recognized: true,
      valid: false,
      kind: 'bootstrap_governance_action',
      code: 'issue_identity_mismatch',
      message: `Bootstrap action ${input.issueId} does not match authority ${authority.authorization.issue_id}.`,
    };
  }
  if (authority.authorization.tier.toUpperCase() !== input.tier.toUpperCase()) {
    return {
      recognized: true,
      valid: false,
      kind: 'bootstrap_governance_action',
      code: 'tier_mismatch',
      message: `Bootstrap action tier ${input.tier} does not match authority tier ${authority.authorization.tier}.`,
    };
  }
  const outsideScope = input.changedFiles.filter(
    (filePath) => !BOOTSTRAP_GOVERNANCE_ACTION_ALLOWED_FILES.has(filePath),
  );
  if (input.changedFiles.length === 0 || outsideScope.length > 0) {
    return {
      recognized: true,
      valid: false,
      kind: 'bootstrap_governance_action',
      code: 'scope_violation',
      message: outsideScope.length > 0
        ? `Bootstrap action changes files outside its fixed scope: ${outsideScope.join(', ')}.`
        : 'Bootstrap action has an empty or unknown diff.',
    };
  }
  if (input.changedFiles.includes(BOOTSTRAP_AUTHORIZATIONS_PATH)) {
    const proposed = input.proposedAuthorizationsRaw == null
      ? null
      : parseAuthorizations(input.proposedAuthorizationsRaw);
    if (proposed === null) {
      return {
        recognized: true,
        valid: false,
        kind: 'bootstrap_governance_action',
        code: 'malformed_proposed_authorization',
        message: 'The proposed bootstrap authorization document is malformed.',
      };
    }
    if (countActive(proposed, now) > 1) {
      return {
        recognized: true,
        valid: false,
        kind: 'bootstrap_governance_action',
        code: 'multiple_proposed_active_authorizations',
        message: 'The proposed bootstrap authorization document contains multiple active grants.',
      };
    }
  }

  return {
    recognized: true,
    valid: true,
    kind: 'bootstrap_governance_action',
    issue_id: authority.authorization.issue_id.toUpperCase(),
    lane_type: 'governance',
    tier: authority.authorization.tier.toUpperCase(),
    allowed_scope: [...BOOTSTRAP_GOVERNANCE_ACTION_ALLOWED_FILES],
    authority: authority.authorization,
    authority_source: {
      ref: 'origin/main',
      sha: input.baseSourceSha,
      path: BOOTSTRAP_AUTHORIZATIONS_PATH,
    },
  };
}

/**
 * Decide whether a bootstrap authorization admits this lane.
 *
 * Every refusal path returns a reason. A silent false would be indistinguishable
 * from "no authorization exists", which is the state an operator most needs to
 * tell apart from "your authorization expired".
 */
export function evaluateBootstrapAuthorization(input: {
  issueId: string;
  laneType: string;
  authorizationsRaw: string | null;
  now?: Date;
}): BootstrapAuthorizationResult {
  const now = input.now ?? new Date();

  if (input.authorizationsRaw === null) {
    return {
      authorized: false,
      code: 'no_authorization_file',
      message: `No ${BOOTSTRAP_AUTHORIZATIONS_PATH} on main; no bootstrap authorization exists.`,
    };
  }

  const authorizations = parseAuthorizations(input.authorizationsRaw);
  if (authorizations === null) {
    return {
      authorized: false,
      code: 'malformed_authorization_file',
      message:
        `${BOOTSTRAP_AUTHORIZATIONS_PATH} on main is malformed or has an entry missing ` +
        'required fields. A malformed authorization file authorizes nothing.',
    };
  }

  // Accumulation guard: standing authorizations must not pile up into a de facto
  // cap increase. More than one unexpired grant is refused outright rather than
  // resolved by picking one, because "which grant applied" must never be a
  // question with more than one answer.
  const active = authorizations.filter((entry) => !isExpired(entry, now));
  if (active.length > 1) {
    return {
      authorized: false,
      code: 'multiple_active_authorizations',
      message:
        `${active.length} unexpired bootstrap authorizations exist (${active
          .map((entry) => entry.issue_id)
          .join(', ')}). At most one may be active; expire or remove the others.`,
    };
  }

  const forIssue = authorizations.filter(
    (entry) => entry.issue_id.toUpperCase() === input.issueId.toUpperCase(),
  );
  if (forIssue.length === 0) {
    return {
      authorized: false,
      code: 'no_authorization_for_issue',
      message: `No bootstrap authorization on main names ${input.issueId}.`,
    };
  }

  for (const authorization of forIssue) {
    // Named lane only: the grant's own lane_type must be governance, and the
    // lane being started must match it. Both directions are checked so a grant
    // written for the wrong type cannot admit a governance lane either.
    if (authorization.lane_type !== ALLOWED_LANE_TYPE) {
      return {
        authorized: false,
        code: 'lane_type_not_governance',
        message:
          `Bootstrap authorization for ${authorization.issue_id} declares lane_type ` +
          `"${authorization.lane_type}"; only "${ALLOWED_LANE_TYPE}" may be authorized.`,
      };
    }
    if (input.laneType !== authorization.lane_type) {
      return {
        authorized: false,
        code: 'lane_type_not_authorized',
        message:
          `Bootstrap authorization for ${authorization.issue_id} covers lane_type ` +
          `"${authorization.lane_type}", but this lane is "${input.laneType}".`,
      };
    }
    if (isExpired(authorization, now)) {
      return {
        authorized: false,
        code: 'authorization_expired',
        message:
          `Bootstrap authorization for ${authorization.issue_id} expired at ` +
          `${authorization.expires_at}. Issue a new one through a governance PR if still needed.`,
      };
    }
    return { authorized: true, authorization };
  }

  /* c8 ignore next 5 -- unreachable: the loop returns on its first iteration and
     forIssue is non-empty by the check above. Present so the function is total. */
  return {
    authorized: false,
    code: 'no_authorization_for_issue',
    message: `No usable bootstrap authorization on main names ${input.issueId}.`,
  };
}

/**
 * Partition concurrency violations into those an authorization covers and those
 * it does not.
 *
 * An authorization suppresses cap violations only. Structural rules --
 * forbidden lane-type combinations, singleton paths, per-target verification
 * caps -- are safety properties rather than capacity limits, and are never
 * suppressed. If any of those fire, the lane is still refused with an
 * authorization in hand, which is the intended behavior.
 */
export function partitionViolations<T extends { code: string }>(
  violations: readonly T[],
): { suppressible: T[]; blocking: T[] } {
  const suppressible: T[] = [];
  const blocking: T[] = [];
  for (const violation of violations) {
    if (SUPPRESSIBLE_VIOLATION_CODES.has(violation.code)) suppressible.push(violation);
    else blocking.push(violation);
  }
  return { suppressible, blocking };
}

function cliFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

export function resolveBootstrapGovernanceActionFromRepository(input: {
  cwd: string;
  issueId: string;
  tier: string;
  changedFiles: string[];
  branch?: string;
  headRef?: string;
  now?: Date;
}): BootstrapGovernanceActionResult {
  const headRef = input.headRef ?? 'HEAD';
  const laneIdentity = resolveNormalLaneIdentity({
    manifestRaw: input.issueId ? readTrustedLaneManifest(input.cwd, input.issueId, headRef) : null,
    issueId: input.issueId || 'UTV2-0',
  });
  let proposedAuthorizationsRaw: string | null | undefined;
  if (input.changedFiles.includes(BOOTSTRAP_AUTHORIZATIONS_PATH)) {
    proposedAuthorizationsRaw = gitShow(input.cwd, `${headRef}:${BOOTSTRAP_AUTHORIZATIONS_PATH}`);
  }
  return resolveBootstrapGovernanceAction({
    issueId: input.issueId,
    laneType: 'governance',
    tier: input.tier,
    changedFiles: input.changedFiles,
    branch: input.branch,
    bootstrapIntent: hasBootstrapIntent(input.branch),
    normalLaneIdentified: laneIdentity.identified,
    normalLaneReason: laneIdentity.reason,
    baseAuthorizationsRaw: readAuthorizationsFromMain(input.cwd),
    baseSourceSha: resolveAuthorizationSourceSha(input.cwd),
    proposedAuthorizationsRaw,
    now: input.now,
  });
}

/**
 * CLI contract.
 *
 * `--branch` is required and is the only intent source; there is no
 * `--bootstrap-intent` flag, because a caller-asserted intent flag is one more
 * thing a workflow could get wrong independently of the resolver that trusts
 * it. The exit code -- not the file's contents -- is what a consumer branches
 * on:
 *
 *   0  valid bootstrap action
 *   2  usage error (fail closed)
 *   3  recognized as a bootstrap action and REFUSED (fail closed)
 *   4  not a bootstrap action; ordinary validation applies
 *
 * The decision file is always written before returning, so a consumer never
 * reads a stale artifact from an earlier run and mistakes it for this one.
 */
export function main(argv = process.argv.slice(2)): number {
  const issueIdFlag = cliFlag(argv, '--resolve-action');
  if (issueIdFlag === null) return EXIT_BOOTSTRAP_NOT_RECOGNIZED;
  const tier = cliFlag(argv, '--tier') ?? '';
  const changedFilesFile = cliFlag(argv, '--changed-files-file');
  const output = cliFlag(argv, '--output-json');
  const headRef = cliFlag(argv, '--head') ?? 'HEAD';
  const branch = cliFlag(argv, '--branch');
  const title = cliFlag(argv, '--title') ?? undefined;
  const commitsFile = cliFlag(argv, '--commits-file');
  if (!changedFilesFile || !output || branch === null) {
    process.stderr.write(
      'Bootstrap action resolution requires --branch, --changed-files-file and --output-json.\n',
    );
    return EXIT_BOOTSTRAP_USAGE;
  }

  let changedFiles: string[];
  let commits: string | undefined;
  try {
    changedFiles = fs
      .readFileSync(changedFilesFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    commits = commitsFile ? fs.readFileSync(commitsFile, 'utf8') : undefined;
  } catch (error) {
    process.stderr.write(`Bootstrap action resolution could not read its inputs: ${String(error)}\n`);
    return EXIT_BOOTSTRAP_USAGE;
  }

  const issueId = issueIdFlag || extractIssueId(branch) || '';
  let result = resolveBootstrapGovernanceActionFromRepository({
    cwd: process.cwd(), issueId, tier, changedFiles, branch, headRef,
  });

  // Branch-discipline binding is part of the authorization decision, not a
  // separate downstream opinion, so it is enforced here where the code is
  // base-pinned. Only checked once the action is otherwise valid, so a refusal
  // reports the authority problem rather than a derived symptom of it.
  if (result.valid && (title !== undefined || commits !== undefined)) {
    const binding = evaluateBootstrapBranchBinding({ issueId: result.issue_id, branch, title, commits });
    if (!binding.ok) {
      result = {
        recognized: true,
        valid: false,
        kind: 'bootstrap_governance_action',
        code: 'branch_issue_mismatch',
        message: binding.errors.join(' '),
      };
    }
  }

  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.valid) return EXIT_BOOTSTRAP_VALID;
  return result.recognized ? EXIT_BOOTSTRAP_RECOGNIZED_INVALID : EXIT_BOOTSTRAP_NOT_RECOGNIZED;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
