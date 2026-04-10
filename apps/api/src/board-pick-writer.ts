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
 *   - pick_candidates.pick_id is linked IMMEDIATELY after each successful pick write
 *     (per-row, not deferred to batch) to prevent duplicate-on-rerun if odds move
 *   - shadow_mode = false only on candidates whose pick_id was successfully linked
 *   - Never modifies syndicate_board rows
 *   - Never touches model_score / model_tier / model_confidence on candidates
 *   - Idempotent: skips candidates that already have pick_id set
 *
 * Idempotency guarantee:
 *   Each board row is linked immediately after its pick is created. A partial run
 *   (pick created, link failed) leaves only that row at risk. On rerun:
 *   - If odds are unchanged: processSubmission() returns duplicate=true with the
 *     same pickRecord.id → link is retried safely, no second pick is created.
 *   - If odds changed: new pick is created. This window (pick created + link not yet
 *     persisted) is irreducible without a cross-table atomic RPC. Per-row linking
 *     minimizes it to a single-row operation rather than a full-batch exposure.
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
  /** Operator identity for audit records. Defaults to 'system:board-construction'. */
  actor?: string;
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
    const actor = options.actor ?? 'system:board-construction';

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

    // Step 3: For each board row: create pick, then immediately link pick_id.
    //
    // Per-row immediate linking eliminates the batch-deferred idempotency hole:
    // a pick created in one attempt is linked before the next row is processed.
    // If the link step fails for row N, rows 1..N-1 are already safely linked.
    let written = 0;
    let skipped = 0;
    let errors = 0;
    const pickIds: string[] = [];

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
        submittedBy: actor,
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
          actor,
        },
      };

      // 3a. Create the pick
      let pickId: string;
      try {
        const result = await processSubmission(payload, {
          submissions: this.repos.submissions,
          picks: this.repos.picks,
          audit: this.repos.audit,
          providerOffers: this.repos.providerOffers,
          settlements: this.repos.settlements,
        });
        pickId = result.pickRecord.id;
      } catch (err) {
        errors++;
        options.logger?.error?.(
          JSON.stringify({
            service: 'board-pick-writer',
            event: 'pick_create_failed',
            candidateId: candidate.id,
            boardRunId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        continue;
      }

      // 3b. Immediately link pick_id on the candidate (per-row — not deferred).
      //     If this fails, the pick exists in DB but the candidate is not yet linked.
      //     On rerun: processSubmission() will find the same pick via idempotency key
      //     (if odds unchanged) and we retry the link. The window is now per-row only.
      try {
        await this.repos.pickCandidates.updatePickIdBatch([
          { id: candidate.id, pick_id: pickId },
        ]);
      } catch (linkErr) {
        errors++;
        options.logger?.error?.(
          JSON.stringify({
            service: 'board-pick-writer',
            event: 'link_pick_id_failed',
            candidateId: candidate.id,
            pickId,
            boardRunId,
            error: linkErr instanceof Error ? linkErr.message : String(linkErr),
          }),
        );
        continue;
      }

      // Both pick creation and linking succeeded.
      pickIds.push(pickId);
      written++;

      options.logger?.info?.(
        JSON.stringify({
          service: 'board-pick-writer',
          event: 'pick_written',
          pickId,
          candidateId: candidate.id,
          boardRank: boardRow.board_rank,
          boardRunId,
          actor,
        }),
      );
    }

    // Step 4: Audit the board write run
    try {
      await this.repos.audit.record({
        entityType: 'syndicate_board',
        entityId: boardRunId,
        entityRef: boardRunId,
        action: 'board.pick_write.completed',
        actor,
        payload: {
          boardRunId,
          boardSize: boardRows.length,
          written,
          skipped,
          errors,
          pickIds,
          actor,
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
