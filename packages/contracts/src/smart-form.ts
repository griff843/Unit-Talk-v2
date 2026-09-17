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
