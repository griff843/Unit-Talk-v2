/**
 * One CLV rendering for every operator surface.
 *
 * CLV is null on every settled pick in production today, because closing-line
 * capture depends on a live provider that is deliberately off. That is a known,
 * deferred state — not a defect and not a zero. Rendering it as a bare dash makes
 * "no closing line was ever captured" indistinguishable from "this column does not
 * apply here", so every branch below names *why* there is no number.
 *
 * Extracted from `app/picks/[id]/page.tsx` so the settlement ops surface renders
 * the same verdict rather than a second, quietly divergent one.
 */
export interface ClvSummaryInput {
  clvPercent?: number | null;
  beatsClosingLine?: boolean | null;
  isOpeningLineFallback?: boolean | null;
  clvUnavailableReason?: string | null;
  clvStatus?: string | null;
  hasClv?: boolean;
}

export function renderClvSummary(settlement: ClvSummaryInput | undefined | null): string {
  if (!settlement) {
    return 'missing';
  }

  if (settlement.clvPercent != null) {
    const lineVerdict =
      settlement.beatsClosingLine == null
        ? 'CLV present'
        : settlement.beatsClosingLine
          ? 'beats line'
          : 'behind line';
    const fallbackSuffix = settlement.isOpeningLineFallback ? ' via opening fallback' : '';
    return `${settlement.clvPercent.toFixed(2)}% (${lineVerdict}${fallbackSuffix})`;
  }

  if (settlement.clvUnavailableReason) {
    return `missing (${settlement.clvUnavailableReason})`;
  }

  if (settlement.clvStatus) {
    return settlement.clvStatus;
  }

  return settlement.hasClv ? 'present' : 'missing';
}

/** True when the summary describes an absence rather than a measured number. */
export function isClvUnresolved(settlement: ClvSummaryInput | undefined | null): boolean {
  return settlement?.clvPercent == null;
}
