/**
 * Board Pick Writer — Phase 5 UTV2-476
 *
 * Governed write path from the syndicate_board into canonical picks.
 *
 * This is the ONLY authorized bridge between board output and pick creation
 * in the syndicate machine path. It fires only when explicitly invoked via
 * the operator-controlled route — never on an automatic schedule.
 *
 * Invariants (never violate):
 *   - Reads from syndicate_board (latest run only)
 *   - Writes to picks via processSubmission() only (full enrichment pipeline)
 *   - Source on every created pick is 'board-construction' — explicit attribution
 *   - Links pick_candidates.pick_id after successful write
 *   - Sets pick_candidates.shadow_mode = false on linked candidates
 *   - Never modifies syndicate_board rows
 *   - Never touches model_score / model_tier / model_confidence on candidates
 *   - Idempotent: skips candidates that already have pick_id set
 */

import { applyDevig, americanToImplied } from '@unit-talk/domain';
import type {
  ISyndicateBoardRepository,
  IPickCandidateRepository,
  IMarketUniverseRepository,
  AuditLogRepository,
  PickRepository,
  SubmissionRepository,
  ProviderOfferRepository,
  SettlementRepository,
} from '@unit-talk/db';
import { processSubmission } from './submission-service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BoardPickWriteResult {
  boardRunId: string;
  boardSize: number;
  written: number;
  skipped: number;
  errors: number;
  durationMs: number;
  pickIds: string[];
}

export interface BoardPickWriterOptions {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class BoardPickWriter {
  constructor(
    private readonly repos: {
      syndicateBoard: ISyndicateBoardRepository;
      pickCandidates: IPickCandidateRepository;
      marketUniverse: IMarketUniverseRepository;
      submissions: SubmissionRepository;
      picks: PickRepository;
      audit: AuditLogRepository;
      providerOffers: ProviderOfferRepository;
      settlements?: SettlementRepository;
    },
  ) {}

  async run(options: BoardPickWriterOptions = {}): Promise<BoardPickWriteResult> {
    const startMs = Date.now();

    // Step 1: Load the latest board run
    const boardRows = await this.repos.syndicateBoard.listLatestBoardRun();

    if (boardRows.length === 0) {
      options.logger?.info?.(
        JSON.stringify({ service: 'board-pick-writer', event: 'empty_board', boardSize: 0 }),
      );
      return {
        boardRunId: '',
        boardSize: 0,
        written: 0,
        skipped: 0,
        errors: 0,
        durationMs: Date.now() - startMs,
        pickIds: [],
      };
    }

    const boardRunId = boardRows[0]!.board_run_id;

    // Step 2: Load candidates and universe rows for all board entries
    const candidateIds = boardRows.map((r) => r.candidate_id);
    const candidates = await this.repos.pickCandidates.findByIds(candidateIds);
    const candidateMap = new Map(candidates.map((c) => [c.id, c]));

    const universeIds = [...new Set(candidates.map((c) => c.universe_id))];
    const universeRows = await this.repos.marketUniverse.findByIds(universeIds);
    const universeMap = new Map(universeRows.map((r) => [r.id, r]));

    // Step 3: Write a pick for each board row
    let written = 0;
    let skipped = 0;
    let errors = 0;
    const pickIds: string[] = [];
    const pickIdUpdates: Array<{ id: string; pick_id: string }> = [];

    for (const boardRow of boardRows) {
      const candidate = candidateMap.get(boardRow.candidate_id);
      if (!candidate) {
        options.logger?.warn?.(
          JSON.stringify({
            service: 'board-pick-writer',
            event: 'candidate_not_found',
            candidateId: boardRow.candidate_id,
            boardRunId,
          }),
        );
        skipped++;
        continue;
      }

      // Idempotent: skip candidates already linked to a pick
      if (candidate.pick_id !== null) {
        skipped++;
        continue;
      }

      const universe = universeMap.get(candidate.universe_id);
      if (!universe) {
        options.logger?.warn?.(
          JSON.stringify({
            service: 'board-pick-writer',
            event: 'universe_not_found',
            universeId: candidate.universe_id,
            candidateId: candidate.id,
            boardRunId,
          }),
        );
        skipped++;
        continue;
      }

      // Determine selection side by devigging current odds
      const overOdds = universe.current_over_odds;
      const underOdds = universe.current_under_odds;

      if (!Number.isFinite(overOdds) || !Number.isFinite(underOdds)) {
        options.logger?.warn?.(
          JSON.stringify({
            service: 'board-pick-writer',
            event: 'missing_odds',
            universeId: universe.id,
            candidateId: candidate.id,
            boardRunId,
          }),
        );
        skipped++;
        continue;
      }

      const devigged = applyDevig(
        americanToImplied(overOdds as number),
        americanToImplied(underOdds as number),
        'proportional',
      );
      if (!devigged) {
        skipped++;
        continue;
      }

      const side = devigged.overFair >= devigged.underFair ? 'over' : 'under';
      const odds = side === 'over' ? (overOdds as number) : (underOdds as number);
      const line = universe.current_line ?? null;
      const selection =
        line !== null ? (side === 'over' ? `Over ${line}` : `Under ${line}`) : side;

      const payload = {
        source: 'board-construction' as const,
        submittedBy: 'system:board-construction',
        market: universe.canonical_market_key,
        selection,
        ...(line !== null ? { line } : {}),
        odds,
        confidence: side === 'over' ? devigged.overFair : devigged.underFair,
        metadata: {
          boardRunId,
          boardRank: boardRow.board_rank,
          boardTier: boardRow.board_tier,
          candidateId: candidate.id,
          universeId: universe.id,
          sportKey: universe.sport_key,
          leagueKey: universe.league_key,
          providerKey: universe.provider_key,
          providerEventId: universe.provider_event_id,
          providerMarketKey: universe.provider_market_key,
          ...(universe.provider_participant_id
            ? { providerParticipantId: universe.provider_participant_id }
            : {}),
          modelScore: candidate.model_score,
          modelTier: candidate.model_tier,
          systemGenerated: true,
          governedBoardWrite: true,
        },
      };

      try {
        const result = await processSubmission(payload, {
          submissions: this.repos.submissions,
          picks: this.repos.picks,
          audit: this.repos.audit,
          providerOffers: this.repos.providerOffers,
          settlements: this.repos.settlements,
        });

        pickIds.push(result.pickRecord.id);
        pickIdUpdates.push({ id: candidate.id, pick_id: result.pickRecord.id });
        written++;

        options.logger?.info?.(
          JSON.stringify({
            service: 'board-pick-writer',
            event: 'pick_written',
            pickId: result.pickRecord.id,
            candidateId: candidate.id,
            boardRank: boardRow.board_rank,
            boardRunId,
            duplicate: result.duplicate ?? false,
          }),
        );
      } catch (err) {
        errors++;
        options.logger?.error?.(
          JSON.stringify({
            service: 'board-pick-writer',
            event: 'pick_write_failed',
            candidateId: candidate.id,
            boardRunId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // Step 4: Link pick_id back on candidates (non-fatal if it fails)
    if (pickIdUpdates.length > 0) {
      try {
        await this.repos.pickCandidates.updatePickIdBatch(pickIdUpdates);
      } catch (err) {
        options.logger?.error?.(
          JSON.stringify({
            service: 'board-pick-writer',
            event: 'link_pick_id_failed',
            boardRunId,
            count: pickIdUpdates.length,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // Step 5: Audit the board write run
    try {
      await this.repos.audit.record({
        entityType: 'syndicate_board',
        entityId: boardRunId,
        entityRef: boardRunId,
        action: 'board.pick_write.completed',
        actor: 'system:board-construction',
        payload: {
          boardRunId,
          boardSize: boardRows.length,
          written,
          skipped,
          errors,
          pickIds,
        },
      });
    } catch {
      // Audit failure is non-fatal
    }

    const result: BoardPickWriteResult = {
      boardRunId,
      boardSize: boardRows.length,
      written,
      skipped,
      errors,
      durationMs: Date.now() - startMs,
      pickIds,
    };

    options.logger?.info?.(
      JSON.stringify({ service: 'board-pick-writer', event: 'run.completed', ...result }),
    );

    return result;
  }
}

export async function runBoardPickWriter(
  repos: {
    syndicateBoard: ISyndicateBoardRepository;
    pickCandidates: IPickCandidateRepository;
    marketUniverse: IMarketUniverseRepository;
    submissions: SubmissionRepository;
    picks: PickRepository;
    audit: AuditLogRepository;
    providerOffers: ProviderOfferRepository;
    settlements?: SettlementRepository;
  },
  options: BoardPickWriterOptions = {},
): Promise<BoardPickWriteResult> {
  return new BoardPickWriter(repos).run(options);
}
