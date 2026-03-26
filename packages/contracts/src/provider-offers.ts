export type DevigMode = 'PAIRED' | 'FALLBACK_SINGLE_SIDED';

export interface NormalizedProviderOffer {
  providerKey: string;
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  sportKey: string | null;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  devigMode: DevigMode;
  isOpening: boolean;
  isClosing: boolean;
  snapshotAt: string;
  idempotencyKey: string;
}

// Marker interface for explicit insert intent on the persistence boundary.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ProviderOfferInsert extends NormalizedProviderOffer {}
