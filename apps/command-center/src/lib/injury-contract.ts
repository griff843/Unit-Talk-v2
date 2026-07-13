/**
 * Injury Monitor data contract — TYPES ONLY.
 *
 * TODO(data-contract): No injury data source is connected to Unit Talk V2.
 * There is no injuries table in Supabase and no provider feed for injury
 * reports. Do not scrape ad hoc. Before /intel/injuries can populate, we need:
 *   1. A licensed/approved injury data provider decision (PM-gated),
 *   2. An `injury_reports` table with the fields below,
 *   3. An ingestion path in apps/ingestor and a data module in src/lib/data/.
 * Until then the page renders an EmptyState shell with a column-complete table.
 */

export type InjuryStatus =
  | 'out'
  | 'doubtful'
  | 'questionable'
  | 'probable'
  | 'day-to-day'
  | 'active'
  | 'unknown';

export type InjurySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface InjuryReport {
  id: string;
  /** participants.id-style identifier, e.g. 'AUSTIN_MARTIN_1_MLB' */
  playerParticipantId: string;
  playerDisplayName: string;
  /** team participant id or display name */
  team: string;
  status: InjuryStatus;
  /** Named, attributable source of the report (provider or official feed) */
  source: string;
  /** ISO timestamp the report was published by the source */
  reportedAt: string;
  /** provider_market_key values whose pricing this report affects */
  affectedMarketKeys: string[];
  severity: InjurySeverity;
  notes: string | null;
}
