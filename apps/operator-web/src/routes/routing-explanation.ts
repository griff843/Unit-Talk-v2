export interface RoutingExplanation {
  verdict: 'promoted' | 'suppressed' | 'held' | 'pending' | 'none';
  target: string | null;
  score: number | null;
  scoreInputs: {
    edge: number | null;
    trust: number | null;
    readiness: number | null;
    uniqueness: number | null;
    boardFit: number | null;
  } | null;
  edgeSource: string | null;
  edgeSourceLabel: string;
  reliabilityTone: 'high' | 'medium' | 'low';
  suppressionReasons: string[];
  gateFailures: string[];
  reason: string | null;
  decidedAt: string | null;
}

function toEdgeSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case 'pinnacle':
    case 'real-edge':
      return 'Market-backed edge';
    case 'consensus':
    case 'consensus-edge':
      return 'Consensus edge';
    case 'sgo':
    case 'sgo-edge':
      return 'Single-book edge';
    case 'explicit':
      return 'Explicit component';
    case 'confidence-delta':
      return 'Confidence fallback';
    default:
      return source ? `Unknown (${source})` : 'Unknown edge source';
  }
}

function toReliabilityTone(source: string | null | undefined): 'high' | 'medium' | 'low' {
  switch (source) {
    case 'pinnacle':
    case 'real-edge':
    case 'consensus':
    case 'consensus-edge':
      return 'high';
    case 'sgo':
    case 'sgo-edge':
    case 'explicit':
      return 'medium';
    default:
      return 'low';
  }
}

function readObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function readNum(obj: Record<string, unknown> | null, key: string): number | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === 'number' ? v : null;
}

function readStr(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function extractEdgeSource(
  historyMeta: Record<string, unknown> | null,
  pickMeta: Record<string, unknown> | null,
): string | null {
  const scoreInputs = readObject(historyMeta?.['scoreInputs']);
  const fromHistory = readStr(scoreInputs, 'edgeSource');
  if (fromHistory) return fromHistory;

  const domainAnalysis = readObject(pickMeta?.['domainAnalysis']);
  const fromDomain =
    readStr(domainAnalysis, 'realEdgeSource') ??
    readStr(pickMeta, 'realEdgeSource') ??
    readStr(pickMeta, 'edgeSource');
  if (fromDomain) return fromDomain;

  const promotionScores = readObject(pickMeta?.['promotionScores']);
  if (promotionScores && typeof promotionScores['edge'] === 'number') return 'explicit';

  return null;
}

function extractGateFailures(historyMeta: Record<string, unknown> | null): string[] {
  const gateInputs = readObject(historyMeta?.['gateInputs']);
  if (!gateInputs) return [];
  const failures: string[] = [];
  if (gateInputs['isStale'] === true) failures.push('stale');
  if (gateInputs['riskBlocked'] === true) failures.push('risk_blocked');
  if (gateInputs['withinPostingWindow'] === false) failures.push('posting_window_closed');
  if (gateInputs['marketStillValid'] === false) failures.push('market_invalid');
  if (gateInputs['hasRequiredFields'] === false) failures.push('missing_required_fields');
  return failures;
}

function extractScoreInputsFromPickMeta(
  meta: Record<string, unknown> | null,
): RoutingExplanation['scoreInputs'] {
  const ps = readObject(meta?.['promotionScores']);
  if (!ps) return null;
  return {
    edge: readNum(ps, 'edge'),
    trust: readNum(ps, 'trust'),
    readiness: readNum(ps, 'readiness'),
    uniqueness: readNum(ps, 'uniqueness'),
    boardFit: readNum(ps, 'boardFit'),
  };
}

function mapVerdict(status: string | null): RoutingExplanation['verdict'] {
  switch (status) {
    case 'qualified': return 'promoted';
    case 'suppressed': return 'suppressed';
    case 'held': return 'held';
    case 'pending': return 'pending';
    default: return 'none';
  }
}

/**
 * Builds a routing explanation from the full promotion history rows (DB records with metadata)
 * and the pick's own metadata. Used by the pick-detail route.
 */
export function buildRoutingExplanation(
  promotionStatus: string | null,
  promotionHistoryRows: Array<Record<string, unknown>>,
  pickMeta: Record<string, unknown>,
): RoutingExplanation {
  const lastRow = promotionHistoryRows.length > 0
    ? promotionHistoryRows[promotionHistoryRows.length - 1]!
    : null;

  const historyMeta = readObject(lastRow?.['metadata'] ?? null);
  const scoreInputsObj = readObject(historyMeta?.['scoreInputs']);

  const edgeSource = extractEdgeSource(historyMeta, pickMeta);

  const scoreInputs = scoreInputsObj
    ? {
        edge: readNum(scoreInputsObj, 'edge'),
        trust: readNum(scoreInputsObj, 'trust'),
        readiness: readNum(scoreInputsObj, 'readiness'),
        uniqueness: readNum(scoreInputsObj, 'uniqueness'),
        boardFit: readNum(scoreInputsObj, 'boardFit'),
      }
    : extractScoreInputsFromPickMeta(pickMeta);

  const reason = typeof lastRow?.['reason'] === 'string' ? lastRow['reason'] : null;
  const suppressionReasons = reason
    ? reason.split(' | ').map((r) => r.trim()).filter(Boolean)
    : [];

  const effectiveStatus = (lastRow?.['status'] as string | null) ?? promotionStatus;

  return {
    verdict: mapVerdict(effectiveStatus),
    target: (lastRow?.['promotion_target'] as string | null) ?? null,
    score: (lastRow?.['score'] as number | null) ?? null,
    scoreInputs,
    edgeSource,
    edgeSourceLabel: toEdgeSourceLabel(edgeSource),
    reliabilityTone: toReliabilityTone(edgeSource),
    suppressionReasons,
    gateFailures: extractGateFailures(historyMeta),
    reason,
    decidedAt: (lastRow?.['decided_at'] as string | null) ?? null,
  };
}

/**
 * Builds a compact routing explanation from a picks_current_state row only.
 * Used by list views (review-queue, held-queue) where promotion history is not fetched.
 */
export function buildRoutingExplanationFromPick(
  pick: Record<string, unknown>,
): RoutingExplanation {
  const meta = readObject(pick['metadata']) ?? {};
  const promotionStatus = typeof pick['promotion_status'] === 'string'
    ? pick['promotion_status']
    : null;
  const edgeSource = extractEdgeSource(null, meta);

  return {
    verdict: mapVerdict(promotionStatus),
    target: (pick['promotion_target'] as string | null) ?? null,
    score: (pick['promotion_score'] as number | null) ?? null,
    scoreInputs: extractScoreInputsFromPickMeta(meta),
    edgeSource,
    edgeSourceLabel: toEdgeSourceLabel(edgeSource),
    reliabilityTone: toReliabilityTone(edgeSource),
    suppressionReasons: [],
    gateFailures: [],
    reason: null,
    decidedAt: null,
  };
}
