/**
 * One recap verdict for every operator surface.
 *
 * A settled human-capper pick has two outcomes, not one: the settlement record
 * was written, and members either were or were not told. `apps/api`'s
 * `settle-pick-controller.ts` computes the second deliberately —
 *
 * > the immediate per-pick recap is part of the human delivery transaction, so
 * > its outcome is reported rather than fire-and-forget — an operator who
 * > settles a delivered pick needs to know whether members were told.
 *
 * — and returns it as `humanCapperRecap`. Before UTV2-1939 this surface read
 * only `settlementRecordId` and rendered an unqualified "Settlement recorded."
 * Canary pick `816a84c7` settled 2026-09-18T06:31:21Z with its recap silently
 * suppressed, and the operator saw that same green panel.
 *
 * The recap does NOT go through the outbox — it posts by direct fetch — so the
 * worker's kill-switch check never sees it and the controller checks the switch
 * itself. A suppressed recap is therefore the *normal* outcome while
 * member-delivery activation remains reserved, which is exactly why it has to be
 * rendered as a distinct, non-green state rather than folded into success.
 */

/** The `humanCapperRecap` field as `settle-pick-controller.ts` returns it. */
export interface HumanCapperRecapResult {
  posted: boolean;
  reason?: string;
}

export type RecapVerdict =
  | { kind: 'not-applicable' }
  | { kind: 'posted'; headline: string }
  | { kind: 'suppressed'; headline: string; detail: string; reason: string };

/**
 * Known refusal reasons, explained in operator terms. An unknown reason is
 * passed through verbatim rather than flattened into a generic message — a
 * reason this map has not seen yet is still the most specific fact available.
 */
const REASON_DETAIL: Record<string, string> = {
  'kill-switch-engaged':
    'The official-picks kill switch is engaged, so no recap was posted and members were not told this pick settled. Releasing that switch is a reserved member-delivery decision.',
  'no-sent-delivery':
    'This pick has no confirmed delivery, so there is no audience to recap to. A pick that never reached members correctly gets no recap.',
};

export function describeRecapOutcome(
  recap: HumanCapperRecapResult | undefined | null,
): RecapVerdict {
  // Absent means the API did not treat this pick as a human-capper delivery at
  // all — a Track Only pick, or one carrying no server authorization. That is
  // not a suppressed recap and must not be reported as one.
  if (recap === undefined || recap === null) {
    return { kind: 'not-applicable' };
  }

  if (recap.posted) {
    return { kind: 'posted', headline: 'Recap posted — members were told.' };
  }

  const reason = recap.reason?.trim() ? recap.reason.trim() : 'unspecified';
  return {
    kind: 'suppressed',
    headline: 'Recap NOT posted — members were not told.',
    detail: REASON_DETAIL[reason] ?? `The API refused the recap with: ${reason}`,
    reason,
  };
}

/**
 * Pre-settle prediction, mirroring the three conditions
 * `settle-pick-controller.ts` requires before it will post a recap. Stated
 * before the operator commits, so a suppressed recap is a known consequence
 * rather than a discovery.
 */
export interface RecapPredictionInput {
  isHumanCapperDelivery: boolean;
  officialPicksKilled: boolean | null;
  hasSentDelivery: boolean;
}

export type RecapPrediction =
  | { willPost: false; kind: 'not-applicable'; summary: string }
  | { willPost: false; kind: 'blocked'; summary: string }
  | { willPost: false; kind: 'unknown'; summary: string }
  | { willPost: true; kind: 'will-post'; summary: string };

export function predictRecapDelivery(input: RecapPredictionInput): RecapPrediction {
  if (!input.isHumanCapperDelivery) {
    return {
      willPost: false,
      kind: 'not-applicable',
      summary: 'No recap applies — this pick carries no human-capper delivery authorization.',
    };
  }

  if (!input.hasSentDelivery) {
    return {
      willPost: false,
      kind: 'blocked',
      summary: 'No recap will post — this pick has no confirmed delivery to recap to.',
    };
  }

  // Fail closed on an unreadable switch. Claiming a recap will post when the
  // switch state is unknown is the one error that reads as a promise.
  if (input.officialPicksKilled === null) {
    return {
      willPost: false,
      kind: 'unknown',
      summary: 'Recap outcome unknown — the official-picks kill switch state could not be read.',
    };
  }

  if (input.officialPicksKilled) {
    return {
      willPost: false,
      kind: 'blocked',
      summary:
        'No recap will post — the official-picks kill switch is engaged. Settlement will still be recorded.',
    };
  }

  return {
    willPost: true,
    kind: 'will-post',
    summary: 'A recap will post to members when this pick is settled.',
  };
}
