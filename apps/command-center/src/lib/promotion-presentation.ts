import { isHumanCapperDeliveryAuthorized } from '@unit-talk/contracts';

/**
 * UTV2-1902: what the pick detail page may truthfully say about the board
 * (model) promotion lane.
 *
 * Three facts must never blur together on screen:
 *   1. whether a board target exists at all -- `promotion_target` is the board
 *      lane's record of a scoring decision, and a human capper delivery pick
 *      reaches `official-picks` through its authorization record, not through it;
 *   2. whether the persisted status was earned by score or imposed by an
 *      override -- a `force_promote` history row is not score qualification;
 *   3. what the edge actually is -- `hasRealEdge: false` is an explicit
 *      statement, and a numeric `realEdge` beside it does not overrule it.
 */

export interface PromotionPresentationInput {
  promotionStatus: string;
  promotionTarget: string | null;
  promotionScore: number | null;
  promotionReason: string | null;
  metadata: Record<string, unknown>;
  /** Newest first, as the detail loader orders it. */
  promotionHistory: ReadonlyArray<{ target?: string | null; overrideAction: string | null }>;
}

export interface PromotionPresentation {
  /** Headline for the Promotion tile: a board target, or an explicit absence. */
  boardLabel: string;
  /** How the persisted status came about. */
  qualificationBasis: 'score' | 'override' | 'none';
  qualificationNote: string;
  band: string | null;
  reason: string | null;
  humanCapperDelivery: boolean;
  /** Board overrides are not offered for a human capper delivery pick. */
  boardOverrideAvailable: boolean;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readRealEdgePresence(metadata: Record<string, unknown>): 'present' | 'absent' | 'missing' {
  const domainAnalysis = readObject(metadata['domainAnalysis']);
  const explicit = typeof metadata['hasRealEdge'] === 'boolean'
    ? metadata['hasRealEdge']
    : typeof domainAnalysis?.['hasRealEdge'] === 'boolean'
      ? domainAnalysis['hasRealEdge']
      : null;
  if (explicit === false) return 'absent';
  if (explicit === true) return 'present';
  return typeof domainAnalysis?.['realEdge'] === 'number' || typeof metadata['realEdge'] === 'number'
    ? 'present'
    : 'missing';
}

export function buildPromotionPresentation(input: PromotionPresentationInput): PromotionPresentation {
  const humanCapperDelivery = isHumanCapperDeliveryAuthorized(input.metadata);
  // The row that set the persisted target, not merely the newest row: one
  // evaluation writes a row per policy with the same decided_at, so ordering
  // alone cannot say which row is the winner's. Matching the target can.
  const decisive = input.promotionTarget
    ? input.promotionHistory.find((row) => row.target === input.promotionTarget) ?? input.promotionHistory[0]
    : input.promotionHistory[0];
  const overridden = decisive?.overrideAction === 'force_promote';
  const scoreText = input.promotionScore != null ? input.promotionScore.toFixed(1) : 'none';

  const boardLabel = input.promotionTarget
    ? input.promotionTarget
    : humanCapperDelivery
      ? 'No board target (human capper delivery)'
      : `No board target (${input.promotionStatus || 'not evaluated'})`;

  let qualificationBasis: PromotionPresentation['qualificationBasis'];
  let qualificationNote: string;
  if (overridden) {
    qualificationBasis = 'override';
    qualificationNote = `Status set by a force_promote override, not by score. Score ${scoreText} was not re-qualified.`;
  } else if (input.promotionStatus === 'qualified' && input.promotionTarget) {
    qualificationBasis = 'score';
    qualificationNote = `Qualified for ${input.promotionTarget} by score ${scoreText}.`;
  } else if (humanCapperDelivery) {
    // UTV2-1902: scored for information only; a score never authorizes a
    // board target for a pick delivered through its human capper authorization.
    qualificationBasis = 'none';
    qualificationNote = `Scored ${scoreText} for information only. Board promotion does not apply to a human capper delivery pick.`;
  } else {
    qualificationBasis = 'none';
    qualificationNote = `Not qualified for any board lane. Score ${scoreText}.`;
  }

  return {
    boardLabel,
    qualificationBasis,
    qualificationNote,
    band: readString(input.metadata['band']),
    reason: readString(input.promotionReason),
    humanCapperDelivery,
    boardOverrideAvailable: !humanCapperDelivery,
  };
}
