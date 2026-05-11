import { pickStatuses } from './schema.js';
import type { SettlementRecord } from './types.js';

const pickStatusSet = new Set<string>(pickStatuses);

export function assertValidPickStatus(
  status: string,
  context: string,
): void {
  if (!pickStatusSet.has(status)) {
    throw new Error(
      `Invalid picks.status for ${context}: ${status}. Expected one of ${pickStatuses.join(', ')}`,
    );
  }
}

export function assertNonEmptySubmissionEventName(eventName: string): void {
  if (eventName.trim().length === 0) {
    throw new Error(
      'Invalid submission_events.event_name: value must be a non-empty string',
    );
  }
}

export function assertSettlementCorrectionReference(
  settlements: readonly SettlementRecord[],
  correctsId: string | null | undefined,
  nextSettlementId: string,
): void {
  if (!correctsId) {
    return;
  }

  if (correctsId === nextSettlementId) {
    throw new Error(
      `Invalid settlement_records.corrects_id: ${correctsId} cannot reference itself`,
    );
  }

  const referencedSettlement = settlements.find(
    (settlement) => settlement.id === correctsId,
  );

  if (!referencedSettlement) {
    throw new Error(
      `Invalid settlement_records.corrects_id: ${correctsId} does not reference an existing settlement_records.id`,
    );
  }
}
