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

export interface BootstrapAuthorization {
  issue_id: string;
  lane_type: string;
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
  for (const ref of ['origin/main', 'main']) {
    try {
      return execFileSync('git', ['show', `${ref}:${BOOTSTRAP_AUTHORIZATIONS_PATH}`], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      // Try the next ref. A repository with neither ref, or without the file on
      // either, has no authorizations -- which is the safe default.
    }
  }
  return null;
}

export function parseAuthorizations(raw: string): BootstrapAuthorization[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const list = (parsed as { authorizations?: unknown }).authorizations;
  if (!Array.isArray(list)) return null;

  const required: (keyof BootstrapAuthorization)[] = [
    'issue_id',
    'lane_type',
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
    out.push(record as unknown as BootstrapAuthorization);
  }
  return out;
}

function isExpired(authorization: BootstrapAuthorization, now: Date): boolean {
  const expiry = new Date(authorization.expires_at);
  if (Number.isNaN(expiry.getTime())) return true; // unparseable expiry fails closed
  return expiry.getTime() <= now.getTime();
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
