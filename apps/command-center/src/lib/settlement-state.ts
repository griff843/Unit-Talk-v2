/**
 * Whether a pick already carries settlement truth.
 *
 * Two operator surfaces ask this question — `/settlement` and `/picks/[id]` —
 * and they had drifted. `/settlement` derived it; `/picks/[id]` passed a
 * literal `false`. The predicate lives here so they cannot disagree again.
 *
 * **Lifecycle status alone is not sufficient, and that is the whole point.**
 * A Track Only pick is never `posted` — non-delivery is enforced at eight
 * independent chokepoints — and `settlement-service` requires `posted` before
 * it will advance a pick to `settled`. So a Track Only pick stays `validated`
 * permanently while carrying a real, correct settlement record. Reading only
 * `status` reports every settled internal pick as unsettled, which is the
 * normal internal case rather than an edge case.
 *
 * The settlement plane is the authority. This predicate reads it.
 */
export function isPickAlreadySettled(pickStatus: string | null | undefined, settlementCount: number): boolean {
  if (pickStatus === 'settled') return true;
  // A count that is not a real non-negative number is not evidence of
  // anything. Fail closed to "not settled" rather than inventing a settlement
  // — the caller's remedy for an unreadable count is to show no claim, not a
  // confident wrong one.
  if (!Number.isFinite(settlementCount)) return false;
  return settlementCount > 0;
}
