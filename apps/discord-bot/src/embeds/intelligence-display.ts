export interface BettorField {
  name: string;
  value: string;
  inline?: boolean;
}
/** Technical confidence and unproven metadata summaries never become public claims. */
export function buildBettorIntelligenceFields(_input: {
  confidence?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
}): BettorField[] {
  return [];
}
