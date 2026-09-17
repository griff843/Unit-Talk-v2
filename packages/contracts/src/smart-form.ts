export const smartFormDistributionModes = ['track-only', 'delivery-eligible'] as const;

export type SmartFormDistributionMode = (typeof smartFormDistributionModes)[number];

export interface CanonicalParticipantIdentity {
  participantId: string;
  displayName: string;
  participantType: 'team' | 'player' | 'competitor';
  teamId?: string | null;
}

export interface CanonicalParticipantResolution {
  resolution: 'canonical';
  sportId: string;
  eventId?: string | null;
  eventName?: string | null;
  away?: CanonicalParticipantIdentity | null;
  home?: CanonicalParticipantIdentity | null;
  team?: CanonicalParticipantIdentity | null;
  player?: CanonicalParticipantIdentity | null;
}

export interface ManualParticipantResolution {
  resolution: 'manual';
  sportId: string;
  eventId: null;
  manualOverride: true;
  reason: 'canonical-coverage-gap';
  enteredEventName: string;
  enteredParticipants: Array<{
    role: 'away' | 'home' | 'competitor' | 'team' | 'player';
    displayName: string;
    canonicalParticipantId: null;
  }>;
}

export type SmartFormParticipantResolution =
  | CanonicalParticipantResolution
  | ManualParticipantResolution;

export interface SmartFormSubmissionMetadata extends Record<string, unknown> {
  distributionMode: SmartFormDistributionMode;
  participantResolution: SmartFormParticipantResolution;
}

export function readSmartFormDistributionMode(
  metadata: Record<string, unknown> | null | undefined,
): SmartFormDistributionMode | null {
  const value = metadata?.['distributionMode'];
  return value === 'track-only' || value === 'delivery-eligible' ? value : null;
}

export function isTrackOnlyPickMetadata(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return readSmartFormDistributionMode(metadata) === 'track-only';
}

// ---------------------------------------------------------------------------
// UTV2-1923: human capper delivery authorization
// ---------------------------------------------------------------------------

/**
 * The server's recorded answer to "may this capper's pick be delivered to
 * members?", written onto the pick's metadata at submit time and never
 * accepted from a client. An authorized pick is delivered immediately; no
 * per-pick operator approval stands between a human capper and members.
 *
 * `cappers.active` and generic `cappers.metadata` are explicitly NOT
 * authorization: an active capper is one who may submit, which is a different
 * question from one whose picks may reach members. Authorization is an
 * explicit, server-side, deploy-set allow-list, and an empty or unset
 * allow-list authorizes nobody.
 */
export const humanCapperDeliveryAuthorizationVersion = 'human-capper-delivery/v1';

export const humanCapperDeliveryRefusalReasons = [
  /** The allow-list is unset or empty — the fail-closed default. */
  'allowlist-unset',
  /** The allow-list is populated and this capper is not on it. */
  'capper-not-allowlisted',
  /** The submission carried no authenticated capper identity. */
  'no-capper-identity',
  /** The deployment posture does not admit human capper delivery at all. */
  'human-delivery-posture-off',
] as const;
export type HumanCapperDeliveryRefusalReason =
  (typeof humanCapperDeliveryRefusalReasons)[number];

export interface HumanCapperDeliveryAuthorization {
  version: typeof humanCapperDeliveryAuthorizationVersion;
  decision: 'authorized' | 'refused';
  /** The canonical capper identity the decision was made about, if any. */
  capperId: string | null;
  /** Present only on a refusal — why delivery was not authorized. */
  reason?: HumanCapperDeliveryRefusalReason;
  /** Which server-side control supplied the answer, for auditability. */
  authority: 'server-allowlist';
  /** The env var the allow-list was read from. Never its contents. */
  allowlistSource: string;
  decidedAt: string;
}

/** The metadata key the authorization record is written to. */
export const humanCapperDeliveryAuthorizationKey = 'deliveryAuthorization';

/**
 * Read a well-formed authorization record off pick metadata.
 *
 * Returns null for anything that is not a complete, current-version record.
 * Every caller that grants delivery must require `decision === 'authorized'`
 * from this function — a malformed or absent record must never read as
 * permission.
 */
export function readHumanCapperDeliveryAuthorization(
  metadata: Record<string, unknown> | null | undefined,
): HumanCapperDeliveryAuthorization | null {
  const raw = metadata?.[humanCapperDeliveryAuthorizationKey];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (record['version'] !== humanCapperDeliveryAuthorizationVersion) {
    return null;
  }
  if (record['decision'] !== 'authorized' && record['decision'] !== 'refused') {
    return null;
  }
  if (record['authority'] !== 'server-allowlist') {
    return null;
  }
  if (typeof record['decidedAt'] !== 'string') {
    return null;
  }

  return raw as HumanCapperDeliveryAuthorization;
}

/**
 * Whether this pick's metadata carries a server decision authorizing delivery.
 * This is the ONLY predicate any delivery path may use to answer that question.
 */
export function isHumanCapperDeliveryAuthorized(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return readHumanCapperDeliveryAuthorization(metadata)?.decision === 'authorized';
}

// ---------------------------------------------------------------------------
// UTV2-1923 (destination routing): the capper's own Discord destination
// ---------------------------------------------------------------------------

/**
 * Version tag for the `cappers.metadata.discord` record.
 *
 * PM-ratified V1 storage: the existing `public.cappers.metadata` JSON column,
 * under a `discord` block. No new table, no migration.
 *
 * ```json
 * { "discord": { "guildId": "...", "picksChannelId": "...", "discussionChannelId": "..." } }
 * ```
 *
 * `picksChannelId` is that capper's picks-only destination and is the ONLY key
 * an official delivery may route to. `discussionChannelId` is the capper's
 * community / Capper Space destination and must never receive an official
 * pick — it is carried here solely so the two can be compared and a
 * misconfiguration that points them at the same place can be refused.
 */
export const capperDiscordRoutingVersion = 'capper-discord-routing/v1';

export const capperDiscordRoutingRefusalReasons = [
  /** No `cappers` row for this capper identity at all. */
  'capper-row-missing',
  /** The row exists but `metadata` is not a JSON object. */
  'capper-metadata-not-an-object',
  /** The row carries no `discord` block — the capper is simply not mapped. */
  'discord-routing-absent',
  /** A `discord` key exists but is not a JSON object. */
  'discord-routing-not-an-object',
  /** `guildId` missing, or not a Discord snowflake. */
  'guild-id-missing-or-malformed',
  /** `picksChannelId` missing, or not a Discord snowflake. */
  'picks-channel-missing-or-malformed',
  /** `discussionChannelId` present but not a Discord snowflake. */
  'discussion-channel-malformed',
  /** The two are configured to the same destination — refuse both. */
  'picks-channel-is-discussion-channel',
] as const;
export type CapperDiscordRoutingRefusalReason =
  (typeof capperDiscordRoutingRefusalReasons)[number];

export interface CapperDiscordRouting {
  version: typeof capperDiscordRoutingVersion;
  guildId: string;
  picksChannelId: string;
  /** Null when the capper has no separate discussion destination configured. */
  discussionChannelId: string | null;
}

export type CapperDiscordRoutingResult =
  | { ok: true; routing: CapperDiscordRouting }
  | { ok: false; reason: CapperDiscordRoutingRefusalReason };

/**
 * A Discord snowflake as it appears in configuration: a decimal id, 17–20
 * digits. Deliberately strict — an id with surrounding whitespace, a channel
 * *name*, a mention (`<#123>`) or a URL is malformed configuration, and
 * malformed configuration must fail closed rather than be repaired into
 * something plausible.
 */
export function isDiscordSnowflake(value: unknown): value is string {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

/**
 * Parse a capper's Discord routing out of its canonical `cappers.metadata`.
 *
 * Every exit is either a complete, valid routing or a NAMED refusal. There is
 * no partial success and no defaulting: a record missing `guildId`, carrying a
 * channel name where an id belongs, or pointing picks and discussion at the
 * same destination is refused, not repaired. `metadata` absent entirely is the
 * ordinary unmapped case and is refused the same way.
 *
 * Pass `null` for `metadata` when the `cappers` row itself was not found.
 */
export function readCapperDiscordRouting(
  metadata: unknown,
  options?: { rowFound?: boolean },
): CapperDiscordRoutingResult {
  if (options?.rowFound === false) {
    return { ok: false, reason: 'capper-row-missing' };
  }
  if (metadata === null || metadata === undefined) {
    return { ok: false, reason: 'capper-metadata-not-an-object' };
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { ok: false, reason: 'capper-metadata-not-an-object' };
  }

  const raw = (metadata as Record<string, unknown>)['discord'];
  if (raw === undefined || raw === null) {
    return { ok: false, reason: 'discord-routing-absent' };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'discord-routing-not-an-object' };
  }

  const block = raw as Record<string, unknown>;
  if (!isDiscordSnowflake(block['guildId'])) {
    return { ok: false, reason: 'guild-id-missing-or-malformed' };
  }
  if (!isDiscordSnowflake(block['picksChannelId'])) {
    return { ok: false, reason: 'picks-channel-missing-or-malformed' };
  }

  const rawDiscussion = block['discussionChannelId'];
  let discussionChannelId: string | null = null;
  if (rawDiscussion !== undefined && rawDiscussion !== null) {
    if (!isDiscordSnowflake(rawDiscussion)) {
      return { ok: false, reason: 'discussion-channel-malformed' };
    }
    discussionChannelId = rawDiscussion;
  }

  if (discussionChannelId !== null && discussionChannelId === block['picksChannelId']) {
    return { ok: false, reason: 'picks-channel-is-discussion-channel' };
  }

  return {
    ok: true,
    routing: {
      version: capperDiscordRoutingVersion,
      guildId: block['guildId'],
      picksChannelId: block['picksChannelId'],
      discussionChannelId,
    },
  };
}

/**
 * The outbox-payload key carrying the destination the SERVER resolved at
 * enqueue time.
 *
 * The destination is pinned onto the row rather than re-derived at delivery
 * time for one reason: the row must deliver to the place that was authorized
 * when it was created. Re-reading `cappers.metadata` in the worker would mean
 * an edit made between enqueue and delivery silently redirected an
 * already-authorized pick, and a shared target map would mean every capper's
 * picks converged on one channel. Neither is acceptable, so the worker routes
 * from this and refuses when it is absent.
 */
export const pinnedDeliveryDestinationKey = 'deliveryDestination';

export interface PinnedDeliveryDestination {
  version: typeof capperDiscordRoutingVersion;
  guildId: string;
  channelId: string;
  capperId: string;
  source: string;
}

/**
 * Read a pinned destination off an outbox payload. Returns null for anything
 * that is not a complete, current-version record — a malformed pin must read
 * as "no destination", never as a destination.
 */
export function readPinnedDeliveryDestination(
  payload: unknown,
): PinnedDeliveryDestination | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = (payload as Record<string, unknown>)[pinnedDeliveryDestinationKey];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  if (record['version'] !== capperDiscordRoutingVersion) return null;
  if (!isDiscordSnowflake(record['guildId'])) return null;
  if (!isDiscordSnowflake(record['channelId'])) return null;
  if (typeof record['capperId'] !== 'string' || record['capperId'].length === 0) return null;
  if (typeof record['source'] !== 'string' || record['source'].length === 0) return null;

  return raw as PinnedDeliveryDestination;
}
