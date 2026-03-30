import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseClientFromConnection,
  type OutboxRecord,
  type ReceiptRecord,
  type SettlementRecord,
  type SubmissionRecord,
  type SystemRunRecord,
  type PickRecord,
  type AuditLogRow,
} from '@unit-talk/db';
import { loadEnvironment, type AppEnv } from '@unit-talk/config';
import { memberTiers, resolveTargetRegistry, type MemberTier, type TargetRegistryEntry } from '@unit-talk/contracts';
import {
  resolveEffectiveSettlement,
  computeSettlementSummary,
  type SettlementInput,
  type EffectiveSettlement,
  type SettlementSummary,
} from '@unit-talk/domain';
import { writeJson } from './http-utils.js';
import { handleHealthRequest } from './routes/health.js';
import { handleSnapshotRequest } from './routes/snapshot.js';
import { handlePicksPipelineRequest } from './routes/picks-pipeline.js';
import { handleRecapRequest } from './routes/recap.js';
import { handleStatsRequest } from './routes/stats.js';
import { handleLeaderboardRequest } from './routes/leaderboard.js';
import { handleCapperRecapRequest } from './routes/capper-recap.js';
import { handleParticipantsRequest } from './routes/participants.js';
import { handleDashboardRequest } from './routes/dashboard.js';

export interface OperatorHealthSignal {
  component: 'api' | 'worker' | 'distribution';
  status: 'healthy' | 'degraded' | 'down';
  detail: string;
}

export interface OperatorEntityHealth {
  resolvedEventsCount: number;
  upcomingEventsCount: number;
  resolvedPlayersCount: number;
  resolvedTeamsWithExternalIdCount: number;
  totalTeamsCount: number;
  observedAt: string;
}

export interface OperatorUpcomingEventSummary {
  id: string;
  eventName: string;
  eventDate: string;
  sport: string;
  teams: string[];
  playerCount: number;
}

export interface OperatorParticipantRow {
  id: string;
  displayName: string;
  participantType: string;
  sport: string | null;
  league: string | null;
  externalId: string | null;
  metadata: Record<string, unknown>;
}

export interface OperatorParticipantsResponse {
  participants: OperatorParticipantRow[];
  total: number;
  observedAt: string;
}

export interface OperatorParticipantsFilter {
  type?: 'player' | 'team';
  sport?: string;
  q?: string;
  limit?: number;
}

export interface OperatorSnapshot {
  observedAt: string;
  persistenceMode: 'database' | 'demo';
  health: OperatorHealthSignal[];
  counts: {
    pendingOutbox: number;
    processingOutbox: number;
    failedOutbox: number;
    deadLetterOutbox: number;
    sentOutbox: number;
  };
  recentOutbox: OutboxRecord[];
  recentReceipts: ReceiptRecord[];
  recentSettlements: SettlementRecord[];
  recentRuns: SystemRunRecord[];
  recentPicks: PickRecord[];
  recentAudit: AuditLogRow[];
  workerRuntime: WorkerRuntimeSummary;
  entityHealth?: OperatorEntityHealth;
  upcomingEvents: OperatorUpcomingEventSummary[];
  bestBets: ChannelHealthSummary;
  traderInsights: ChannelHealthSummary;
  canary: {
    target: 'discord:canary';
    recentSentCount: number;
    recentFailureCount: number;
    recentDeadLetterCount: number;
    latestSentAt: string | null;
    latestReceiptRecordedAt: string | null;
    latestMessageId: string | null;
    graduationReady: boolean;
    blockers: string[];
  };
  ingestorHealth: {
    status: string;
    lastRunAt: string | null;
    runCount: number;
  };
  quotaSummary: OperatorQuotaSummary;
  picksPipeline: PicksPipelineSummary;
  recap: SettlementSummary;
  memberTiers: {
    counts: Record<MemberTier, number>;
    observedAt: string;
  };
  boardExposure: {
    bySport: Record<string, number>;
    byGame: Record<string, number>;
  };
  alertAgent: AlertAgentRunSummary;
  gradingAgent: {
    lastGradingRunAt: string | null;
    lastGradingRunStatus: string | null;
    lastPicksGraded: number | null;
    lastFailed: number | null;
    lastRecapPostAt: string | null;
    lastRecapChannel: string | null;
    runCount: number;
  };
  targetRegistry: TargetRegistryEntry[];
}

export interface AlertAgentRunSummary {
  lastDetectionRunAt: string | null;
  lastDetectionStatus: string | null;
  lastDetectionDetails: { signalsFound: number; alertWorthy: number; notable: number; watch: number } | null;
  lastNotificationRunAt: string | null;
  lastNotificationStatus: string | null;
  lastNotificationDetails: { notified: number; suppressed: number } | null;
}

export interface OperatorQuotaProviderSummary {
  provider: string;
  runCount: number;
  requestCount: number;
  successfulRequests: number;
  creditsUsed: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  lastStatus: number | null;
  rateLimitHitCount: number;
  backoffCount: number;
  backoffMs: number;
  throttled: boolean;
  headersSeen: boolean;
  lastSeenAt: string | null;
}

export interface OperatorQuotaSummary {
  observedAt: string;
  providers: OperatorQuotaProviderSummary[];
}

export interface OutboxFilter {
  status?: string;
  target?: string;
  since?: string;
  lifecycleState?: string;
  limit?: number;
}

export interface ChannelHealthSummary {
  target: 'discord:canary' | 'discord:best-bets' | 'discord:trader-insights';
  recentSentCount: number;
  recentFailureCount: number;
  recentDeadLetterCount: number;
  latestSentAt: string | null;
  latestReceiptRecordedAt: string | null;
  latestMessageId: string | null;
  activationHealthy: boolean;
  blockers: string[];
}

export interface WorkerRuntimeSummary {
  drainState: 'idle' | 'draining' | 'stalled' | 'blocked';
  detail: string;
  latestDistributionRunStatus: string | null;
  latestDistributionRunAt: string | null;
  latestSuccessfulDistributionRunAt: string | null;
  latestReceiptRecordedAt: string | null;
  latestSentOutboxAt: string | null;
}

export interface PickPipelineRow {
  id: string;
  status: string;
  approvalStatus: string;
  promotionStatus: string | null;
  promotionTarget: string | null;
  promotionScore: number | null;
  settlementResult: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface PicksPipelineSummary {
  counts: {
    validated: number;
    queued: number;
    posted: number;
    settled: number;
    total: number;
  };
  recentPicks: PickPipelineRow[];
}

export interface OperatorSnapshotProvider {
  getSnapshot(filter?: OutboxFilter): Promise<OperatorSnapshot>;
  getParticipants?(filter?: OperatorParticipantsFilter): Promise<OperatorParticipantsResponse>;
}

export type StatsWindowDays = 7 | 14 | 30 | 90;

export interface CapperStatsResponse {
  scope: 'capper' | 'server';
  capper: string | null;
  window: StatsWindowDays;
  sport: string | null;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  roiPct: number | null;
  avgClvPct: number | null;
  beatsLine: number | null;
  picksWithClv: number;
  lastFive: Array<'W' | 'L' | 'P'>;
}

export interface OperatorStatsQuery {
  capper?: string;
  window: StatsWindowDays;
  sport?: string;
}

export interface OperatorStatsProvider {
  getStats(query: OperatorStatsQuery): Promise<CapperStatsResponse>;
}

export interface CapperRecapPick {
  market: string;
  selection: string;
  result: 'win' | 'loss' | 'push';
  profitLossUnits: number;
  clvPercent: number | null;
  stakeUnits: number | null;
  settledAt: string;
}

export interface CapperRecapResponse {
  submittedBy: string;
  picks: CapperRecapPick[];
}

export interface OperatorCapperRecapQuery {
  submittedBy: string;
  limit: number;
}

export interface OperatorCapperRecapProvider {
  getCapperRecap(query: OperatorCapperRecapQuery): Promise<CapperRecapResponse>;
}

export interface LeaderboardEntry {
  rank: number;
  capper: string;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  roiPct: number | null;
  avgClvPct: number | null;
  streak: number;
}

export interface LeaderboardResponse {
  window: StatsWindowDays;
  sport: string | null;
  minPicks: number;
  entries: LeaderboardEntry[];
  observedAt: string;
}

export interface OperatorLeaderboardQuery {
  window: StatsWindowDays;
  sport?: string;
  limit: number;
  minPicks: number;
}

export interface OperatorLeaderboardProvider {
  getLeaderboard(query: OperatorLeaderboardQuery): Promise<LeaderboardResponse>;
}

export interface OperatorRouteDependencies {
  provider: OperatorSnapshotProvider;
  statsProvider: OperatorStatsProvider;
  leaderboardProvider: OperatorLeaderboardProvider;
  capperRecapProvider: OperatorCapperRecapProvider;
}

export interface OperatorServerOptions {
  provider?: OperatorSnapshotProvider;
  statsProvider?: OperatorStatsProvider;
  leaderboardProvider?: OperatorLeaderboardProvider;
  capperRecapProvider?: OperatorCapperRecapProvider;
}

export type OperatorRuntimeMode = 'fail_open' | 'fail_closed';

export function createOperatorServer(options: OperatorServerOptions = {}) {
  const provider = options.provider ?? createOperatorSnapshotProvider();
  const statsProvider = options.statsProvider ?? createOperatorStatsProvider();
  const leaderboardProvider =
    options.leaderboardProvider ?? createOperatorLeaderboardProvider();
  const capperRecapProvider =
    options.capperRecapProvider ?? createOperatorCapperRecapProvider();

  return http.createServer(async (request, response) => {
    await routeOperatorRequest(
      request,
      response,
      provider,
      statsProvider,
      leaderboardProvider,
      capperRecapProvider,
    );
  });
}

export async function routeOperatorRequest(
  request: IncomingMessage,
  response: ServerResponse,
  provider: OperatorSnapshotProvider,
  statsProvider: OperatorStatsProvider,
  leaderboardProvider: OperatorLeaderboardProvider,
  capperRecapProvider: OperatorCapperRecapProvider,
) {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const deps: OperatorRouteDependencies = { provider, statsProvider, leaderboardProvider, capperRecapProvider };

  if (method === 'GET' && url.pathname === '/health') {
    return handleHealthRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/operator/snapshot') {
    return handleSnapshotRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/operator/picks-pipeline') {
    return handlePicksPipelineRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/operator/recap') {
    return handleRecapRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/operator/stats') {
    return handleStatsRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/operator/leaderboard') {
    return handleLeaderboardRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/operator/capper-recap') {
    return handleCapperRecapRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/operator/participants') {
    return handleParticipantsRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/') {
    return handleDashboardRequest(request, response, deps);
  }

  return writeJson(response, 404, {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${method} ${url.pathname}`,
    },
  });
}

export function createOperatorSnapshotProvider(
  options: { environment?: AppEnv } = {},
): OperatorSnapshotProvider {
  let environment = options.environment;

  try {
    environment ??= loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(environment);
    const client = createDatabaseClientFromConnection(connection);

    return {
      async getSnapshot(filter?: OutboxFilter) {
        const today = new Date().toISOString().slice(0, 10);
        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const [
          outboxResult,
          receiptsResult,
          settlementsResult,
          runsResult,
          picksResult,
          auditResult,
          validatedCountResult,
          queuedCountResult,
          postedCountResult,
          settledCountResult,
          resolvedEventsCountResult,
          upcomingEventsCountResult,
          resolvedPlayersCountResult,
          resolvedTeamsWithExternalIdCountResult,
          totalTeamsCountResult,
          upcomingEventsResult,
          memberTiersResult,
        ] = await Promise.all([
          (() => {
            let q = client.from('distribution_outbox').select('*');
            if (filter?.status) q = q.eq('status', filter.status);
            if (filter?.target) q = q.eq('target', filter.target);
            if (filter?.since) q = q.gte('created_at', filter.since);
            return q.order('created_at', { ascending: false }).limit(filter ? 20 : 12);
          })(),
          client
            .from('distribution_receipts')
            .select('*')
            .order('recorded_at', { ascending: false })
            .limit(12),
          client
            .from('settlement_records')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(12),
          (() => {
            let q = client.from('system_runs').select('*');
            if (filter?.since) q = q.gte('created_at', filter.since);
            return q.order('created_at', { ascending: false }).limit(filter?.since ? 20 : 12);
          })(),
          (() => {
            let q = client.from('picks').select('*');
            if (filter?.lifecycleState) q = q.eq('status', filter.lifecycleState);
            if (filter?.since) q = q.gte('created_at', filter.since);
            return q.order('created_at', { ascending: false }).limit(filter?.lifecycleState || filter?.since ? 20 : 12);
          })(),
          client.from('audit_log').select('*').order('created_at', { ascending: false }).limit(12),
          client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'validated'),
          client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
          client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'posted'),
          client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'settled'),
          client.from('events').select('id', { count: 'exact', head: true }).not('external_id', 'is', null),
          client
            .from('events')
            .select('id', { count: 'exact', head: true })
            .gte('event_date', today)
            .lte('event_date', nextWeek),
          client
            .from('participants')
            .select('id', { count: 'exact', head: true })
            .eq('participant_type', 'player'),
          client
            .from('participants')
            .select('id', { count: 'exact', head: true })
            .eq('participant_type', 'team')
            .not('external_id', 'is', null),
          client
            .from('participants')
            .select('id', { count: 'exact', head: true })
            .eq('participant_type', 'team'),
          client
            .from('events')
            .select('id,event_name,event_date,sport_id')
            .gte('event_date', today)
            .lte('event_date', nextWeek)
            .order('event_date', { ascending: true })
            .limit(5),
          client
            .from('member_tiers')
            .select('tier')
            .is('effective_until', null),
        ]);

        if (outboxResult.error) {
          throw outboxResult.error;
        }
        if (receiptsResult.error) {
          throw receiptsResult.error;
        }
        if (settlementsResult.error) {
          throw settlementsResult.error;
        }
        if (runsResult.error) {
          throw runsResult.error;
        }
        if (picksResult.error) {
          throw picksResult.error;
        }
        if (auditResult.error) {
          throw auditResult.error;
        }
        for (const result of [
          validatedCountResult,
          queuedCountResult,
          postedCountResult,
          settledCountResult,
          resolvedEventsCountResult,
          upcomingEventsCountResult,
          resolvedPlayersCountResult,
          resolvedTeamsWithExternalIdCountResult,
          totalTeamsCountResult,
        ]) {
          if (result.error) {
            throw result.error;
          }
        }
        if (upcomingEventsResult.error) {
          throw upcomingEventsResult.error;
        }
        // member_tiers query is best-effort — table may not exist in older environments
        const memberTierRows =
          memberTiersResult.error ? [] : (memberTiersResult.data ?? []) as Array<{ tier: string }>;

        const recentOutbox = outboxResult.data ?? [];
        const recentReceipts = receiptsResult.data ?? [];
        const recentSettlements = settlementsResult.data ?? [];
        const recentRuns = runsResult.data ?? [];
        const recentPicks = picksResult.data ?? [];
        const recentAudit = auditResult.data ?? [];
        const upcomingEvents = upcomingEventsResult.data ?? [];
        const eventIds = upcomingEvents.map((row) => row.id as string);
        const eventParticipants =
          eventIds.length > 0
            ? await loadEventParticipants(client, eventIds)
            : [];
        const participants =
          eventParticipants.length > 0
            ? await loadParticipantsForEvents(client, eventParticipants)
            : [];

        return createSnapshotFromRows({
          persistenceMode: 'database',
          recentOutbox,
          recentReceipts,
          recentSettlements,
          recentRuns,
          recentPicks,
          recentAudit,
          entityHealth: {
            resolvedEventsCount: resolvedEventsCountResult.count ?? 0,
            upcomingEventsCount: upcomingEventsCountResult.count ?? 0,
            resolvedPlayersCount: resolvedPlayersCountResult.count ?? 0,
            resolvedTeamsWithExternalIdCount: resolvedTeamsWithExternalIdCountResult.count ?? 0,
            totalTeamsCount: totalTeamsCountResult.count ?? 0,
            observedAt: new Date().toISOString(),
          },
          upcomingEvents: mapUpcomingEvents(
            upcomingEvents as Array<{
              id: string;
              event_name: string;
              event_date: string;
              sport_id: string;
            }>,
            eventParticipants,
            participants,
          ),
          picksPipelineCounts: {
            validated: validatedCountResult.count ?? 0,
            queued: queuedCountResult.count ?? 0,
            posted: postedCountResult.count ?? 0,
            settled: settledCountResult.count ?? 0,
            total:
              (validatedCountResult.count ?? 0) +
              (queuedCountResult.count ?? 0) +
              (postedCountResult.count ?? 0) +
              (settledCountResult.count ?? 0),
          },
          memberTierRows,
        });
      },
      async getParticipants(filter?: OperatorParticipantsFilter) {
        let query = client
          .from('participants')
          .select('id,display_name,participant_type,sport,league,external_id,metadata', {
            count: 'exact',
          });

        if (filter?.type) {
          query = query.eq('participant_type', filter.type);
        }
        if (filter?.sport) {
          query = query.eq('sport', filter.sport);
        }
        if (filter?.q) {
          query = query.ilike('display_name', `%${filter.q}%`);
        }

        const { data, error, count } = await query
          .order('display_name', { ascending: true })
          .limit(filter?.limit ?? 20);

        if (error) {
          throw error;
        }

        return {
          participants: (data ?? []).map((row) => ({
            id: row.id as string,
            displayName: row.display_name as string,
            participantType: row.participant_type as string,
            sport: (row.sport as string | null) ?? null,
            league: (row.league as string | null) ?? null,
            externalId: (row.external_id as string | null) ?? null,
            metadata: readJsonObject(row.metadata) ?? {},
          })),
          total: count ?? data?.length ?? 0,
          observedAt: new Date().toISOString(),
        };
      },
    };
  } catch (error) {
    return handleOperatorProviderFailure(error, environment);
  }
}

export function createOperatorStatsProvider(
  options: { environment?: AppEnv } = {},
): OperatorStatsProvider {
  let environment = options.environment;

  try {
    environment ??= loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(environment);
    const client = createDatabaseClientFromConnection(connection);

    return {
      async getStats(query: OperatorStatsQuery) {
        const sinceIso = createStatsSinceIso(query.window);
        const candidateSettlementsResult = await client
          .from('settlement_records')
          .select('*')
          .eq('source', 'grading')
          .gte('settled_at', sinceIso)
          .in('result', ['win', 'loss', 'push']);

        if (candidateSettlementsResult.error) {
          throw candidateSettlementsResult.error;
        }

        const candidateSettlements = candidateSettlementsResult.data ?? [];
        if (candidateSettlements.length === 0) {
          return createEmptyStatsResponse(query);
        }

        const pickIds = uniqueStrings(candidateSettlements.map((row) => row.pick_id));
        const [allSettlementsResult, picksResult] = await Promise.all([
          client
            .from('settlement_records')
            .select('*')
            .eq('source', 'grading')
            .in('pick_id', pickIds),
          client.from('picks').select('*').in('id', pickIds),
        ]);

        if (allSettlementsResult.error) {
          throw allSettlementsResult.error;
        }
        if (picksResult.error) {
          throw picksResult.error;
        }

        const picks = picksResult.data ?? [];
        const submissionIds = uniqueStrings(
          picks
            .map((row) => row.submission_id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
        );

        const submissionsResult =
          submissionIds.length > 0
            ? await client.from('submissions').select('*').in('id', submissionIds)
            : { data: [] as SubmissionRecord[], error: null };

        if (submissionsResult.error) {
          throw submissionsResult.error;
        }

        const statsRows = createStatsRows({
          settlements: allSettlementsResult.data ?? [],
          picks,
          submissions: submissionsResult.data ?? [],
        });

        return buildCapperStatsResponse(
          query,
          statsRows.filter((row) => matchesStatsWindow(row, sinceIso)),
        );
      },
    };
  } catch (error) {
    if (readOperatorRuntimeMode(environment) === 'fail_closed') {
      throw new Error(
        'operator-web runtime mode is fail_closed and stats provider configuration could not be loaded.',
        { cause: error },
      );
    }

    return {
      async getStats(query: OperatorStatsQuery) {
        return createEmptyStatsResponse(query);
      },
    };
  }
}

export function createOperatorLeaderboardProvider(
  options: { environment?: AppEnv } = {},
): OperatorLeaderboardProvider {
  let environment = options.environment;

  try {
    environment ??= loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(environment);
    const client = createDatabaseClientFromConnection(connection);

    return {
      async getLeaderboard(query: OperatorLeaderboardQuery) {
        const sinceIso = createStatsSinceIso(query.window);
        const candidateSettlementsResult = await client
          .from('settlement_records')
          .select('*')
          .eq('source', 'grading')
          .gte('settled_at', sinceIso)
          .in('result', ['win', 'loss', 'push']);

        if (candidateSettlementsResult.error) {
          throw candidateSettlementsResult.error;
        }

        const candidateSettlements = candidateSettlementsResult.data ?? [];
        if (candidateSettlements.length === 0) {
          return createEmptyLeaderboardResponse(query);
        }

        const pickIds = uniqueStrings(candidateSettlements.map((row) => row.pick_id));
        const [allSettlementsResult, picksResult] = await Promise.all([
          client
            .from('settlement_records')
            .select('*')
            .eq('source', 'grading')
            .in('pick_id', pickIds),
          client.from('picks').select('*').in('id', pickIds),
        ]);

        if (allSettlementsResult.error) {
          throw allSettlementsResult.error;
        }
        if (picksResult.error) {
          throw picksResult.error;
        }

        const picks = picksResult.data ?? [];
        const submissionIds = uniqueStrings(
          picks
            .map((row) => row.submission_id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
        );

        const submissionsResult =
          submissionIds.length > 0
            ? await client.from('submissions').select('*').in('id', submissionIds)
            : { data: [] as SubmissionRecord[], error: null };

        if (submissionsResult.error) {
          throw submissionsResult.error;
        }

        const statsRows = createStatsRows({
          settlements: allSettlementsResult.data ?? [],
          picks,
          submissions: submissionsResult.data ?? [],
        });

        return buildLeaderboardResponse(
          query,
          statsRows.filter((row) => matchesStatsWindow(row, sinceIso)),
        );
      },
    };
  } catch (error) {
    if (readOperatorRuntimeMode(environment) === 'fail_closed') {
      throw new Error(
        'operator-web runtime mode is fail_closed and leaderboard provider configuration could not be loaded.',
        { cause: error },
      );
    }

    return {
      async getLeaderboard(query: OperatorLeaderboardQuery) {
        return createEmptyLeaderboardResponse(query);
      },
    };
  }
}

export function createOperatorCapperRecapProvider(
  options: { environment?: AppEnv } = {},
): OperatorCapperRecapProvider {
  let environment = options.environment;

  try {
    environment ??= loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(environment);
    const client = createDatabaseClientFromConnection(connection);

    return {
      async getCapperRecap(query: OperatorCapperRecapQuery) {
        const candidateSettlementsResult = await client
          .from('settlement_records')
          .select('*')
          .eq('source', 'grading')
          .in('result', ['win', 'loss', 'push']);

        if (candidateSettlementsResult.error) {
          throw candidateSettlementsResult.error;
        }

        const candidateSettlements = candidateSettlementsResult.data ?? [];
        if (candidateSettlements.length === 0) {
          return createEmptyCapperRecapResponse(query);
        }

        const pickIds = uniqueStrings(candidateSettlements.map((row) => row.pick_id));
        const [allSettlementsResult, picksResult] = await Promise.all([
          client
            .from('settlement_records')
            .select('*')
            .eq('source', 'grading')
            .in('pick_id', pickIds),
          client.from('picks').select('*').in('id', pickIds),
        ]);

        if (allSettlementsResult.error) {
          throw allSettlementsResult.error;
        }
        if (picksResult.error) {
          throw picksResult.error;
        }

        const picks = picksResult.data ?? [];
        const submissionIds = uniqueStrings(
          picks
            .map((row) => row.submission_id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
        );

        const submissionsResult =
          submissionIds.length > 0
            ? await client.from('submissions').select('*').in('id', submissionIds)
            : { data: [] as SubmissionRecord[], error: null };

        if (submissionsResult.error) {
          throw submissionsResult.error;
        }

        const statsRows = createStatsRows({
          settlements: allSettlementsResult.data ?? [],
          picks,
          submissions: submissionsResult.data ?? [],
        });

        return buildCapperRecapResponse(query, statsRows);
      },
    };
  } catch (error) {
    if (readOperatorRuntimeMode(environment) === 'fail_closed') {
      throw new Error(
        'operator-web runtime mode is fail_closed and capper recap provider configuration could not be loaded.',
        { cause: error },
      );
    }

    return {
      async getCapperRecap(query: OperatorCapperRecapQuery) {
        return createEmptyCapperRecapResponse(query);
      },
    };
  }
}

export function createSnapshotFromRows(input: {
  persistenceMode: 'database' | 'demo';
  recentOutbox: OutboxRecord[];
  recentReceipts: ReceiptRecord[];
  recentSettlements?: SettlementRecord[];
  recentRuns: SystemRunRecord[];
  recentPicks: PickRecord[];
  recentAudit: AuditLogRow[];
  entityHealth?: OperatorEntityHealth;
  upcomingEvents?: OperatorUpcomingEventSummary[];
  picksPipelineCounts?: PicksPipelineSummary['counts'];
  memberTierRows?: Array<{ tier: string }>;
}): OperatorSnapshot {
  const counts = {
    pendingOutbox: input.recentOutbox.filter((row) => row.status === 'pending').length,
    processingOutbox: input.recentOutbox.filter((row) => row.status === 'processing').length,
    failedOutbox: input.recentOutbox.filter((row) => row.status === 'failed').length,
    deadLetterOutbox: input.recentOutbox.filter((row) => row.status === 'dead_letter').length,
    sentOutbox: input.recentOutbox.filter((row) => row.status === 'sent').length,
  };

  const mostRecentRun = input.recentRuns[0];
  const workerStatus = inferWorkerStatus(mostRecentRun, counts, input.recentRuns);
  const workerRuntime = summarizeWorkerRuntime(
    input.recentRuns,
    input.recentOutbox,
    input.recentReceipts,
  );
  const ingestorRuns = input.recentRuns.filter((row) => row.run_type.startsWith('ingestor'));
  const latestIngestorRun = ingestorRuns[0];
  const ingestorHealth = {
    status: latestIngestorRun?.status ?? 'unknown',
    lastRunAt: latestIngestorRun?.started_at ?? null,
    runCount: ingestorRuns.length,
  };
  const quotaSummary = summarizeQuotaFromRuns(ingestorRuns);
  const distributionStatus =
    counts.failedOutbox > 0 || counts.deadLetterOutbox > 0
      ? {
          component: 'distribution' as const,
          status: 'degraded' as const,
          detail:
            counts.failedOutbox > 0 && counts.deadLetterOutbox > 0
              ? `${counts.failedOutbox} failed and ${counts.deadLetterOutbox} dead-letter outbox item(s) need attention`
              : counts.failedOutbox > 0
                ? `${counts.failedOutbox} failed outbox item(s) need attention`
                : `${counts.deadLetterOutbox} dead-letter outbox item(s) need attention`,
        }
      : {
          component: 'distribution' as const,
          status: 'healthy' as const,
          detail:
            counts.pendingOutbox > 0
              ? `${counts.pendingOutbox} pending outbox item(s) queued`
              : 'no failed outbox items detected',
        };

  return {
    observedAt: new Date().toISOString(),
    persistenceMode: input.persistenceMode,
    health: [
      {
        component: 'api',
        status: 'healthy',
        detail: `${input.recentPicks.length} recent pick record(s) available`,
      },
      workerStatus,
      distributionStatus,
    ],
    counts,
    recentOutbox: input.recentOutbox,
    recentReceipts: input.recentReceipts,
    recentSettlements: input.recentSettlements ?? [],
    recentRuns: input.recentRuns,
    recentPicks: input.recentPicks,
    recentAudit: input.recentAudit,
    workerRuntime,
    entityHealth: input.entityHealth ?? createEmptyEntityHealth(),
    upcomingEvents: input.upcomingEvents ?? [],
    bestBets: summarizeChannelLane('discord:best-bets', outboxRowsToChannelId('discord:best-bets'), input.recentOutbox, input.recentReceipts),
    traderInsights: summarizeChannelLane(
      'discord:trader-insights',
      outboxRowsToChannelId('discord:trader-insights'),
      input.recentOutbox,
      input.recentReceipts,
    ),
    canary: summarizeCanaryLane(input.recentOutbox, input.recentReceipts),
    ingestorHealth,
    quotaSummary,
    picksPipeline: summarizePicksPipeline(
      input.recentPicks,
      input.recentSettlements ?? [],
      input.picksPipelineCounts,
    ),
    recap: computeSettlementSummary(resolveAllEffectiveSettlements(input.recentSettlements ?? [])),
    memberTiers: computeMemberTierCounts(input.memberTierRows ?? []),
    boardExposure: { bySport: {}, byGame: {} },
    alertAgent: summarizeAlertAgentRuns(input.recentRuns),
    gradingAgent: summarizeGradingAgent(input.recentRuns),
    targetRegistry: resolveTargetRegistry(),
  };
}

function computeMemberTierCounts(rows: Array<{ tier: string }>): OperatorSnapshot['memberTiers'] {
  const empty = Object.fromEntries(memberTiers.map((t) => [t, 0])) as Record<MemberTier, number>;
  for (const row of rows) {
    if (row.tier in empty) {
      (empty as Record<string, number>)[row.tier]! += 1;
    }
  }
  return { counts: empty, observedAt: new Date().toISOString() };
}

function summarizeAlertAgentRuns(recentRuns: SystemRunRecord[]): AlertAgentRunSummary {
  const detectionRuns = recentRuns.filter((row) => row.run_type === 'alert.detection');
  const notificationRuns = recentRuns.filter((row) => row.run_type === 'alert.notification');
  const lastDetectionRun = detectionRuns[0];
  const lastNotificationRun = notificationRuns[0];

  let lastDetectionDetails: AlertAgentRunSummary['lastDetectionDetails'] = null;
  if (lastDetectionRun) {
    const d = readJsonObject(lastDetectionRun.details);
    if (d) {
      lastDetectionDetails = {
        signalsFound: typeof d['signalsFound'] === 'number' ? d['signalsFound'] : 0,
        alertWorthy: typeof d['alertWorthy'] === 'number' ? d['alertWorthy'] : 0,
        notable: typeof d['notable'] === 'number' ? d['notable'] : 0,
        watch: typeof d['watch'] === 'number' ? d['watch'] : 0,
      };
    }
  }

  let lastNotificationDetails: AlertAgentRunSummary['lastNotificationDetails'] = null;
  if (lastNotificationRun) {
    const d = readJsonObject(lastNotificationRun.details);
    if (d) {
      lastNotificationDetails = {
        notified: typeof d['notified'] === 'number' ? d['notified'] : 0,
        suppressed: typeof d['suppressed'] === 'number' ? d['suppressed'] : 0,
      };
    }
  }

  return {
    lastDetectionRunAt: lastDetectionRun?.started_at ?? null,
    lastDetectionStatus: lastDetectionRun?.status ?? null,
    lastDetectionDetails,
    lastNotificationRunAt: lastNotificationRun?.started_at ?? null,
    lastNotificationStatus: lastNotificationRun?.status ?? null,
    lastNotificationDetails,
  };
}

function summarizeGradingAgent(recentRuns: SystemRunRecord[]): OperatorSnapshot['gradingAgent'] {
  const gradingRuns = recentRuns.filter((row) => row.run_type === 'grading.run');
  const recapRuns = recentRuns.filter((row) => row.run_type === 'recap.post');
  const latestGradingRun = gradingRuns[0];
  const latestRecapRun = recapRuns[0];

  const lastPicksGraded =
    latestGradingRun?.details != null &&
    typeof (latestGradingRun.details as Record<string, unknown>)['picksGraded'] === 'number'
      ? ((latestGradingRun.details as Record<string, unknown>)['picksGraded'] as number)
      : null;

  const lastFailed =
    latestGradingRun?.details != null &&
    typeof (latestGradingRun.details as Record<string, unknown>)['failed'] === 'number'
      ? ((latestGradingRun.details as Record<string, unknown>)['failed'] as number)
      : null;

  const lastRecapChannel =
    latestRecapRun?.details != null &&
    typeof (latestRecapRun.details as Record<string, unknown>)['channel'] === 'string'
      ? ((latestRecapRun.details as Record<string, unknown>)['channel'] as string)
      : null;

  return {
    lastGradingRunAt: latestGradingRun?.started_at ?? null,
    lastGradingRunStatus: latestGradingRun?.status ?? null,
    lastPicksGraded,
    lastFailed,
    lastRecapPostAt: latestRecapRun?.started_at ?? null,
    lastRecapChannel,
    runCount: gradingRuns.length,
  };
}

function summarizeCanaryLane(
  outboxRows: OutboxRecord[],
  receiptRows: ReceiptRecord[],
): OperatorSnapshot['canary'] {
  const summary = summarizeChannelLane(
    'discord:canary',
    outboxRowsToChannelId('discord:canary'),
    outboxRows,
    receiptRows,
  );
  const blockers = [...summary.blockers];
  if (summary.recentSentCount < 3) {
    blockers.unshift('fewer than 3 recent sent canary deliveries are visible');
  }
  return {
    ...summary,
    target: 'discord:canary',
    graduationReady: blockers.length === 0,
    blockers,
  };
}

function summarizeChannelLane(
  target: 'discord:canary' | 'discord:best-bets' | 'discord:trader-insights',
  channelId: string,
  outboxRows: OutboxRecord[],
  receiptRows: ReceiptRecord[],
): ChannelHealthSummary {
  const targetOutbox = outboxRows.filter((row) => row.target === target);
  const sentRows = targetOutbox.filter((row) => row.status === 'sent');
  const failedRows = targetOutbox.filter((row) => row.status === 'failed');
  const deadLetterRows = targetOutbox.filter((row) => row.status === 'dead_letter');
  const relatedOutboxIds = new Set(targetOutbox.map((row) => row.id));
  const targetReceipts = receiptRows.filter(
    (row) =>
      row.channel === channelId || (row.outbox_id !== null && relatedOutboxIds.has(row.outbox_id)),
  );
  const blockers: string[] = [];
  if (sentRows.length < 1) {
    blockers.push(`no recent sent ${target} deliveries are visible`);
  }
  if (failedRows.length > 0) {
    blockers.push(`${failedRows.length} failed ${target} outbox item(s) still visible`);
  }
  if (deadLetterRows.length > 0) {
    blockers.push(`${deadLetterRows.length} dead-letter ${target} outbox item(s) still visible`);
  }
  return {
    target,
    recentSentCount: sentRows.length,
    recentFailureCount: failedRows.length,
    recentDeadLetterCount: deadLetterRows.length,
    latestSentAt: sentRows[0]?.updated_at ?? null,
    latestReceiptRecordedAt: targetReceipts[0]?.recorded_at ?? null,
    latestMessageId: targetReceipts[0]?.external_id ?? null,
    activationHealthy: blockers.length === 0,
    blockers,
  };
}

function summarizeWorkerRuntime(
  recentRuns: SystemRunRecord[],
  recentOutbox: OutboxRecord[],
  recentReceipts: ReceiptRecord[],
): WorkerRuntimeSummary {
  const distributionRuns = recentRuns.filter((row) => row.run_type === 'distribution.process');
  const latestDistributionRun = distributionRuns[0];
  const latestSuccessfulDistributionRun = distributionRuns.find((row) => row.status === 'succeeded');
  const latestReceipt = recentReceipts[0];
  const latestSentOutbox = recentOutbox.find((row) => row.status === 'sent');
  const pendingCount = recentOutbox.filter((row) => row.status === 'pending').length;
  const processingCount = recentOutbox.filter((row) => row.status === 'processing').length;
  const failedCount = recentOutbox.filter((row) => row.status === 'failed').length;
  const deadLetterCount = recentOutbox.filter((row) => row.status === 'dead_letter').length;

  const base = {
    latestDistributionRunStatus: latestDistributionRun?.status ?? null,
    latestDistributionRunAt: latestDistributionRun?.started_at ?? null,
    latestSuccessfulDistributionRunAt: latestSuccessfulDistributionRun?.started_at ?? null,
    latestReceiptRecordedAt: latestReceipt?.recorded_at ?? null,
    latestSentOutboxAt: latestSentOutbox?.updated_at ?? null,
  };

  if (failedCount > 0 || deadLetterCount > 0) {
    return {
      drainState: 'blocked',
      detail:
        failedCount > 0 && deadLetterCount > 0
          ? `${failedCount} failed and ${deadLetterCount} dead-letter outbox item(s) are blocking clean drain`
          : failedCount > 0
            ? `${failedCount} failed outbox item(s) are blocking clean drain`
            : `${deadLetterCount} dead-letter outbox item(s) are blocking clean drain`,
      ...base,
    };
  }

  if (pendingCount === 0 && processingCount === 0) {
    return {
      drainState: 'idle',
      detail: 'no pending or processing outbox items are visible',
      ...base,
    };
  }

  if (processingCount > 0 || latestDistributionRun?.status === 'running') {
    return {
      drainState: 'draining',
      detail:
        processingCount > 0
          ? `${processingCount} outbox item(s) are actively processing`
          : `${pendingCount} pending outbox item(s) are visible while the worker is running`,
      ...base,
    };
  }

  return {
    drainState: 'stalled',
    detail:
      pendingCount > 0
        ? `${pendingCount} pending outbox item(s) are queued without an active worker run`
        : 'worker runtime is not actively draining visible outbox items',
    ...base,
  };
}

function summarizePicksPipeline(
  recentPicks: PickRecord[],
  recentSettlements: SettlementRecord[],
  counts?: PicksPipelineSummary['counts'],
): PicksPipelineSummary {
  const settlementByPickId = buildEffectiveSettlementResultMap(recentSettlements);
  const recentRows: PickPipelineRow[] = recentPicks.map((row) => ({
    id: row.id,
    status: row.status,
    approvalStatus: row.approval_status,
    promotionStatus: row.promotion_status,
    promotionTarget: row.promotion_target,
    promotionScore: row.promotion_score,
    settlementResult: settlementByPickId.get(row.id) ?? null,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  }));
  const derivedCounts = counts ?? {
    validated: recentPicks.filter((row) => row.status === 'validated').length,
    queued: recentPicks.filter((row) => row.status === 'queued').length,
    posted: recentPicks.filter((row) => row.status === 'posted').length,
    settled: recentPicks.filter((row) => row.status === 'settled').length,
    total: recentPicks.length,
  };
  return {
    counts: {
      ...derivedCounts,
      total:
        counts?.total ??
        derivedCounts.validated +
          derivedCounts.queued +
          derivedCounts.posted +
          derivedCounts.settled,
    },
    recentPicks: recentRows,
  };
}

function summarizeQuotaFromRuns(recentRuns: SystemRunRecord[]): OperatorQuotaSummary {
  const quotaByProvider = new Map<string, OperatorQuotaProviderSummary>();

  for (const run of recentRuns) {
    const details = readJsonObject(run.details);
    const quota = details ? readJsonObject(details.quota) : null;
    if (!quota) {
      continue;
    }

    const provider = typeof quota.provider === 'string' ? quota.provider : null;
    if (!provider) {
      continue;
    }

    const summary = quotaByProvider.get(provider) ?? {
      provider,
      runCount: 0,
      requestCount: 0,
      successfulRequests: 0,
      creditsUsed: 0,
      limit: null,
      remaining: null,
      resetAt: null,
      lastStatus: null,
      rateLimitHitCount: 0,
      backoffCount: 0,
      backoffMs: 0,
      throttled: false,
      headersSeen: false,
      lastSeenAt: null,
    };

    summary.runCount += 1;
    summary.requestCount += readNumber(quota.requestCount);
    summary.successfulRequests += readNumber(quota.successfulRequests);
    summary.creditsUsed += readNumber(quota.creditsUsed);
    summary.limit = readNullableNumber(quota.limit) ?? summary.limit;
    summary.remaining = readNullableNumber(quota.remaining) ?? summary.remaining;
    summary.resetAt = readNullableString(quota.resetAt) ?? summary.resetAt;
    summary.lastStatus = readNullableNumber(quota.lastStatus) ?? summary.lastStatus;
    summary.rateLimitHitCount += readNumber(quota.rateLimitHitCount);
    summary.backoffCount += readNumber(quota.backoffCount);
    summary.backoffMs += readNumber(quota.backoffMs);
    summary.throttled = summary.throttled || quota.throttled === true;
    summary.headersSeen = summary.headersSeen || quota.headersSeen === true;
    summary.lastSeenAt = run.started_at ?? summary.lastSeenAt;

    quotaByProvider.set(provider, summary);
  }

  return {
    observedAt: new Date().toISOString(),
    providers: Array.from(quotaByProvider.values()).sort((left, right) =>
      left.provider.localeCompare(right.provider),
    ),
  };
}

function resolveAllEffectiveSettlements(settlements: SettlementRecord[]): EffectiveSettlement[] {
  const grouped = new Map<string, SettlementRecord[]>();
  for (const row of settlements) {
    const existing = grouped.get(row.pick_id);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.pick_id, [row]);
    }
  }

  const effective: EffectiveSettlement[] = [];
  for (const rows of grouped.values()) {
    const resolved = resolveEffectiveSettlement(rows.map(mapSettlementRecordToInput));
    if (resolved.ok) {
      effective.push(resolved.settlement);
    }
  }
  return effective;
}

function buildEffectiveSettlementResultMap(settlements: SettlementRecord[]) {
  const effective = new Map<string, string | null>();
  for (const s of resolveAllEffectiveSettlements(settlements)) {
    effective.set(s.pick_id, s.result);
  }
  return effective;
}

function mapSettlementRecordToInput(row: SettlementRecord): SettlementInput {
  return {
    id: row.id,
    pick_id: row.pick_id,
    status: row.status as SettlementInput['status'],
    result: row.result,
    confidence: row.confidence,
    corrects_id: row.corrects_id,
    settled_at: row.settled_at,
  };
}

function outboxRowsToChannelId(
  target: 'discord:canary' | 'discord:best-bets' | 'discord:trader-insights',
) {
  if (target === 'discord:canary') {
    return 'discord:1296531122234327100';
  }
  if (target === 'discord:best-bets') {
    return 'discord:1288613037539852329';
  }
  return 'discord:1356613995175481405';
}

function inferWorkerStatus(
  mostRecentRun: SystemRunRecord | undefined,
  counts: OperatorSnapshot['counts'],
  allRuns: SystemRunRecord[] = [],
  staleHeartbeatThresholdSeconds: number = 120,
): OperatorHealthSignal {
  // Check for unresolved open circuit breaker runs — these indicate a target is paused
  const openCircuitRuns = allRuns.filter(
    (row) => row.run_type === 'worker.circuit-open' && row.status === 'running',
  );
  if (openCircuitRuns.length > 0) {
    const targets = openCircuitRuns
      .map((row) => {
        const details = row.details as Record<string, unknown> | null;
        return typeof details?.target === 'string' ? details.target : null;
      })
      .filter((t): t is string => t !== null);
    const targetList = targets.length > 0 ? targets.join(', ') : 'unknown';
    return {
      component: 'worker',
      status: 'degraded',
      detail: `circuit breaker open for target(s): ${targetList}`,
    };
  }

  // Check for stale heartbeat — detect silent worker failures
  const heartbeatRuns = allRuns.filter((row) => row.run_type === 'worker.heartbeat');
  if (heartbeatRuns.length > 0) {
    const latestHeartbeat = heartbeatRuns[0]!;
    const heartbeatAt = latestHeartbeat.finished_at ?? latestHeartbeat.started_at;
    const ageSeconds = (Date.now() - new Date(heartbeatAt).getTime()) / 1000;
    if (ageSeconds > staleHeartbeatThresholdSeconds) {
      return {
        component: 'worker',
        status: 'degraded',
        detail: `worker heartbeat is stale (last seen ${Math.floor(ageSeconds)}s ago, threshold ${staleHeartbeatThresholdSeconds}s)`,
      };
    }
  }

  if (!mostRecentRun) {
    return {
      component: 'worker',
      status: 'degraded',
      detail: 'no system runs recorded yet',
    };
  }

  if (mostRecentRun.status === 'failed') {
    return {
      component: 'worker',
      status: 'down',
      detail: `most recent run failed (${mostRecentRun.run_type})`,
    };
  }

  if (mostRecentRun.status === 'cancelled') {
    return {
      component: 'worker',
      status: 'degraded',
      detail: `most recent run cancelled (${mostRecentRun.run_type})`,
    };
  }

  if (counts.pendingOutbox > 0 && mostRecentRun.status !== 'running') {
    return {
      component: 'worker',
      status: 'degraded',
      detail: `${counts.pendingOutbox} pending outbox item(s) waiting for worker`,
    };
  }

  return {
    component: 'worker',
    status: 'healthy',
    detail: `latest run ${mostRecentRun.run_type} is ${mostRecentRun.status}`,
  };
}

export interface StatsRow {
  settlement: EffectiveSettlement;
  rawSettlement: SettlementRecord;
  pick: PickRecord;
  submission: SubmissionRecord | null;
}

export function createStatsRows(input: {
  settlements: SettlementRecord[];
  picks: PickRecord[];
  submissions: SubmissionRecord[];
}): StatsRow[] {
  const pickById = new Map(input.picks.map((pick) => [pick.id, pick] as const));
  const submissionById = new Map(
    input.submissions.map((submission) => [submission.id, submission] as const),
  );
  const grouped = new Map<string, SettlementRecord[]>();

  for (const settlement of input.settlements) {
    const existing = grouped.get(settlement.pick_id);
    if (existing) {
      existing.push(settlement);
    } else {
      grouped.set(settlement.pick_id, [settlement]);
    }
  }

  const rows: StatsRow[] = [];
  for (const [pickId, records] of grouped.entries()) {
    const effective = resolveEffectiveSettlement(records.map(mapSettlementRecordToInput));
    if (!effective.ok || effective.settlement.status !== 'settled') {
      continue;
    }

    const pick = pickById.get(pickId);
    if (!pick) {
      continue;
    }

    const submission =
      pick.submission_id !== null ? submissionById.get(pick.submission_id) ?? null : null;

    rows.push({
      settlement: effective.settlement,
      rawSettlement:
        records.find((record) => record.id === effective.settlement.effective_record_id) ??
        records[records.length - 1]!,
      pick,
      submission,
    });
  }

  return rows;
}

export function buildCapperStatsResponse(
  query: OperatorStatsQuery,
  rows: StatsRow[],
): CapperStatsResponse {
  const filtered = rows.filter((row) => {
    if (query.capper && !matchesCapperName(row.submission?.submitted_by, query.capper)) {
      return false;
    }

    if (query.sport && !matchesSport(row.pick, query.sport)) {
      return false;
    }

    return isSettledResult(row.settlement.result);
  });

  if (filtered.length === 0) {
    return createEmptyStatsResponse(query);
  }

  const settledRows = [...filtered].sort((left, right) =>
    left.settlement.settled_at.localeCompare(right.settlement.settled_at),
  );

  const wins = settledRows.filter((row) => row.settlement.result === 'win').length;
  const losses = settledRows.filter((row) => row.settlement.result === 'loss').length;
  const pushes = settledRows.filter((row) => row.settlement.result === 'push').length;
  const decidedPicks = wins + losses;

  const clvValues = settledRows
    .map((row) => readNumericPayloadValue(findSettlementRecordPayload(row, 'clvRaw')))
    .filter((value): value is number => value !== null);

  const beatsLineCount = settledRows.filter((row) =>
    readBooleanPayloadValue(findSettlementRecordPayload(row, 'beatsClosingLine')),
  ).length;

  return {
    scope: query.capper ? 'capper' : 'server',
    capper:
      query.capper ??
      settledRows.find((row) => row.submission?.submitted_by)?.submission?.submitted_by ??
      null,
    window: query.window,
    sport: query.sport ?? null,
    picks: settledRows.length,
    wins,
    losses,
    pushes,
    winRate: decidedPicks > 0 ? roundTo4(wins / decidedPicks) : null,
    roiPct: decidedPicks > 0 ? roundTo2(((wins - losses) / decidedPicks) * 100) : null,
    avgClvPct:
      clvValues.length > 0
        ? roundTo2(clvValues.reduce((sum, value) => sum + value, 0) / clvValues.length)
        : null,
    beatsLine: clvValues.length > 0 ? roundTo4(beatsLineCount / clvValues.length) : null,
    picksWithClv: clvValues.length,
    lastFive: settledRows.slice(-5).map((row) => mapResultToLastFiveToken(row.settlement.result)),
  };
}

export function createEmptyStatsResponse(query: OperatorStatsQuery): CapperStatsResponse {
  return {
    scope: query.capper ? 'capper' : 'server',
    capper: query.capper ?? null,
    window: query.window,
    sport: query.sport ?? null,
    picks: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    winRate: null,
    roiPct: null,
    avgClvPct: null,
    beatsLine: null,
    picksWithClv: 0,
    lastFive: [],
  };
}

export function buildCapperRecapResponse(
  query: OperatorCapperRecapQuery,
  rows: StatsRow[],
): CapperRecapResponse {
  const filtered: Array<StatsRow & { settlement: EffectiveSettlement & { result: 'win' | 'loss' | 'push' } }> = rows
    .filter((row) => {
      if (!matchesCapperName(row.submission?.submitted_by, query.submittedBy)) {
        return false;
      }

      return isSettledResult(row.settlement.result);
    }) as Array<StatsRow & { settlement: EffectiveSettlement & { result: 'win' | 'loss' | 'push' } }>
    ;

  const limited = filtered
    .sort((left, right) => right.settlement.settled_at.localeCompare(left.settlement.settled_at))
    .slice(0, query.limit);

  if (limited.length === 0) {
    return createEmptyCapperRecapResponse(query);
  }

  return {
    submittedBy: query.submittedBy,
    picks: limited.map((row) => ({
      market: row.pick.market,
      selection: row.pick.selection,
      result: row.settlement.result,
      profitLossUnits: computeProfitLossUnits(row),
      clvPercent: readNumericPayloadValue(findSettlementRecordPayload(row, 'clvPercent')),
      stakeUnits:
        typeof row.pick.stake_units === 'number' && Number.isFinite(row.pick.stake_units)
          ? row.pick.stake_units
          : null,
      settledAt: row.settlement.settled_at,
    })),
  };
}

export function createEmptyCapperRecapResponse(
  query: OperatorCapperRecapQuery,
): CapperRecapResponse {
  return {
    submittedBy: query.submittedBy,
    picks: [],
  };
}

export function buildLeaderboardResponse(
  query: OperatorLeaderboardQuery,
  rows: StatsRow[],
): LeaderboardResponse {
  const filtered = rows.filter((row) => {
    if (!isSettledResult(row.settlement.result)) {
      return false;
    }

    if (query.sport && !matchesSport(row.pick, query.sport)) {
      return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    return createEmptyLeaderboardResponse(query);
  }

  const grouped = new Map<
    string,
    {
      capper: string;
      rows: StatsRow[];
    }
  >();

  for (const row of filtered) {
    const capper = normalizeCapperDisplayName(row.submission?.submitted_by);
    const key = capper.toLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      grouped.set(key, { capper, rows: [row] });
    }
  }

  const entries = [...grouped.values()]
    .map(({ capper, rows: capperRows }) => {
      const settledRows = [...capperRows].sort((left, right) =>
        left.settlement.settled_at.localeCompare(right.settlement.settled_at),
      );
      const wins = settledRows.filter((row) => row.settlement.result === 'win').length;
      const losses = settledRows.filter((row) => row.settlement.result === 'loss').length;
      const pushes = settledRows.filter((row) => row.settlement.result === 'push').length;
      const decidedPicks = wins + losses;
      const clvValues = settledRows
        .map((row) => readNumericPayloadValue(findSettlementRecordPayload(row, 'clvRaw')))
        .filter((value): value is number => value !== null);

      return {
        rank: 0,
        capper,
        picks: settledRows.length,
        wins,
        losses,
        pushes,
        winRate: decidedPicks > 0 ? roundTo4(wins / decidedPicks) : null,
        roiPct: decidedPicks > 0 ? roundTo2(((wins - losses) / decidedPicks) * 100) : null,
        avgClvPct:
          clvValues.length > 0
            ? roundTo2(clvValues.reduce((sum, value) => sum + value, 0) / clvValues.length)
            : null,
        streak: computeStreak(settledRows),
      } satisfies LeaderboardEntry;
    })
    .filter((entry) => entry.picks >= query.minPicks)
    .sort((left, right) => {
      const byWinRate = compareNullableDescending(left.winRate, right.winRate);
      if (byWinRate !== 0) {
        return byWinRate;
      }

      const byRoi = compareNullableDescending(left.roiPct, right.roiPct);
      if (byRoi !== 0) {
        return byRoi;
      }

      return left.capper.localeCompare(right.capper);
    })
    .slice(0, query.limit)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  return {
    window: query.window,
    sport: query.sport ?? null,
    minPicks: query.minPicks,
    entries,
    observedAt: new Date().toISOString(),
  };
}

export function createEmptyLeaderboardResponse(
  query: OperatorLeaderboardQuery,
): LeaderboardResponse {
  return {
    window: query.window,
    sport: query.sport ?? null,
    minPicks: query.minPicks,
    entries: [],
    observedAt: new Date().toISOString(),
  };
}
function createEmptyEntityHealth(): OperatorEntityHealth {
  return {
    resolvedEventsCount: 0,
    upcomingEventsCount: 0,
    resolvedPlayersCount: 0,
    resolvedTeamsWithExternalIdCount: 0,
    totalTeamsCount: 0,
    observedAt: new Date().toISOString(),
  };
}

export function readOperatorRuntimeMode(
  environment?: Pick<AppEnv, 'UNIT_TALK_APP_ENV' | 'UNIT_TALK_OPERATOR_RUNTIME_MODE'>,
): OperatorRuntimeMode {
  const configured =
    environment?.UNIT_TALK_OPERATOR_RUNTIME_MODE ??
    process.env.UNIT_TALK_OPERATOR_RUNTIME_MODE;

  if (configured?.trim().toLowerCase() === 'fail_closed') {
    return 'fail_closed';
  }

  if (configured?.trim().toLowerCase() === 'fail_open') {
    return 'fail_open';
  }

  const appEnv =
    environment?.UNIT_TALK_APP_ENV ?? normalizeAppEnv(process.env.UNIT_TALK_APP_ENV);

  return appEnv === 'local' || appEnv === 'ci' ? 'fail_open' : 'fail_closed';
}

function handleOperatorProviderFailure(
  error: unknown,
  environment?: AppEnv,
): OperatorSnapshotProvider {
  if (readOperatorRuntimeMode(environment) === 'fail_closed') {
    throw new Error(
      'operator-web runtime mode is fail_closed and snapshot provider configuration could not be loaded.',
      { cause: error },
    );
  }

  return {
    async getSnapshot(_filter?: OutboxFilter) {
      return createSnapshotFromRows({
        persistenceMode: 'demo',
        recentOutbox: [],
        recentReceipts: [],
        recentSettlements: [],
        recentRuns: [],
        recentPicks: [],
        recentAudit: [],
        entityHealth: createEmptyEntityHealth(),
        upcomingEvents: [],
      });
    },
    async getParticipants(_filter?: OperatorParticipantsFilter) {
      return { participants: [], total: 0, observedAt: new Date().toISOString() };
    },
  };
}

function normalizeAppEnv(value: string | undefined): AppEnv['UNIT_TALK_APP_ENV'] {
  if (value === 'ci' || value === 'staging' || value === 'production') {
    return value;
  }

  return 'local';
}

async function loadEventParticipants(
  client: ReturnType<typeof createDatabaseClientFromConnection>,
  eventIds: string[],
) {
  const { data, error } = await client
    .from('event_participants')
    .select('event_id,participant_id,role')
    .in('event_id', eventIds);

  if (error) {
    throw error;
  }

  return (data ?? []) as Array<{ event_id: string; participant_id: string; role: string }>;
}

async function loadParticipantsForEvents(
  client: ReturnType<typeof createDatabaseClientFromConnection>,
  eventParticipants: Array<{ event_id: string; participant_id: string; role: string }>,
) {
  const participantIds = [...new Set(eventParticipants.map((row) => row.participant_id))];
  const { data, error } = await client
    .from('participants')
    .select('id,display_name,participant_type')
    .in('id', participantIds);

  if (error) {
    throw error;
  }

  return (data ?? []) as Array<{ id: string; display_name: string; participant_type: string }>;
}

function mapUpcomingEvents(
  events: Array<{ id: string; event_name: string; event_date: string; sport_id: string }>,
  eventParticipants: Array<{ event_id: string; participant_id: string; role: string }>,
  participants: Array<{ id: string; display_name: string; participant_type: string }>,
): OperatorUpcomingEventSummary[] {
  const participantById = new Map(participants.map((row) => [row.id, row] as const));

  return events.map((event) => {
    const related = eventParticipants.filter((row) => row.event_id === event.id);
    const teams = related
      .filter((row) => row.role.includes('team'))
      .map((row) => participantById.get(row.participant_id)?.display_name ?? null)
      .filter((value): value is string => value !== null);
    const playerCount = related.filter((row) => {
      const participant = participantById.get(row.participant_id);
      return participant?.participant_type === 'player';
    }).length;

    return {
      id: event.id,
      eventName: event.event_name,
      eventDate: event.event_date,
      sport: event.sport_id,
      teams,
      playerCount,
    };
  });
}
function createStatsSinceIso(window: StatsWindowDays) {
  return new Date(Date.now() - window * 24 * 60 * 60 * 1000).toISOString();
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function matchesStatsWindow(row: StatsRow, sinceIso: string) {
  return row.settlement.settled_at >= sinceIso;
}

function matchesCapperName(submittedBy: string | null | undefined, requestedCapper: string) {
  return (submittedBy ?? '').trim().toLowerCase() === requestedCapper.trim().toLowerCase();
}

function computeProfitLossUnits(row: StatsRow) {
  const stakeUnits =
    typeof row.pick.stake_units === 'number' && Number.isFinite(row.pick.stake_units)
      ? row.pick.stake_units
      : 0;
  if (row.settlement.result === 'win') {
    return stakeUnits;
  }
  if (row.settlement.result === 'loss') {
    return stakeUnits * -1;
  }
  return 0;
}

function normalizeCapperDisplayName(submittedBy: string | null | undefined) {
  const trimmed = (submittedBy ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Unknown';
}

function matchesSport(pick: PickRecord, requestedSport: string) {
  const metadata = readJsonObject(pick.metadata);
  const sport = metadata?.['sport'];
  return (
    typeof sport === 'string' &&
    sport.trim().toLowerCase() === requestedSport.trim().toLowerCase()
  );
}

function isSettledResult(result: string | null): result is 'win' | 'loss' | 'push' {
  return result === 'win' || result === 'loss' || result === 'push';
}

function mapResultToLastFiveToken(result: string | null): 'W' | 'L' | 'P' {
  if (result === 'win') return 'W';
  if (result === 'loss') return 'L';
  return 'P';
}

function findSettlementRecordPayload(row: StatsRow, key: string) {
  return readJsonObject(row.rawSettlement.payload)?.[key] ?? null;
}

function readNumericPayloadValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readBooleanPayloadValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.trim().toLowerCase() === 'true';
  }

  return false;
}

function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readNullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNullableString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function roundTo2(value: number) {
  return Number(value.toFixed(2));
}

function roundTo4(value: number) {
  return Number(value.toFixed(4));
}

function compareNullableDescending(left: number | null, right: number | null) {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right - left;
}

function computeStreak(rows: StatsRow[]) {
  const descending = [...rows].sort((left, right) =>
    right.settlement.settled_at.localeCompare(left.settlement.settled_at),
  );

  const firstResult = descending[0]?.settlement.result;
  if (firstResult !== 'win' && firstResult !== 'loss') {
    return 0;
  }

  let streak = 0;
  for (const row of descending) {
    if (row.settlement.result !== firstResult) {
      break;
    }

    streak += 1;
  }

  return firstResult === 'win' ? streak : -streak;
}