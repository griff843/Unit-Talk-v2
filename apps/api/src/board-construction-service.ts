/**
 * Board Construction Service — Phase 4 UTV2-474
 *
 * Reads pick_candidates where is_board_candidate=true, model_tier != 'SUPPRESS',
 * ordered by selection_rank ASC. Applies scarcity rules and writes to syndicate_board.
 *
 * Hard boundaries (never violate):
 * - Never writes to picks table
 * - Never sets pick_id
 * - Never sets shadow_mode=false
 * - No governance/approval logic
 */

import { randomUUID } from 'node:crypto';
import type { IPickCandidateRepository } from '@unit-talk/db';
import type { IMarketUniverseRepository } from '@unit-talk/db';
import type { ISyndicateBoardRepository } from '@unit-talk/db';

export const BOARD_SIZE_CAP = 20;
export const SPORT_CAP = 6;
export const MARKET_DUP_CAP = 3;

export interface BoardConstructionResult {
  boardSize: number;
  boardRunId: string;
  skippedSuppress: number;
  skippedBoardCap: number;
  skippedSportCap: number;
  skippedMarketDup: number;
  errors: number;
  durationMs: number;
}

export interface BoardConstructionOptions {
  boardSizeCap?: number;
  sportCap?: number;
  marketDupCap?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export class BoardConstructionService {
  constructor(
    private readonly repos: {
      pickCandidates: IPickCandidateRepository;
      marketUniverse: IMarketUniverseRepository;
      syndicateBoard: ISyndicateBoardRepository;
    },
  ) {}

  async run(options: BoardConstructionOptions = {}): Promise<BoardConstructionResult> {
    const startMs = Date.now();
    const boardSizeCap = options.boardSizeCap ?? BOARD_SIZE_CAP;
    const sportCap = options.sportCap ?? SPORT_CAP;
    const marketDupCap = options.marketDupCap ?? MARKET_DUP_CAP;

    // Step 1: Load board candidates (is_board_candidate=true), ordered by selection_rank
    let candidates;
    let suppressCount = 0;
    try {
      const all = await this.repos.pickCandidates.findByStatus('qualified');
      // Count SUPPRESS separately before filtering
      suppressCount = all.filter(
        (c) => c.is_board_candidate === true && c.model_tier === 'SUPPRESS',
      ).length;
      // Filter: is_board_candidate=true, not SUPPRESS, has selection_rank
      candidates = all
        .filter(
          (c) =>
            c.is_board_candidate === true &&
            c.model_tier !== 'SUPPRESS' &&
            c.selection_rank !== null,
        )
        .sort((a, b) => (a.selection_rank ?? 0) - (b.selection_rank ?? 0));
    } catch (err) {
      options.logger?.error?.(
        JSON.stringify({
          service: 'board-construction',
          event: 'load_failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return {
        boardSize: 0,
        boardRunId: '',
        skippedSuppress: 0,
        skippedBoardCap: 0,
        skippedSportCap: 0,
        skippedMarketDup: 0,
        errors: 1,
        durationMs: Date.now() - startMs,
      };
    }

    // Step 2: Load universe rows for sport_key and market_type_id
    const universeIds = [...new Set(candidates.map((c) => c.universe_id))];
    let universeRows;
    try {
      universeRows = await this.repos.marketUniverse.findByIds(universeIds);
    } catch (err) {
      options.logger?.error?.(
        JSON.stringify({
          service: 'board-construction',
          event: 'universe_load_failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return {
        boardSize: 0,
        boardRunId: '',
        skippedSuppress: suppressCount,
        skippedBoardCap: 0,
        skippedSportCap: 0,
        skippedMarketDup: 0,
        errors: 1,
        durationMs: Date.now() - startMs,
      };
    }

    const universeMap = new Map(universeRows.map((r) => [r.id, r]));

    // Step 3: Greedy walk — apply scarcity rules
    const sportCounts = new Map<string, number>();
    const marketTypeCounts = new Map<string, number>();
    const boardRows: Array<{
      candidate_id: string;
      board_rank: number;
      board_tier: string;
      sport_key: string;
      market_type_id: string | null;
      model_score: number;
      board_run_id: string;
    }> = [];

    let skippedBoardCap = 0;
    let skippedSportCap = 0;
    let skippedMarketDup = 0;
    const boardRunId = randomUUID();

    for (const candidate of candidates) {
      // Board cap
      if (boardRows.length >= boardSizeCap) {
        skippedBoardCap++;
        continue;
      }

      const universe = universeMap.get(candidate.universe_id);
      if (!universe) continue;

      const sportKey = universe.sport_key ?? 'unknown';
      const marketTypeId = universe.market_type_id ?? null;

      // Sport cap
      const currentSportCount = sportCounts.get(sportKey) ?? 0;
      if (currentSportCount >= sportCap) {
        skippedSportCap++;
        continue;
      }

      // Market dedup cap (only when market_type_id is set)
      if (marketTypeId !== null) {
        const currentMarketCount = marketTypeCounts.get(marketTypeId) ?? 0;
        if (currentMarketCount >= marketDupCap) {
          skippedMarketDup++;
          continue;
        }
        marketTypeCounts.set(marketTypeId, currentMarketCount + 1);
      }

      sportCounts.set(sportKey, currentSportCount + 1);

      boardRows.push({
        candidate_id: candidate.id,
        board_rank: boardRows.length + 1,
        board_tier: candidate.model_tier ?? 'unknown',
        sport_key: sportKey,
        market_type_id: marketTypeId,
        model_score: candidate.model_score ?? 0,
        board_run_id: boardRunId,
      });
    }

    // Step 4: Write board run
    let errors = 0;
    if (boardRows.length > 0) {
      try {
        await this.repos.syndicateBoard.insertBoardRun(
          boardRows.map((r) => ({ ...r, board_run_id: boardRunId })),
        );
      } catch (err) {
        errors++;
        options.logger?.error?.(
          JSON.stringify({
            service: 'board-construction',
            event: 'insert_failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    const result: BoardConstructionResult = {
      boardSize: errors === 0 ? boardRows.length : 0,
      boardRunId: errors === 0 ? boardRunId : '',
      skippedSuppress: suppressCount,
      skippedBoardCap,
      skippedSportCap,
      skippedMarketDup,
      errors,
      durationMs: Date.now() - startMs,
    };

    options.logger?.info?.(
      JSON.stringify({ service: 'board-construction', event: 'run.completed', ...result }),
    );
    return result;
  }
}

export async function runBoardConstruction(
  repos: {
    pickCandidates: IPickCandidateRepository;
    marketUniverse: IMarketUniverseRepository;
    syndicateBoard: ISyndicateBoardRepository;
  },
  options: BoardConstructionOptions = {},
): Promise<BoardConstructionResult> {
  return new BoardConstructionService(repos).run(options);
}
