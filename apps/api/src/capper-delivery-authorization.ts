/**
 * UTV2-1923 — human capper delivery authorization (W1).
 *
 * The single server-side answer to: is this authenticated capper's pick
 * deliverable to members, or is it internal Track Only tracking?
 *
 * Design constraints, all PM-ratified:
 *
 *   - **Explicit.** An allow-list of capper identities set on the server at
 *     deploy time. Not `cappers.active` (that says who may submit), not
 *     generic `cappers.metadata` (unconstrained, and writable from the
 *     operator surface).
 *   - **Fail-closed.** Unset, empty, or all-whitespace authorizes nobody. So
 *     does a deployment whose posture does not admit human delivery at all.
 *   - **Server-authoritative.** Nothing in the HTTP request can reach this
 *     function. It reads env and the authenticated identity, and that is all.
 *   - **Auditable.** Every call returns a record that is written onto the pick
 *     and into the audit log, including refusals and why.
 *
 * This IS the authorization, and it is deliberately the only one. Operator
 * approval governs autonomous producers -- the model, the board builder, the
 * scanner, the alert agent -- because those decide for themselves that a pick
 * should exist and nobody outside the system is accountable for the decision.
 * A human capper is a person making their own accountable selection, and the
 * operator's judgement about that person is exactly what putting them on this
 * list expressed. Asking for it again, per pick, would be asking the same
 * question twice. See `humanCapperDeliveryRequiresOperatorApproval` in
 * `distribution-service.ts`, which is `false` and asserted by test.
 *
 * What still stands between an authorized pick and members is not a second
 * decision but a set of CONTROLS, each of which fails closed on its own: the
 * target registry, the delivery kill switch, and the deploy posture. A control
 * that refuses is never a request for approval.
 */

import {
  humanCapperDeliveryAuthorizationVersion,
  type HumanCapperDeliveryAuthorization,
  type HumanCapperDeliveryRefusalReason,
} from '@unit-talk/contracts';

/** The env var carrying the allow-list. Its NAME is recorded; its contents never are. */
export const CAPPER_DELIVERY_ALLOWLIST_ENV = 'UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST';

/**
 * The deployment posture switch. Human capper delivery is off unless the
 * deployment says otherwise, independently of who is on the allow-list — so a
 * stale allow-list in a config file cannot by itself open the path.
 */
export const CAPPER_DELIVERY_POSTURE_ENV = 'UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED';

export interface CapperDeliveryAuthorizationEnv {
  UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST?: string | undefined;
  UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED?: string | undefined;
}

/**
 * Parse the allow-list. Case-insensitive on capper identity, whitespace
 * tolerant, and empty for every falsy or blank input.
 */
export function parseCapperDeliveryAllowlist(raw: string | undefined | null): string[] {
  if (typeof raw !== 'string') return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    ),
  ];
}

/** Whether the deployment admits human capper delivery at all. Default: no. */
export function isHumanCapperDeliveryPostureEnabled(
  env: CapperDeliveryAuthorizationEnv = process.env as CapperDeliveryAuthorizationEnv,
): boolean {
  return env.UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED === 'true';
}

export interface EvaluateCapperDeliveryInput {
  /** The authenticated capper identity, or null/undefined when there is none. */
  capperId?: string | null | undefined;
  /** True only when the request carried a `capper`-role bearer token. */
  isAuthenticatedCapper: boolean;
  env?: CapperDeliveryAuthorizationEnv;
  now?: Date;
}

/**
 * Decide, and produce the auditable record of the decision.
 *
 * Every exit produces a record. There is no path that returns "no opinion":
 * an absent decision would read downstream as an unauthorized pick, but it
 * would leave no trace of the question having been asked.
 */
export function evaluateCapperDeliveryAuthorization(
  input: EvaluateCapperDeliveryInput,
): HumanCapperDeliveryAuthorization {
  const env = input.env ?? (process.env as CapperDeliveryAuthorizationEnv);
  const decidedAt = (input.now ?? new Date()).toISOString();
  const capperId =
    typeof input.capperId === 'string' && input.capperId.trim().length > 0
      ? input.capperId.trim()
      : null;

  const refuse = (reason: HumanCapperDeliveryRefusalReason): HumanCapperDeliveryAuthorization => ({
    version: humanCapperDeliveryAuthorizationVersion,
    decision: 'refused',
    capperId,
    reason,
    authority: 'server-allowlist',
    allowlistSource: CAPPER_DELIVERY_ALLOWLIST_ENV,
    decidedAt,
  });

  if (!input.isAuthenticatedCapper || !capperId) {
    return refuse('no-capper-identity');
  }

  if (!isHumanCapperDeliveryPostureEnabled(env)) {
    return refuse('human-delivery-posture-off');
  }

  const allowlist = parseCapperDeliveryAllowlist(
    env.UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST,
  );
  if (allowlist.length === 0) {
    return refuse('allowlist-unset');
  }

  if (!allowlist.includes(capperId.toLowerCase())) {
    return refuse('capper-not-allowlisted');
  }

  return {
    version: humanCapperDeliveryAuthorizationVersion,
    decision: 'authorized',
    capperId,
    authority: 'server-allowlist',
    allowlistSource: CAPPER_DELIVERY_ALLOWLIST_ENV,
    decidedAt,
  };
}
