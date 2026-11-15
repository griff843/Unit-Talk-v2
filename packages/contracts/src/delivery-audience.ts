/** Server-resolved audience, pinned when a human-capper pick is released. */
export const deliveryAudiences = ['members', 'staff-canary'] as const;
export type DeliveryAudience = (typeof deliveryAudiences)[number];

/** Only legacy absence defaults to members. Malformed declarations never do. */
export function readDeliveryAudience(value: unknown): DeliveryAudience | null {
  if (value === undefined) return 'members';
  return value === 'members' || value === 'staff-canary' ? value : null;
}

function pinnedAudience(value: unknown, key: string): DeliveryAudience | null {
  if (value === undefined || value === null) return 'members';
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const block = (value as Record<string, unknown>)[key];
  if (block === undefined) return 'members';
  if (block === null || typeof block !== 'object' || Array.isArray(block))
    return null;
  return readDeliveryAudience((block as Record<string, unknown>)['audience']);
}

/**
 * Member reads must inspect the persisted pick and every associated delivery
 * pin. An unknown, private or disagreeing pin excludes the pick, never its
 * operator record. Old rows with no audience declaration remain members.
 */
export function isMemberVisibleDeliveryAudience(
  metadata: unknown,
  outboxPayloads: readonly unknown[] = [],
): boolean {
  return (
    pinnedAudience(metadata, 'deliveryAuthorization') === 'members' &&
    pinnedAudience(metadata, 'deliveryDestination') === 'members' &&
    outboxPayloads.every(
      (payload) => pinnedAudience(payload, 'deliveryDestination') === 'members',
    )
  );
}
