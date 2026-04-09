/**
 * Ranked Candidate Selection Service — Phase 4 UTV2-473
 *
 * Reads pick_candidates rows with status='qualified' and model_score IS NOT NULL,
 * filters stale market universe rows, sorts by score+tier+created_at,
 * assigns contiguous selection_rank (1=best) and sets is_board_candidate=true.
 *
 * Hard boundaries (never violate):
 * - Never sets pick_id
 * - Never sets shadow_mode=false
 * - Never writes to picks table
 * - No scarcity/board-cap logic (that is P4-02)
 * - No governance queue logic
 */

import type { IPickCandidateRepository, SelectionRankUpdate } from '@unit-talk/db';
import type { IMarketUniverseRepository } from '@unit-talk/db';

export interface RankedSelectionResult {
  ranked: number;
  reset: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

export interface RankedSelectionOptions {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

// Tier priority for ranking — higher = ranked earlier.
// SUPPRESS is intentionally last (priority 1), not excluded.
const TIER_PRIORITY: Record<string, number> = {
  'A+': 5,
  'A':  4,
  'B':  3,
  'C':  2,
  'SUPPRESS': 1,
};

function tierPriority(tier: string | null | undefined): number {
  return tier ? (TIER_PRIORITY[tier] ?? 0) : 0;
}

export class RankedCandidateSelectionService {
  constructor(
    private readonly repos: {
      pickCandidates: IPickCandidateRepository;
      marketUniverse: IMarketUniverseRepository;
    },
  ) {}

  async run(options: RankedSelectionOptions = {}): Promise<RankedSelectionResult> {
    const startMs = Date.now();
    const logger = options.logger;

    // Step 1: Reset all stale rank state
    let resetCount = 0;
    try {
      // Count rows before reset for reporting
      const allCandidates = await this.repos.pickCandidates.findByStatus('qualified');
      resetCount = allCandidates.length;
      await this.repos.pickCandidates.resetSelectionRanks();
    } catch (err) {
      logger?.error?.(JSON.stringify({
        service: 'ranked-selection',
        event: 'reset_failed',
        error: err instanceof Error ? err.message : String(err),
      }));
      return { ranked: 0, reset: 0, skipped: 0, errors: 1, durationMs: Date.now() - startMs };
    }

    // Step 2: Load qualified + scored candidates
    let candidates;
    try {
      const all = await this.repos.pickCandidates.findByStatus('qualified');
      candidates = all.filter(c => c.model_score !== null);
    } catch (err) {
      logger?.error?.(JSON.stringify({
        service: 'ranked-selection',
        event: 'load_failed',
        error: err instanceof Error ? err.message : String(err),
      }));
      return { ranked: 0, reset: resetCount, skipped: 0, errors: 1, durationMs: Date.now() - startMs };
    }

    if (candidates.length === 0) {
      logger?.info?.(JSON.stringify({ service: 'ranked-selection', event: 'no_eligible_candidates' }));
      return { ranked: 0, reset: resetCount, skipped: 0, errors: 0, durationMs: Date.now() - startMs };
    }

    // Step 3: Bulk-load market universe rows to filter stale markets
    const universeIds = [...new Set(candidates.map(c => c.universe_id))];
    let universeRows;
    try {
      universeRows = await this.repos.marketUniverse.findByIds(universeIds);
    } catch (err) {
      logger?.error?.(JSON.stringify({
        service: 'ranked-selection',
        event: 'universe_load_failed',
        error: err instanceof Error ? err.message : String(err),
      }));
      return { ranked: 0, reset: resetCount, skipped: candidates.length, errors: 1, durationMs: Date.now() - startMs };
    }

    const universeMap = new Map(universeRows.map(r => [r.id, r]));

    // Step 4: Filter stale markets
    const eligible = candidates.filter(c => {
      const universe = universeMap.get(c.universe_id);
      return universe !== undefined && universe.is_stale === false;
    });
    const skipped = candidates.length - eligible.length;

    if (eligible.length === 0) {
      logger?.info?.(JSON.stringify({ service: 'ranked-selection', event: 'all_candidates_stale', skipped }));
      return { ranked: 0, reset: resetCount, skipped, errors: 0, durationMs: Date.now() - startMs };
    }

    // Step 5: Sort deterministically
    // Primary:   model_score DESC
    // Secondary: tier_priority DESC (A+ > A > B > C > SUPPRESS > null)
    // Tertiary:  created_at ASC (stable insertion-order tiebreaker)
    const sorted = [...eligible].sort((a, b) => {
      const scoreDiff = (b.model_score ?? 0) - (a.model_score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;

      const tierDiff = tierPriority(b.model_tier) - tierPriority(a.model_tier);
      if (tierDiff !== 0) return tierDiff;

      return a.created_at.localeCompare(b.created_at);
    });

    // Step 6: Assign contiguous selection_rank starting at 1
    const updates: SelectionRankUpdate[] = sorted.map((c, idx) => ({
      id: c.id,
      selection_rank: idx + 1,
      is_board_candidate: true,
    }));

    // Step 7: Flush
    let errors = 0;
    try {
      await this.repos.pickCandidates.updateSelectionRankBatch(updates);
    } catch (err) {
      errors++;
      logger?.error?.(JSON.stringify({
        service: 'ranked-selection',
        event: 'flush_failed',
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    const ranked = errors === 0 ? updates.length : 0;

    logger?.info?.(JSON.stringify({
      service: 'ranked-selection',
      event: 'run.completed',
      ranked,
      reset: resetCount,
      skipped,
      errors,
      durationMs: Date.now() - startMs,
    }));

    return { ranked, reset: resetCount, skipped, errors, durationMs: Date.now() - startMs };
  }
}

export async function runRankedSelection(
  repos: { pickCandidates: IPickCandidateRepository; marketUniverse: IMarketUniverseRepository },
  options: RankedSelectionOptions = {},
): Promise<RankedSelectionResult> {
  return new RankedCandidateSelectionService(repos).run(options);
}
