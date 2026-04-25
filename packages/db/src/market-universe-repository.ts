/**
 * IMarketUniverseRepository — interface and input types for market_universe table.
 *
 * Phase 2 — UTV2-461: Market Universe Materializer
 * Contract authority: docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md
 *
 * Upsert conflict target (natural key):
 *   (provider_key, provider_event_id, COALESCE(provider_participant_id,''), provider_market_key)
 *
 * Opening/closing immutability rule:
 *   Once opening_* or closing_* fields are set on a row, they MUST NOT be
 *   overwritten on subsequent upserts. Enforced via explicit UPDATE SET guard
 *   in the Database implementation (CASE WHEN existing IS NULL THEN new ELSE existing).
 */

// TODO: regenerate via pnpm supabase:types once Supabase connectivity restores
// Stubbed from migration 202604090001_utv2_459_market_universe.sql (27 columns)
export interface MarketUniverseRow {
  id: string;                              // uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY
  sport_key: string;                       // text NOT NULL
  league_key: string;                      // text NOT NULL
  event_id: string | null;                 // uuid NULL REFERENCES events(id)
  participant_id: string | null;           // uuid NULL REFERENCES participants(id)
  market_type_id: string | null;           // text NULL
  canonical_market_key: string;            // text NOT NULL
  provider_key: string;                    // text NOT NULL
  provider_event_id: string;              // text NOT NULL
  provider_participant_id: string | null;  // text NULL
  provider_market_key: string;             // text NOT NULL
  current_line: number | null;             // numeric NULL
  current_over_odds: number | null;        // numeric NULL
  current_under_odds: number | null;       // numeric NULL
  opening_line: number | null;             // numeric NULL
  opening_over_odds: number | null;        // numeric NULL
  opening_under_odds: number | null;       // numeric NULL
  closing_line: number | null;             // numeric NULL
  closing_over_odds: number | null;        // numeric NULL
  closing_under_odds: number | null;       // numeric NULL
  fair_over_prob: number | null;           // numeric NULL
  fair_under_prob: number | null;          // numeric NULL
  is_stale: boolean;                       // boolean NOT NULL DEFAULT false
  last_offer_snapshot_at: string;          // timestamptz NOT NULL
  refreshed_at: string;                    // timestamptz NOT NULL DEFAULT now()
  created_at: string;                      // timestamptz NOT NULL DEFAULT now()
  updated_at: string;                      // timestamptz NOT NULL DEFAULT now()
}

/**
 * Input type for upsertMarketUniverse.
 *
 * Fields that implement the opening/closing immutability rule:
 * - opening_line / opening_over_odds / opening_under_odds
 * - closing_line / closing_over_odds / closing_under_odds
 *
 * The Database implementation must NOT overwrite these if already set.
 * Pass the candidate values here; the implementation decides whether to apply them.
 */
export interface MarketUniverseUpsertInput {
  // Natural key fields
  provider_key: string;
  provider_event_id: string;
  provider_participant_id: string | null;
  provider_market_key: string;

  // Descriptive fields
  sport_key: string;
  league_key: string;
  event_id: string | null;
  participant_id: string | null;
  market_type_id: string | null;
  canonical_market_key: string;

  // Current line (always updated to the most recent snapshot)
  current_line: number | null;
  current_over_odds: number | null;
  current_under_odds: number | null;

  // Opening values (set once from is_opening=true snapshot — immutable once set)
  opening_line: number | null;
  opening_over_odds: number | null;
  opening_under_odds: number | null;

  // Closing values (set once from is_closing=true snapshot — immutable once set)
  closing_line: number | null;
  closing_over_odds: number | null;
  closing_under_odds: number | null;

  // Computed fair probability (null on failure — not a hard error)
  fair_over_prob: number | null;
  fair_under_prob: number | null;

  // Staleness (computed at materializer run time)
  is_stale: boolean;

  // Snapshot time of the most recent provider_offers row for this natural key
  last_offer_snapshot_at: string;
}

/** Minimal closing-line shape returned by findClosingLineByProviderKey. */
export interface MarketUniverseClosingLine {
  closing_line: number | null;
  closing_over_odds: number | null;
  closing_under_odds: number | null;
  provider_key: string;
  last_offer_snapshot_at: string;
}

export interface IMarketUniverseRepository {
  /**
   * Upsert a batch of market_universe rows using the natural key conflict target:
   *   (provider_key, provider_event_id, COALESCE(provider_participant_id,''), provider_market_key)
   *
   * Idempotent: running twice with the same inputs MUST NOT increase row count.
   *
   * Opening/closing immutability rule: if a row already has opening_* or closing_*
   * values set, the implementation MUST NOT overwrite them.
   */
  upsertMarketUniverse(rows: MarketUniverseUpsertInput[]): Promise<void>;

  /**
   * Returns up to `limit` market_universe rows ordered by refreshed_at descending.
   * Used by the board scan (UTV2-463) to fetch rows to evaluate.
   *
   * Returns a full MarketUniverseRow shape. The InMemory implementation stores
   * MarketUniverseUpsertInput rows seeded via upsertMarketUniverse and supplemented
   * with id/timestamps by the test helper; the Database implementation queries the DB.
   */
  listForScan(limit: number): Promise<MarketUniverseRow[]>;

  /**
   * Returns market_universe rows for the given IDs.
   * Used by the candidate scoring service to load market data for batch scoring.
   */
  findByIds(ids: string[]): Promise<MarketUniverseRow[]>;

  /**
   * Looks up the persisted closing-line data from market_universe for a given
   * provider natural key triple (no alias resolution needed — caller supplies
   * the already-resolved provider_market_key).
   *
   * Used by CLV service as a fallback when provider_offers has no closing line:
   * market_universe stores the closing snapshot written by the materializer.
   *
   * Returns null when no row matches or closing_line is NULL.
   * InMemory returns null (no closing data in test mode; tests mock at a higher level).
   */
  findClosingLineByProviderKey(criteria: {
    providerEventId: string;
    providerMarketKey: string;
    providerParticipantId: string | null;
  }): Promise<MarketUniverseClosingLine | null>;

  /**
   * Look up a market_universe row by provenance key.
   */
  findByProvenance(criteria: {
    providerKey: string;
    providerEventId: string;
    providerMarketKey: string;
    providerParticipantId?: string | null;
  }): Promise<MarketUniverseRow | null>;
}
