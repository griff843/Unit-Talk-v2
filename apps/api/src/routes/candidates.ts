import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import type { AuthContext } from '../auth.js';
import { writeJson } from '../http-utils.js';
import { CandidateBuilderService } from '../candidate-builder-service.js';

/**
 * POST /api/candidates/build
 *
 * Converts opening provider_offers into qualified pick_candidates.
 * Intended for controlled operator-driven backfills/manual rebuilds.
 */
export async function handleBuildCandidates(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const repos = runtime.repositories;
  const auth = (request as IncomingMessage & { auth?: AuthContext }).auth;
  const actor = auth?.identity ?? 'operator:unknown';

  const service = new CandidateBuilderService(repos, {
    logger: runtime.logger as Pick<Console, 'info' | 'warn' | 'error'>,
  });

  const result = await service.build();

  writeJson(response, 200, {
    ok: true,
    actor,
    ...result,
  });
}
