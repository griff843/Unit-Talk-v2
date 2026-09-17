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
  capperDiscordRoutingRefusalReasons,
  humanCapperDeliveryAuthorizationVersion,
  readCapperDiscordRouting,
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

// ---------------------------------------------------------------------------
// UTV2-1923 (destination routing) — CAPPER_DELIVERY_DESTINATION_GUARD
// ---------------------------------------------------------------------------

/**
 * Authorization and DESTINATION are two different questions, and this file now
 * answers both because they must never be answered by different authorities.
 *
 * Above: *may* this capper's picks reach members. Below: *where* do they go.
 *
 * The answer to "where" is the capper's own picks-only destination, read from
 * the canonical `cappers` row the server loads itself. It is never a generic
 * shared channel, never a value the browser supplied, and never inferred from a
 * channel's name. A capper with no mapping — or a malformed one — delivers
 * NOWHERE; there is no default destination to fall back to, by design, because
 * every plausible default is either somebody else's channel or a channel the
 * pick was never meant to reach.
 */
export const CAPPER_DELIVERY_GUILD_ENV = 'DISCORD_GUILD_ID';

/**
 * The private, global capper channel. It is a single server-wide id and is not
 * anyone's official picks destination; routing a member-facing pick there would
 * publish it to the wrong audience. Named here so the check can refuse it.
 */
export const CAPPER_DELIVERY_RESERVED_CHANNEL_ENV = 'DISCORD_CAPPER_CHANNEL_ID';

export const capperDeliveryDestinationRefusalReasons = [
  ...capperDiscordRoutingRefusalReasons,
  /** The pick carries no canonical capper identity to route on. */
  'no-capper-identity',
  /** This bundle exposes no canonical capper reader, so routing cannot be proven. */
  'capper-routing-unavailable',
  /** The server does not know which guild it is supposed to be posting into. */
  'expected-guild-unset',
  /** The capper is mapped into a guild this deployment does not serve. */
  'guild-mismatch',
  /** The mapping points at the private global capper channel. */
  'picks-channel-is-reserved-global-channel',
] as const;
export type CapperDeliveryDestinationRefusalReason =
  (typeof capperDeliveryDestinationRefusalReasons)[number];

export interface CapperDeliveryDestination {
  capperId: string;
  guildId: string;
  /** The capper's own picks-only destination. */
  channelId: string;
  /** Where the value came from, recorded on the outbox row and in the audit log. */
  source: 'cappers.metadata.discord.picksChannelId';
}

export type CapperDeliveryDestinationResult =
  | { decision: 'routed'; destination: CapperDeliveryDestination }
  | { decision: 'refused'; reason: CapperDeliveryDestinationRefusalReason };

export interface CapperDeliveryDestinationEnv {
  DISCORD_GUILD_ID?: string | undefined;
  DISCORD_CAPPER_CHANNEL_ID?: string | undefined;
}

export interface ResolveCapperDeliveryDestinationInput {
  /** The canonical capper identity taken from the persisted pick / authorization record. */
  capperId: string;
  /** The `metadata` column of that capper's canonical `cappers` row. */
  capperMetadata: unknown;
  /** False when no `cappers` row exists for `capperId` at all. */
  capperRowFound: boolean;
  env?: CapperDeliveryDestinationEnv;
}

/**
 * Resolve the capper-specific member-facing destination, or refuse by name.
 *
 * Five requirements, each fail-closed and each independently tested:
 *
 *   1. the capper has a well-formed `metadata.discord` mapping;
 *   2. `guildId` is the guild this deployment actually serves;
 *   3. `picksChannelId` is present and is a Discord snowflake;
 *   4. `picksChannelId` is not the configured `discussionChannelId`;
 *   5. `picksChannelId` is not the private global capper channel.
 *
 * Requirement 4 is enforced inside `readCapperDiscordRouting`, so a record that
 * points both keys at one destination is refused before this function can read
 * either of them — the discussion destination has no path to delivery at all.
 */
export function resolveCapperDeliveryDestination(
  input: ResolveCapperDeliveryDestinationInput,
): CapperDeliveryDestinationResult {
  const env = input.env ?? (process.env as CapperDeliveryDestinationEnv);

  const parsed = readCapperDiscordRouting(input.capperMetadata, {
    rowFound: input.capperRowFound,
  });
  if (!parsed.ok) {
    return { decision: 'refused', reason: parsed.reason };
  }

  const expectedGuildId = env.DISCORD_GUILD_ID?.trim();
  if (!expectedGuildId) {
    return { decision: 'refused', reason: 'expected-guild-unset' };
  }
  if (parsed.routing.guildId !== expectedGuildId) {
    return { decision: 'refused', reason: 'guild-mismatch' };
  }

  const reservedChannelId = env.DISCORD_CAPPER_CHANNEL_ID?.trim();
  if (reservedChannelId && parsed.routing.picksChannelId === reservedChannelId) {
    return { decision: 'refused', reason: 'picks-channel-is-reserved-global-channel' };
  }

  return {
    decision: 'routed',
    destination: {
      capperId: input.capperId,
      guildId: parsed.routing.guildId,
      channelId: parsed.routing.picksChannelId,
      source: 'cappers.metadata.discord.picksChannelId',
    },
  };
}

export interface CapperRoutingReader {
  findById(capperId: string): Promise<{ metadata: unknown } | null>;
}

/**
 * Load the capper's canonical row and resolve its destination, or refuse.
 *
 * Structurally separated from `resolveCapperDeliveryDestination` so the
 * decision itself stays a pure function over the row, testable without a
 * repository — and so the I/O has exactly one place to fail closed.
 *
 * An absent reader is a REFUSAL, not a skip. A bundle that cannot read
 * `cappers` cannot prove where this pick belongs, and the only safe thing to
 * do with an unprovable destination is to deliver nowhere.
 */
export async function loadCapperDeliveryDestination(input: {
  capperId: string | null | undefined;
  capperRepository?: CapperRoutingReader | undefined;
  env?: CapperDeliveryDestinationEnv;
}): Promise<CapperDeliveryDestinationResult> {
  const capperId =
    typeof input.capperId === 'string' && input.capperId.trim().length > 0
      ? input.capperId.trim()
      : null;
  if (!capperId) {
    return { decision: 'refused', reason: 'no-capper-identity' };
  }
  if (!input.capperRepository) {
    return { decision: 'refused', reason: 'capper-routing-unavailable' };
  }

  const row = await input.capperRepository.findById(capperId);
  return resolveCapperDeliveryDestination({
    capperId,
    capperMetadata: row?.metadata ?? null,
    capperRowFound: row !== null,
    ...(input.env === undefined ? {} : { env: input.env }),
  });
}
