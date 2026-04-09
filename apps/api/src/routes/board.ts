import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';
import { runBoardPickWriter } from '../board-pick-writer.js';

/**
 * POST /api/board/write-picks
 *
 * Governed write path: reads the latest syndicate_board run and creates canonical
 * picks for all board entries that have not yet been linked to a pick.
 *
 * Requires: operator role (auth-gated in server.ts).
 * Idempotent: candidates with pick_id already set are skipped.
 */
export async function handleBoardWritePicks(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const repos = runtime.repositories;

  const result = await runBoardPickWriter(
    {
      syndicateBoard: repos.syndicateBoard,
      pickCandidates: repos.pickCandidates,
      marketUniverse: repos.marketUniverse,
      submissions: repos.submissions,
      picks: repos.picks,
      audit: repos.audit,
      providerOffers: repos.providerOffers,
      settlements: repos.settlements,
    },
    { logger: runtime.logger as Pick<Console, 'info' | 'warn' | 'error'> },
  );

  writeJson(response, 200, {
    ok: true,
    ...result,
  });
}
