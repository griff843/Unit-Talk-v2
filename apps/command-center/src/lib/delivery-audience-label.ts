import { isMemberVisibleDeliveryAudience, readDeliveryAudience } from '@unit-talk/contracts';

export const STAFF_CANARY_LABEL = 'Staff canary: private staff destination, hidden from members';
export const UNRECOGNIZED_AUDIENCE_LABEL = 'Audience unrecognized: hidden from members (fail closed)';

function audiencePin(container: unknown, key: string): unknown {
  if (container === undefined || container === null) return undefined;
  if (typeof container !== 'object' || Array.isArray(container)) return null;
  const block = (container as Record<string, unknown>)[key];
  if (block === undefined) return undefined;
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return null;
  return (block as Record<string, unknown>)['audience'];
}

/** Only explicit pins can disagree; legacy absence is neutral for a canary label. */
export function deliveryAudienceLabel(
  metadata: unknown,
  outboxPayloads: readonly unknown[] = [],
): string | null {
  if (isMemberVisibleDeliveryAudience(metadata, outboxPayloads)) return null;

  const pins = [
    audiencePin(metadata, 'deliveryAuthorization'),
    audiencePin(metadata, 'deliveryDestination'),
    ...outboxPayloads.map((payload) => audiencePin(payload, 'deliveryDestination')),
  ].filter((pin) => pin !== undefined).map(readDeliveryAudience);

  if (pins.length > 0 && pins.every((pin) => pin === 'staff-canary')) {
    return STAFF_CANARY_LABEL;
  }
  return UNRECOGNIZED_AUDIENCE_LABEL;
}
