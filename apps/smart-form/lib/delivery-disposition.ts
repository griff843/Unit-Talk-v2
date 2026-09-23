/**
 * What the receipt is allowed to say about member delivery -- UTV2-1925.
 *
 * Before this module the receipt rendered "Track Only -- no member delivery"
 * from `submittedValues.trackOnly`, a CLIENT form value that defaults to `true`
 * (`form-schema.ts`). Nothing about that value is a fact about the server. A
 * server-authorized capper whose submission enters the approval-for-delivery
 * path was still shown "no member delivery", and a reader had no way to tell
 * the claim apart from a real one.
 *
 * The rule here is narrow and deliberate: **the receipt reports what the server
 * said happened, and nothing else.** It does not infer, it does not restate the
 * request back as an outcome, and where the server did not determine something
 * it says so rather than choosing the reassuring reading.
 *
 * The distinction that matters, and the reason this is not a wording change:
 *
 *   "no delivery was created"  is an OBSERVATION about this submission.
 *   "no member delivery"       is a CLAIM about a permanent containment property.
 *
 * Today's submission response carries `outboxEnqueued`, `lifecycleState`,
 * `promotionStatus` and `promotionTarget`. It does NOT carry the pick's
 * `distributionMode`, so the client genuinely cannot distinguish "Track Only,
 * structurally undeliverable" from "deliverable, but nothing was enqueued this
 * time". Only the first justifies the stronger sentence, so the receipt makes
 * the weaker, true statement and this module refuses to manufacture the other.
 */

/** Exactly what the server determined, with no client inference folded in. */
export type DeliveryDisposition =
  | { kind: 'queued'; target: string | null; headline: string; detail: string }
  | { kind: 'awaiting-approval'; headline: string; detail: string }
  | { kind: 'not-enqueued'; headline: string; detail: string }
  | { kind: 'undetermined'; headline: string; detail: string };

/**
 * The subset of the submission response this decision reads. Every field is
 * optional because an older API build may not send it, and "the server did not
 * say" must stay distinguishable from "the server said no".
 */
export interface DeliveryDispositionInput {
  outboxEnqueued?: unknown;
  lifecycleState?: unknown;
  promotionStatus?: unknown;
  promotionTarget?: unknown;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Map a submission response onto what the receipt may state.
 *
 * Order is load-bearing. `outboxEnqueued === true` is checked first because it
 * is the one unambiguous, positive delivery fact the server reports: a row was
 * created. `awaiting_approval` comes next because it is the state the
 * approval-for-delivery path actually lands in, and it is precisely the case
 * the old receipt misdescribed.
 */
export function resolveDeliveryDisposition(
  result: DeliveryDispositionInput | null | undefined,
): DeliveryDisposition {
  if (!result || typeof result !== 'object') {
    return {
      kind: 'undetermined',
      headline: 'Pick saved',
      detail: 'The server did not report a delivery outcome for this submission.',
    };
  }

  const enqueued = asBoolean(result.outboxEnqueued);
  const lifecycleState = asTrimmedString(result.lifecycleState);
  const target = asTrimmedString(result.promotionTarget);

  if (enqueued === true) {
    return {
      kind: 'queued',
      target,
      headline: 'Queued for delivery',
      detail: target
        ? `The server created a delivery record for ${target}.`
        : 'The server created a delivery record for this pick.',
    };
  }

  if (lifecycleState === 'awaiting_approval') {
    return {
      kind: 'awaiting-approval',
      headline: 'Awaiting operator approval',
      detail:
        'Saved and held for review. No delivery record was created, and none can be until an operator approves it.',
    };
  }

  if (enqueued === false) {
    return {
      kind: 'not-enqueued',
      headline: 'Saved, not delivered',
      detail: 'The server created no delivery record for this submission.',
    };
  }

  return {
    kind: 'undetermined',
    headline: 'Pick saved',
    detail: 'The server did not report a delivery outcome for this submission.',
  };
}
