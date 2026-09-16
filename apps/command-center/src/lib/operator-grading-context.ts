import {
  validateOperatorGradingContext,
  type OperatorGradingContext,
  type SettlementConfidence,
} from '@unit-talk/contracts';

/**
 * What the operator actually types. Every field arrives as a string from a form
 * control, including `observedAt`, so this is deliberately not
 * `OperatorGradingContext` — it is the untrusted shape on the way in.
 */
export interface OperatorGradingContextInput {
  outcomeBasis: string;
  resultSourceUrl: string;
  observedAt: string;
  confidence?: SettlementConfidence;
  notes?: string;
}

export type OperatorGradingContextResolution =
  | { ok: true; context: OperatorGradingContext; evidenceRef: string }
  | { ok: false; errors: string[] };

/**
 * Trims the operator's input and validates it through the *canonical* contract
 * validator rather than a second copy of those rules.
 *
 * This matters more than it looks. `apps/api/src/settlement-service.ts` fails
 * closed on a missing or malformed grading context, and a client-side copy of
 * the same rules is free to drift away from it — at which point the Command
 * Center either refuses what the API would accept, or (worse) accepts what the
 * API will refuse and surfaces a bare 400 to the operator. Importing
 * `validateOperatorGradingContext` from `@unit-talk/contracts` makes drift
 * impossible: there is one definition of a well-formed attestation.
 *
 * Validating here does not weaken the server. The server still fails closed on
 * its own; this exists so the operator is told *which* field is missing before
 * a network round trip, instead of retrying blind.
 */
export function resolveOperatorGradingContext(
  input: OperatorGradingContextInput,
): OperatorGradingContextResolution {
  const context: OperatorGradingContext = {
    outcomeBasis: input.outcomeBasis?.trim() ?? '',
    resultSourceUrl: input.resultSourceUrl?.trim() ?? '',
    observedAt: input.observedAt?.trim() ?? '',
  };

  const errors = validateOperatorGradingContext(context);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, context, evidenceRef: buildEvidenceRef(context) };
}

/**
 * An evidence reference that identifies *this* attestation.
 *
 * The previous value was the constant `'operator-manual'`, written on every
 * settlement and on every correction of one. A correction therefore carried a
 * `corrects_id` pointing at the prior record and evidence indistinguishable
 * from it, so the audit trail could say that a settlement had been corrected
 * but never what the correction was based on — which is the one question a
 * correction exists to answer.
 *
 * The source URL and the observation instant together are what a later reader
 * would need to re-check the call, so they are what the reference carries.
 */
export function buildEvidenceRef(context: OperatorGradingContext): string {
  return `operator-manual:${context.observedAt}:${context.resultSourceUrl}`;
}
