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
]);

export type BootstrapGovernanceActionRefusalCode =
  | BootstrapAuthorizationRefusalCode
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
 */
export function resolveBootstrapGovernanceAction(input: {
  issueId: string;
  laneType: string;
  tier: string;
  changedFiles: string[];
  baseAuthorizationsRaw: string | null;
  baseSourceSha: string | null;
  proposedAuthorizationsRaw?: string | null;
  now?: Date;
}): BootstrapGovernanceActionResult {
  const now = input.now ?? new Date();
  const authority = evaluateBootstrapAuthorization({
    issueId: input.issueId,
    laneType: input.laneType,
    authorizationsRaw: input.baseAuthorizationsRaw,
    now,
  });
  if (!authority.authorized) {
    return {
      recognized: authority.code !== 'no_authorization_file' && authority.code !== 'no_authorization_for_issue',
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
  headRef?: string;
  now?: Date;
}): BootstrapGovernanceActionResult {
  let proposedAuthorizationsRaw: string | null | undefined;
  if (input.changedFiles.includes(BOOTSTRAP_AUTHORIZATIONS_PATH)) {
    try {
      proposedAuthorizationsRaw = execFileSync(
        'git',
        ['show', `${input.headRef ?? 'HEAD'}:${BOOTSTRAP_AUTHORIZATIONS_PATH}`],
        { cwd: input.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch {
      proposedAuthorizationsRaw = null;
    }
  }
  return resolveBootstrapGovernanceAction({
    issueId: input.issueId,
    laneType: 'governance',
    tier: input.tier,
    changedFiles: input.changedFiles,
    baseAuthorizationsRaw: readAuthorizationsFromMain(input.cwd),
    baseSourceSha: resolveAuthorizationSourceSha(input.cwd),
    proposedAuthorizationsRaw,
    now: input.now,
  });
}

function main(argv = process.argv.slice(2)): number {
  const issueId = cliFlag(argv, '--resolve-action');
  if (!issueId) return 0;
  const tier = cliFlag(argv, '--tier') ?? '';
  const changedFilesFile = cliFlag(argv, '--changed-files-file');
  const output = cliFlag(argv, '--output-json');
  const headRef = cliFlag(argv, '--head') ?? 'HEAD';
  if (!changedFilesFile || !output) {
    process.stderr.write('Bootstrap action resolution requires --changed-files-file and --output-json.\n');
    return 2;
  }
  const changedFiles = fs.readFileSync(changedFilesFile, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = resolveBootstrapGovernanceActionFromRepository({
    cwd: process.cwd(), issueId, tier, changedFiles, headRef,
  });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.valid ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
