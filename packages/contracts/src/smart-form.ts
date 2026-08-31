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
