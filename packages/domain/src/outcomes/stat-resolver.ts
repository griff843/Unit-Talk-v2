/**
 * Stat Resolver — market_type → box score stat columns
 *
 * Reverse mapping from canonical market_key to the stat columns
 * needed to compute actual_value from player_game_stats.
 */

// Primary mapping: market_key → stat column(s) in player_game_stats.stats JSONB
// For combo props, actual_value = sum of all columns
const MARKET_KEY_TO_STAT_COLUMNS: Record<string, string[]> = {
  player_points_ou: ['points'],
  player_rebounds_ou: ['rebounds'],
  player_assists_ou: ['assists'],
  player_3pm_ou: ['threes'],
  player_steals_ou: ['steals'],
  player_blocks_ou: ['blocks'],
  player_turnovers_ou: ['turnovers'],
  player_pra_ou: ['points', 'rebounds', 'assists'],
  player_pts_rebs_ou: ['points', 'rebounds'],
  player_pts_asts_ou: ['points', 'assists'],
  player_rebs_asts_ou: ['rebounds', 'assists'],
  player_blocks_steals_ou: ['blocks', 'steals'],
  player_fantasy_score_ou: ['fantasy_score'],
};

// Fallback names for combo props when individual stats are unavailable
const COMBO_FALLBACK: Record<string, string[]> = {
  player_pra_ou: ['pra', 'points+rebounds+assists', 'pts+rebs+asts'],
  player_pts_rebs_ou: ['points+rebounds', 'pts+rebs'],
  player_pts_asts_ou: ['points+assists', 'pts+asts'],
  player_rebs_asts_ou: ['rebounds+assists', 'rebs+asts'],
  player_blocks_steals_ou: ['blocks+steals'],
};

export interface StatResolution {
  resolved: boolean;
  actual_value: number | null;
  stat_columns: string[];
  missing_columns: string[];
}

/**
 * Resolve actual_value from player box score stats for a given market_key.
 * For combo props (PRA, pts+rebs, etc.), sums the component stats.
 * Falls back to direct combo stat names if individual stats are missing.
 */
export function resolveActualValue(
  marketKey: string,
  stats: Record<string, number>,
): StatResolution {
  const columns = MARKET_KEY_TO_STAT_COLUMNS[marketKey];
  if (!columns) {
    return { resolved: false, actual_value: null, stat_columns: [], missing_columns: [] };
  }

  // Try primary: sum of individual stat columns
  const missing = columns.filter((col) => stats[col] == null);
  if (missing.length === 0) {
    const actual_value = columns.reduce((sum, col) => sum + (stats[col] ?? 0), 0);
    return { resolved: true, actual_value, stat_columns: columns, missing_columns: [] };
  }

  // Try fallback for combo props (direct combo stat names)
  const fallbacks = COMBO_FALLBACK[marketKey];
  if (fallbacks) {
    for (const col of fallbacks) {
      if (stats[col] != null) {
        return {
          resolved: true,
          actual_value: stats[col]!,
          stat_columns: [col],
          missing_columns: [],
        };
      }
    }
  }

  return { resolved: false, actual_value: null, stat_columns: columns, missing_columns: missing };
}

/**
 * Check if a market_key has a known stat mapping.
 */
export function hasStatMapping(marketKey: string): boolean {
  return marketKey in MARKET_KEY_TO_STAT_COLUMNS;
}

/**
 * Get all supported market keys (for diagnostics).
 */
export function getSupportedMarketKeys(): string[] {
  return Object.keys(MARKET_KEY_TO_STAT_COLUMNS);
}
