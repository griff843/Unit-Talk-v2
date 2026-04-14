import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import type { AuthContext } from '../auth.js';
import { writeJson } from '../http-utils.js';
import { runBoardPickWriter } from '../board-pick-writer.js';
import { runMarketFamilyTuning } from '../market-family-trust-service.js';
import type { IGovernedPickPerformanceRepository, GovernedPickPerformanceRow } from '../market-family-trust-service.js';
import {
  InMemoryMarketFamilyTrustRepository,
  DatabaseMarketFamilyTrustRepository,
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseClientFromConnection,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

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
      participants: repos.participants,
      events: repos.events,
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

// ---------------------------------------------------------------------------
// POST /api/board/run-tuning
// ---------------------------------------------------------------------------

type UntypedQueryResult<T> = Promise<{
  data: T | null;
  error: { message: string } | null;
}>;

/**
 * Queries v_governed_pick_performance via the Supabase client.
 * Uses the untyped pattern (same as other Phase 4/5/6 repositories)
 * since this view is not in generated types.
 */
class DatabaseGovernedPerformanceRepository implements IGovernedPickPerformanceRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(client: UnitTalkSupabaseClient) {
    this.client = client;
  }

  async listSettled(): Promise<GovernedPickPerformanceRow[]> {
    const qb = (this.client as unknown as {
      from(table: string): {
        select(cols: string): {
          not(
            col: string,
            op: string,
            val: unknown,
          ): UntypedQueryResult<GovernedPickPerformanceRow[]>;
        };
      };
    }).from('v_governed_pick_performance');

    const { data, error } = await qb.select('*').not('settlement_result', 'is', null);

    if (error) {
      throw new Error(`v_governed_pick_performance query failed: ${error.message}`);
    }

    return data ?? [];
  }
}

/**
 * POST /api/board/run-tuning
 *
 * Operator-only. Reads v_governed_pick_performance, groups by market family,
 * computes performance metrics, and writes to market_family_trust.
 *
 * Tuning is recorded/queryable but NOT yet applied to runtime routing.
 */
export async function handleBoardRunTuning(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const auth = (request as IncomingMessage & { auth?: AuthContext }).auth;
  const actor = auth?.identity ?? 'operator:unknown';

  const repos = runtime.repositories;

  // Resolve the market_family_trust repository.
  // In in_memory mode, use the in-memory implementation.
  const marketFamilyTrustRepo =
    runtime.persistenceMode === 'database'
      ? (() => {
          const env = loadEnvironment();
          const conn = createServiceRoleDatabaseConnectionConfig(env);
          return new DatabaseMarketFamilyTrustRepository(conn);
        })()
      : new InMemoryMarketFamilyTrustRepository();

  // Resolve the governed performance repository.
  const governedPerformance: IGovernedPickPerformanceRepository =
    runtime.persistenceMode === 'database'
      ? (() => {
          const env = loadEnvironment();
          const conn = createServiceRoleDatabaseConnectionConfig(env);
          const client = createDatabaseClientFromConnection(conn);
          return new DatabaseGovernedPerformanceRepository(client);
        })()
      : // In-memory mode (tests/local): return empty — no live DB available.
        { listSettled: async () => [] };

  const result = await runMarketFamilyTuning({
    governedPerformance,
    marketFamilyTrust: marketFamilyTrustRepo,
    audit: repos.audit,
    logger: runtime.logger as Pick<Console, 'info' | 'warn' | 'error'>,
    actor,
  });

  writeJson(response, 200, {
    ok: true,
    actor,
    ...result,
  });
}
