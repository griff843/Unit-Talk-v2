import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import type { AuthContext } from '../auth.js';
import { writeJson } from '../http-utils.js';
import { runBoardPickWriter } from '../board-pick-writer.js';

/**
 * POST /api/board/write-picks
 *
 * Governed write path: reads the latest syndicate_board run and creates canonical
 * picks for all board entries that have not yet been linked to a pick.
 *
 * Requires: operator role (enforced by global POST auth gate in server.ts).
 * Auth context is attached to request.auth by the time this handler runs.
 * Idempotent: candidates with pick_id already set are skipped.
 */
export async function handleBoardWritePicks(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const repos = runtime.repositories;
  const auth = (request as IncomingMessage & { auth?: AuthContext }).auth;
  const actor = auth?.identity ?? 'operator:unknown';

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
    {
      logger: runtime.logger as Pick<Console, 'info' | 'warn' | 'error'>,
      actor,
    },
  );

  writeJson(response, 200, {
    ok: true,
    actor,
    ...result,
  });
}
