import { getDataClient, OUTBOX_HISTORY_CUTOFF } from './client.js';
import {
  resolveEffectiveSettlement,
  computeSettlementSummary,
  type EffectiveSettlement,
  type SettlementSummary,
} from '@unit-talk/domain';
import { memberTiers, resolveTargetRegistry, type MemberTier } from '@unit-talk/contracts';
import type {
  OutboxRecord,
  ReceiptRecord,
  SystemRunRecord,
  PickRecord,
  SettlementRecord,
  AuditLogRow,
} from '@unit-talk/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export interface OutboxFilter {
  status?: string;
  target?: string;
  since?: string;
  lifecycleState?: string;
  limit?: number;
}

// ─────────────────────────────────────────────────────────────
// Internal helpers (ported from operator-web/src/server.ts)
// ─────────────────────────────────────────────────────────────

function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { return null; }
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

type SettlementInput = Parameters<typeof resolveEffectiveSettlement>[0][0];

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

function resolveAllEffectiveSettlements(settlements: SettlementRecord[]): EffectiveSettlement[] {
  const grouped = new Map<string, SettlementRecord[]>();
  for (const row of settlements) {
    const existing = grouped.get(row.pick_id);
    if (existing) { existing.push(row); } else { grouped.set(row.pick_id, [row]); }
  }
  const effective: EffectiveSettlement[] = [];
  for (const rows of grouped.values()) {
    const resolved = resolveEffectiveSettlement(rows.map(mapSettlementRecordToInput));
    if (resolved.ok) effective.push(resolved.settlement);
  }
  return effective;
}

function buildEffectiveSettlementResultMap(settlements: SettlementRecord[]) {
  const effective = new Map<string, string | null>();
  for (const s of resolveAllEffectiveSettlements(settlements)) effective.set(s.pick_id, s.result);
  return effective;
}

function outboxRowsToChannelId(target: 'discord:canary' | 'discord:best-bets' | 'discord:trader-insights') {
  if (target === 'discord:canary') return 'discord:1296531122234327100';
  if (target === 'discord:best-bets') return 'discord:1288613037539852329';
  return 'discord:1356613995175481405';
}

interface ChannelHealthSummary {
  target: string;
  recentSentCount: number;
  recentFailureCount: number;
  recentDeadLetterCount: number;
  latestSentAt: string | null;
  latestReceiptRecordedAt: string | null;
  latestMessageId: string | null;
  activationHealthy: boolean;
  blockers: string[];
  circuitBreaker: { status: 'open' | 'closed' };
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
  const targetReceipts = receiptRows.filter((row) =>
    row.receipt_type === 'discord.message' &&
    (row.channel === target || row.channel === channelId || (row.outbox_id !== null && relatedOutboxIds.has(row.outbox_id))),
  );
  const blockers: string[] = [];
  if (sentRows.length < 1) blockers.push(`no recent sent ${target} deliveries are visible`);
  if (failedRows.length > 0) blockers.push(`${failedRows.length} failed ${target} outbox item(s) still visible`);
  if (deadLetterRows.length > 0) blockers.push(`${deadLetterRows.length} dead-letter ${target} outbox item(s) still visible`);
  const circuitOpen = failedRows.length >= 3 && sentRows.length === 0;
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
    circuitBreaker: { status: circuitOpen ? 'open' : 'closed' },
  };
}

function summarizeCanaryLane(outboxRows: OutboxRecord[], receiptRows: ReceiptRecord[]) {
  const summary = summarizeChannelLane('discord:canary', outboxRowsToChannelId('discord:canary'), outboxRows, receiptRows);
  const blockers = [...summary.blockers];
  if (summary.recentSentCount < 3) blockers.unshift('fewer than 3 recent sent canary deliveries are visible');
  return { ...summary, target: 'discord:canary' as const, graduationReady: blockers.length === 0, blockers };
}

interface WorkerRuntimeSummary {
  drainState: 'idle' | 'draining' | 'stalled' | 'blocked';
  detail: string;
  latestDistributionRunStatus: string | null;
  latestDistributionRunAt: string | null;
  latestSuccessfulDistributionRunAt: string | null;
  latestReceiptRecordedAt: string | null;
  latestSentOutboxAt: string | null;
}

function summarizeWorkerRuntime(recentRuns: SystemRunRecord[], recentOutbox: OutboxRecord[], recentReceipts: ReceiptRecord[]): WorkerRuntimeSummary {
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
    return { drainState: 'blocked', detail: failedCount > 0 && deadLetterCount > 0 ? `${failedCount} failed and ${deadLetterCount} dead-letter outbox item(s) are blocking clean drain` : failedCount > 0 ? `${failedCount} failed outbox item(s) are blocking clean drain` : `${deadLetterCount} dead-letter outbox item(s) are blocking clean drain`, ...base };
  }
  if (pendingCount === 0 && processingCount === 0) return { drainState: 'idle', detail: 'no pending or processing outbox items are visible', ...base };
  if (processingCount > 0 || latestDistributionRun?.status === 'running') return { drainState: 'draining', detail: processingCount > 0 ? `${processingCount} outbox item(s) are actively processing` : `${pendingCount} pending outbox item(s) are visible while the worker is running`, ...base };
  return { drainState: 'stalled', detail: pendingCount > 0 ? `${pendingCount} pending outbox item(s) are queued without an active worker run` : 'worker runtime is not actively draining visible outbox items', ...base };
}

interface QuotaProviderSummary {
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

function summarizeQuotaFromRuns(recentRuns: SystemRunRecord[]): { observedAt: string; providers: QuotaProviderSummary[] } {
  const quotaByProvider = new Map<string, QuotaProviderSummary>();
  for (const run of recentRuns) {
    const details = readJsonObject(run.details);
    const quota = details ? readJsonObject(details['quota']) : null;
    if (!quota) continue;
    const provider = typeof quota['provider'] === 'string' ? quota['provider'] : null;
    if (!provider) continue;
    const summary = quotaByProvider.get(provider) ?? { provider, runCount: 0, requestCount: 0, successfulRequests: 0, creditsUsed: 0, limit: null, remaining: null, resetAt: null, lastStatus: null, rateLimitHitCount: 0, backoffCount: 0, backoffMs: 0, throttled: false, headersSeen: false, lastSeenAt: null };
    summary.runCount += 1;
    summary.requestCount += readNumber(quota['requestCount']);
    summary.successfulRequests += readNumber(quota['successfulRequests']);
    summary.creditsUsed += readNumber(quota['creditsUsed']);
    summary.limit = readNullableNumber(quota['limit']) ?? summary.limit;
    summary.remaining = readNullableNumber(quota['remaining']) ?? summary.remaining;
    summary.resetAt = readNullableString(quota['resetAt']) ?? summary.resetAt;
    summary.lastStatus = readNullableNumber(quota['lastStatus']) ?? summary.lastStatus;
    summary.rateLimitHitCount += readNumber(quota['rateLimitHitCount']);
    summary.backoffCount += readNumber(quota['backoffCount']);
    summary.backoffMs += readNumber(quota['backoffMs']);
    summary.throttled = summary.throttled || quota['throttled'] === true;
    summary.headersSeen = summary.headersSeen || quota['headersSeen'] === true;
    summary.lastSeenAt = run.started_at ?? summary.lastSeenAt;
    quotaByProvider.set(provider, summary);
  }
  return { observedAt: new Date().toISOString(), providers: Array.from(quotaByProvider.values()).sort((a, b) => a.provider.localeCompare(b.provider)) };
}

interface PickPipelineRow {
  id: string;
  status: string;
  approvalStatus: string | null;
  promotionStatus: string | null;
  promotionTarget: string | null;
  promotionScore: number | null;
  settlementResult: string | null;
  createdAt: string;
  settledAt: string | null;
  selection: string | null;
  market: string | null;
  line: number | null;
  odds: number | null;
  source: string | null;
  stakeUnits: number | null;
  confidence: number | null;
  sportId: string | null;
  eventName: string | null;
  eventStartTime: string | null;
}

interface PicksPipelineSummary {
  counts: { validated: number; queued: number; posted: number; settled: number; total: number };
  recentPicks: PickPipelineRow[];
}

function summarizePicksPipeline(recentPicks: PickRecord[], recentSettlements: SettlementRecord[], counts?: PicksPipelineSummary['counts']): PicksPipelineSummary {
  const settlementByPickId = buildEffectiveSettlementResultMap(recentSettlements);
  const recentRows: PickPipelineRow[] = recentPicks.map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const eventName = typeof metadata['eventName'] === 'string' ? metadata['eventName'] : null;
    const eventStartTime = typeof metadata['eventTime'] === 'string' ? metadata['eventTime'] : typeof metadata['eventStartTime'] === 'string' ? metadata['eventStartTime'] : null;
    return {
      id: row.id, status: row.status, approvalStatus: row.approval_status, promotionStatus: row.promotion_status, promotionTarget: row.promotion_target,
      promotionScore: row.promotion_score, settlementResult: settlementByPickId.get(row.id) ?? null, createdAt: row.created_at, settledAt: row.settled_at,
      selection: row.selection, market: row.market, line: row.line, odds: row.odds, source: row.source, stakeUnits: row.stake_units,
      confidence: row.confidence, sportId: row.sport_id, eventName, eventStartTime,
    };
  });
  const derivedCounts = counts ?? {
    validated: recentPicks.filter((row) => row.status === 'validated').length,
    queued: recentPicks.filter((row) => row.status === 'queued').length,
    posted: recentPicks.filter((row) => row.status === 'posted').length,
    settled: recentPicks.filter((row) => row.status === 'settled').length,
    total: recentPicks.length,
  };
  return {
    counts: { ...derivedCounts, total: counts?.total ?? derivedCounts.validated + derivedCounts.queued + derivedCounts.posted + derivedCounts.settled },
    recentPicks: recentRows,
  };
}

function findLatestWorkerRun(runs: SystemRunRecord[]): SystemRunRecord | null {
  const workerRuns = runs.filter((row) => row.run_type === 'distribution.process' || row.run_type === 'worker.heartbeat');
  if (workerRuns.length === 0) return null;
  return [...workerRuns].sort((a, b) => (b.finished_at ?? b.started_at).localeCompare(a.finished_at ?? a.started_at))[0] ?? null;
}

interface HealthSignal {
  component: 'api' | 'worker' | 'distribution' | 'ingestor' | 'grading' | 'alert-agent';
  status: 'healthy' | 'degraded' | 'down';
  detail: string;
}

function inferWorkerStatus(counts: { pendingOutbox: number }, allRuns: SystemRunRecord[] = []): HealthSignal {
  const openCircuitRuns = allRuns.filter((row) => row.run_type === 'worker.circuit-open' && row.status === 'running');
  if (openCircuitRuns.length > 0) {
    const targets = openCircuitRuns.map((row) => { const d = row.details as Record<string, unknown> | null; return typeof d?.['target'] === 'string' ? d['target'] : null; }).filter((t): t is string => t !== null);
    return { component: 'worker', status: 'degraded', detail: `circuit breaker open for target(s): ${targets.length > 0 ? targets.join(', ') : 'unknown'}` };
  }
  const heartbeatRuns = allRuns.filter((row) => row.run_type === 'worker.heartbeat');
  if (heartbeatRuns.length > 0) {
    const latest = heartbeatRuns[0]!;
    const heartbeatAt = latest.finished_at ?? latest.started_at;
    const ageSeconds = (Date.now() - new Date(heartbeatAt).getTime()) / 1000;
    if (ageSeconds > 120) return { component: 'worker', status: 'degraded', detail: `worker heartbeat is stale (last seen ${Math.floor(ageSeconds)}s ago, threshold 120s)` };
  }
  const mostRecentRun = findLatestWorkerRun(allRuns);
  if (!mostRecentRun) return { component: 'worker', status: 'degraded', detail: 'no worker activity recorded yet' };
  if (mostRecentRun.status === 'failed') return { component: 'worker', status: 'down', detail: `most recent run failed (${mostRecentRun.run_type})` };
  if (mostRecentRun.status === 'cancelled') return { component: 'worker', status: 'degraded', detail: `most recent run cancelled (${mostRecentRun.run_type})` };
  if (counts.pendingOutbox > 0 && mostRecentRun.status !== 'running') return { component: 'worker', status: 'degraded', detail: `${counts.pendingOutbox} pending outbox item(s) waiting for worker` };
  return { component: 'worker', status: 'healthy', detail: `latest run ${mostRecentRun.run_type} is ${mostRecentRun.status}` };
}

function computeMemberTierCounts(rows: Array<{ tier: string }>): { counts: Record<MemberTier, number>; observedAt: string } {
  const empty = Object.fromEntries(memberTiers.map((t) => [t, 0])) as Record<MemberTier, number>;
  for (const row of rows) {
    if (row.tier in empty) (empty as Record<string, number>)[row.tier]! += 1;
  }
  return { counts: empty, observedAt: new Date().toISOString() };
}

function summarizeAlertAgentRuns(recentRuns: SystemRunRecord[]) {
  const detectionRuns = recentRuns.filter((row) => row.run_type === 'alert.detection');
  const notificationRuns = recentRuns.filter((row) => row.run_type === 'alert.notification');
  const lastDetectionRun = detectionRuns[0];
  const lastNotificationRun = notificationRuns[0];
  let lastDetectionDetails = null as { signalsFound: number; alertWorthy: number; notable: number; watch: number } | null;
  if (lastDetectionRun) {
    const d = readJsonObject(lastDetectionRun.details);
    if (d) lastDetectionDetails = { signalsFound: typeof d['signalsFound'] === 'number' ? d['signalsFound'] : 0, alertWorthy: typeof d['alertWorthy'] === 'number' ? d['alertWorthy'] : 0, notable: typeof d['notable'] === 'number' ? d['notable'] : 0, watch: typeof d['watch'] === 'number' ? d['watch'] : 0 };
  }
  let lastNotificationDetails = null as { notified: number; suppressed: number } | null;
  if (lastNotificationRun) {
    const d = readJsonObject(lastNotificationRun.details);
    if (d) lastNotificationDetails = { notified: typeof d['notified'] === 'number' ? d['notified'] : 0, suppressed: typeof d['suppressed'] === 'number' ? d['suppressed'] : 0 };
  }
  return { lastDetectionRunAt: lastDetectionRun?.started_at ?? null, lastDetectionStatus: lastDetectionRun?.status ?? null, lastDetectionDetails, lastNotificationRunAt: lastNotificationRun?.started_at ?? null, lastNotificationStatus: lastNotificationRun?.status ?? null, lastNotificationDetails };
}

function summarizeGradingAgent(recentRuns: SystemRunRecord[]) {
  const gradingRuns = recentRuns.filter((row) => row.run_type === 'grading.run');
  const recapRuns = recentRuns.filter((row) => row.run_type === 'recap.post');
  const latestGradingRun = gradingRuns[0];
  const latestRecapRun = recapRuns[0];
  const lastPicksGraded = latestGradingRun?.details != null && typeof (latestGradingRun.details as Record<string, unknown>)['picksGraded'] === 'number' ? ((latestGradingRun.details as Record<string, unknown>)['picksGraded'] as number) : null;
  const lastFailed = latestGradingRun?.details != null && typeof (latestGradingRun.details as Record<string, unknown>)['failed'] === 'number' ? ((latestGradingRun.details as Record<string, unknown>)['failed'] as number) : null;
  const lastRecapChannel = latestRecapRun?.details != null && typeof (latestRecapRun.details as Record<string, unknown>)['channel'] === 'string' ? ((latestRecapRun.details as Record<string, unknown>)['channel'] as string) : null;
  return { lastGradingRunAt: latestGradingRun?.started_at ?? null, lastGradingRunStatus: latestGradingRun?.status ?? null, lastPicksGraded, lastFailed, lastRecapPostAt: latestRecapRun?.started_at ?? null, lastRecapChannel, runCount: gradingRuns.length };
}

function computeBoardUtilization(recentPicks: PickRecord[], picksPipelineCounts?: PicksPipelineSummary['counts']) {
  const capPerSlate = parseInt(process.env['UNIT_TALK_BOARD_CAP_PER_SLATE'] ?? '', 10) || 5;
  const OPEN_STATUSES = new Set(['validated', 'queued', 'posted']);
  const currentOpenPicks = picksPipelineCounts
    ? picksPipelineCounts.validated + picksPipelineCounts.queued + picksPipelineCounts.posted
    : recentPicks.filter((p) => OPEN_STATUSES.has(p.status)).length;
  const utilizationPct = capPerSlate > 0 ? (currentOpenPicks / capPerSlate) * 100 : 0;
  const status: 'healthy' | 'warning' | 'saturated' = utilizationPct >= 100 ? 'saturated' : utilizationPct >= 80 ? 'warning' : 'healthy';
  return { capPerSlate, currentOpenPicks, utilizationPct, status };
}

async function loadEventParticipants(client: Client, eventIds: string[]) {
  const { data, error } = await client.from('event_participants').select('event_id,participant_id,role').in('event_id', eventIds);
  if (error) throw error;
  return (data ?? []) as Array<{ event_id: string; participant_id: string; role: string }>;
}

async function loadParticipantsForEvents(client: Client, eventParticipants: Array<{ event_id: string; participant_id: string; role: string }>) {
  const participantIds = [...new Set(eventParticipants.map((row) => row.participant_id))];
  const { data, error } = await client.from('participants').select('id,display_name,participant_type').in('id', participantIds);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; display_name: string; participant_type: string }>;
}

function mapUpcomingEvents(
  events: Array<{ id: string; event_name: string; event_date: string; sport_id: string }>,
  eventParticipants: Array<{ event_id: string; participant_id: string; role: string }>,
  participants: Array<{ id: string; display_name: string; participant_type: string }>,
) {
  const participantById = new Map(participants.map((row) => [row.id, row] as const));
  return events.map((event) => {
    const related = eventParticipants.filter((row) => row.event_id === event.id);
    const teams = related.filter((row) => row.role.includes('team')).map((row) => participantById.get(row.participant_id)?.display_name ?? null).filter((v): v is string => v !== null);
    const playerCount = related.filter((row) => participantById.get(row.participant_id)?.participant_type === 'player').length;
    return { id: event.id, eventName: event.event_name, eventDate: event.event_date, sport: event.sport_id, teams, playerCount };
  });
}

function buildRolloutConfig(recentReceipts: ReceiptRecord[]) {
  const registry = resolveTargetRegistry();
  const skipCounts = new Map<string, number>();
  for (const receipt of recentReceipts) {
    if (receipt.receipt_type === 'worker.rollout-skip' && typeof receipt.channel === 'string') {
      const count = skipCounts.get(receipt.channel) ?? 0;
      skipCounts.set(receipt.channel, count + 1);
    }
  }
  return registry.map((entry) => ({
    target: entry.target,
    enabled: entry.enabled,
    rolloutPct: entry.rolloutPct,
    ...(entry.sportFilter ? { sportFilter: entry.sportFilter } : {}),
    skippedCount: skipCounts.get(`rollout-skip:discord:${entry.target}`) ?? 0,
  }));
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export async function getSnapshotData(filter?: OutboxFilter): Promise<unknown> {
  const client: Client = getDataClient();

  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const requestedLimit = filter?.limit ?? 25;
  const fetchLimit = requestedLimit + 1;

  const [
    outboxResult, receiptsResult, settlementsResult, runsResult, picksResult, auditResult,
    validatedCountResult, queuedCountResult, postedCountResult, settledCountResult,
    resolvedEventsCountResult, upcomingEventsCountResult, resolvedPlayersCountResult,
    resolvedTeamsWithExternalIdCountResult, totalTeamsCountResult, upcomingEventsResult,
    memberTiersResult, latestProviderOfferResult,
  ] = await Promise.all([
    (() => {
      let q = client.from('distribution_outbox').select('*');
      if (filter?.status) q = q.eq('status', filter.status);
      if (filter?.target) q = q.eq('target', filter.target);
      const effectiveSince = filter?.since && filter.since > OUTBOX_HISTORY_CUTOFF ? filter.since : OUTBOX_HISTORY_CUTOFF;
      q = q.gte('created_at', effectiveSince);
      return q.order('created_at', { ascending: false }).limit(fetchLimit);
    })(),
    client.from('distribution_receipts').select('*').order('recorded_at', { ascending: false }).limit(fetchLimit),
    client.from('settlement_records').select('*').order('created_at', { ascending: false }).limit(fetchLimit),
    (() => {
      let q = client.from('system_runs').select('*');
      if (filter?.since) q = q.gte('created_at', filter.since);
      return q.order('created_at', { ascending: false }).limit(fetchLimit);
    })(),
    (() => {
      let q = client.from('picks').select('*');
      if (filter?.lifecycleState) q = q.eq('status', filter.lifecycleState);
      if (filter?.since) q = q.gte('created_at', filter.since);
      return q.order('created_at', { ascending: false }).limit(fetchLimit);
    })(),
    client.from('audit_log').select('*').order('created_at', { ascending: false }).limit(fetchLimit),
    client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'validated'),
    client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'posted'),
    client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'settled'),
    client.from('events').select('id', { count: 'exact', head: true }).not('external_id', 'is', null),
    client.from('events').select('id', { count: 'exact', head: true }).gte('event_date', today).lte('event_date', nextWeek),
    client.from('participants').select('id', { count: 'exact', head: true }).eq('participant_type', 'player'),
    client.from('participants').select('id', { count: 'exact', head: true }).eq('participant_type', 'team').not('external_id', 'is', null),
    client.from('participants').select('id', { count: 'exact', head: true }).eq('participant_type', 'team'),
    client.from('events').select('id,event_name,event_date,sport_id').gte('event_date', today).lte('event_date', nextWeek).order('event_date', { ascending: true }).limit(5),
    client.from('member_tiers').select('tier').is('effective_until', null),
    client.from('provider_offer_current').select('snapshot_at').order('snapshot_at', { ascending: false }).limit(1),
  ]);

  for (const result of [outboxResult, receiptsResult, settlementsResult, runsResult, picksResult, auditResult, validatedCountResult, queuedCountResult, postedCountResult, settledCountResult, resolvedEventsCountResult, upcomingEventsCountResult, resolvedPlayersCountResult, resolvedTeamsWithExternalIdCountResult, totalTeamsCountResult, upcomingEventsResult, latestProviderOfferResult]) {
    if (result.error) throw result.error;
  }

  const memberTierRows = memberTiersResult.error ? [] : (memberTiersResult.data ?? []) as Array<{ tier: string }>;
  const recentOutbox = (outboxResult.data ?? []) as OutboxRecord[];
  const recentReceipts = (receiptsResult.data ?? []) as ReceiptRecord[];
  const recentSettlements = (settlementsResult.data ?? []) as SettlementRecord[];
  const recentRuns = (runsResult.data ?? []) as SystemRunRecord[];
  const recentPicks = (picksResult.data ?? []) as PickRecord[];
  const recentAudit = (auditResult.data ?? []) as AuditLogRow[];
  const upcomingEventsRaw = (upcomingEventsResult.data ?? []) as Array<{ id: string; event_name: string; event_date: string; sport_id: string }>;

  const eventIds = upcomingEventsRaw.map((row) => row.id);
  const eventParticipants = eventIds.length > 0 ? await loadEventParticipants(client, eventIds) : [];
  const participants = eventParticipants.length > 0 ? await loadParticipantsForEvents(client, eventParticipants) : [];
  const upcomingEvents = mapUpcomingEvents(upcomingEventsRaw, eventParticipants, participants);

  const picksPipelineCounts = {
    validated: validatedCountResult.count ?? 0,
    queued: queuedCountResult.count ?? 0,
    posted: postedCountResult.count ?? 0,
    settled: settledCountResult.count ?? 0,
    total: (validatedCountResult.count ?? 0) + (queuedCountResult.count ?? 0) + (postedCountResult.count ?? 0) + (settledCountResult.count ?? 0),
  };

  const filteredOutbox = recentOutbox.filter((row) => row.created_at >= OUTBOX_HISTORY_CUTOFF);
  const pendingOutboxRows = filteredOutbox.filter((row) => row.status === 'pending');
  const pendingNowMs = Date.now();
  const pendingOutboxAgeMaxMinutes = pendingOutboxRows.length > 0
    ? Math.max(...pendingOutboxRows.map((row) => Math.floor((pendingNowMs - new Date(row.created_at).getTime()) / 60_000)))
    : null;

  const simulatedOutboxIds = new Set(recentReceipts.filter((row) => row.receipt_type === 'worker.simulation').map((row) => row.outbox_id).filter((id): id is string => id !== null));
  const simulatedDeliveries = recentReceipts.filter((row) => row.receipt_type === 'worker.simulation').length;

  const counts = {
    pendingOutbox: pendingOutboxRows.length,
    processingOutbox: filteredOutbox.filter((row) => row.status === 'processing').length,
    failedOutbox: filteredOutbox.filter((row) => row.status === 'failed').length,
    deadLetterOutbox: filteredOutbox.filter((row) => row.status === 'dead_letter').length,
    sentOutbox: filteredOutbox.filter((row) => row.status === 'sent' && !simulatedOutboxIds.has(row.id)).length,
    simulatedDeliveries,
    pendingOutboxAgeMaxMinutes,
  };

  const workerStatus = inferWorkerStatus(counts, recentRuns);
  const workerRuntime = summarizeWorkerRuntime(recentRuns, recentOutbox, recentReceipts);

  const ingestorRuns = recentRuns.filter((row) => row.run_type.startsWith('ingestor'));
  const latestIngestorRun = ingestorRuns[0];
  const ingestorHealth = { status: latestIngestorRun?.status ?? 'unknown', lastRunAt: latestIngestorRun?.started_at ?? null, runCount: ingestorRuns.length };
  const quotaSummary = summarizeQuotaFromRuns(ingestorRuns);

  const ingestorOfferStaleThresholdMinutes = parseInt(process.env['UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES'] ?? '', 10) || 30;
  const latestProviderOfferSnapshotAt = latestProviderOfferResult.data?.[0]?.snapshot_at ?? null;
  const nowMs = Date.now();
  const latestProviderOfferAgeMinutes = latestProviderOfferSnapshotAt ? Math.max(0, Math.floor((nowMs - new Date(latestProviderOfferSnapshotAt).getTime()) / 60_000)) : null;
  const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

  const ingestorStale = !ingestorHealth.lastRunAt || (nowMs - new Date(ingestorHealth.lastRunAt).getTime()) > STALE_THRESHOLD_MS;
  const providerOffersStale = latestProviderOfferAgeMinutes == null || latestProviderOfferAgeMinutes > ingestorOfferStaleThresholdMinutes;
  const gradingRuns = recentRuns.filter((r) => r.run_type === 'grading.run');
  const latestGradingAt = gradingRuns[0]?.started_at;
  const gradingStale = !latestGradingAt || (nowMs - new Date(latestGradingAt).getTime()) > STALE_THRESHOLD_MS;
  const alertRuns = recentRuns.filter((r) => r.run_type === 'alert.detection');
  const latestAlertAt = alertRuns[0]?.started_at;
  const alertStale = !latestAlertAt || (nowMs - new Date(latestAlertAt).getTime()) > STALE_THRESHOLD_MS;

  const distributionStatus: HealthSignal = counts.failedOutbox > 0 || counts.deadLetterOutbox > 0
    ? { component: 'distribution', status: 'degraded', detail: counts.failedOutbox > 0 && counts.deadLetterOutbox > 0 ? `${counts.failedOutbox} failed and ${counts.deadLetterOutbox} dead-letter outbox item(s) need attention` : counts.failedOutbox > 0 ? `${counts.failedOutbox} failed outbox item(s) need attention` : `${counts.deadLetterOutbox} dead-letter outbox item(s) need attention` }
    : { component: 'distribution', status: 'healthy', detail: counts.pendingOutbox > 0 ? `${counts.pendingOutbox} pending outbox item(s) queued` : 'no failed outbox items detected' };

  const healthSignals: HealthSignal[] = [
    { component: 'api', status: 'healthy', detail: `${recentPicks.length} recent pick record(s) available` },
    workerStatus,
    distributionStatus,
  ];

  if (ingestorStale) {
    healthSignals.push({ component: 'ingestor', status: 'degraded', detail: ingestorHealth.lastRunAt ? `Last ingestor run ${ingestorHealth.lastRunAt} — over 2h ago` : 'No ingestor runs detected — feed may be down' });
  }
  if (!ingestorStale && providerOffersStale) {
    healthSignals.push({ component: 'ingestor', status: 'degraded', detail: latestProviderOfferAgeMinutes == null ? 'No provider offer snapshots detected - feed may be down' : `Latest provider offer snapshot ${latestProviderOfferAgeMinutes}m ago exceeds ${ingestorOfferStaleThresholdMinutes}m threshold` });
  }
  if (gradingStale) {
    healthSignals.push({ component: 'grading', status: 'degraded', detail: latestGradingAt ? `Last grading run ${latestGradingAt} — over 2h ago` : 'No grading runs detected — picks may not be settling' });
  }
  if (alertStale) {
    healthSignals.push({ component: 'alert-agent', status: 'degraded', detail: latestAlertAt ? `Last alert detection ${latestAlertAt} — over 2h ago` : 'No alert detection runs — agent may not be running' });
  }

  const boardUtil = computeBoardUtilization(recentPicks, picksPipelineCounts);
  if (boardUtil.status !== 'healthy') {
    healthSignals.push({ component: 'distribution', status: 'degraded', detail: `Board utilization at ${boardUtil.utilizationPct.toFixed(0)}% (${boardUtil.currentOpenPicks}/${boardUtil.capPerSlate} cap)` });
  }

  const STALE_VALIDATED_MS = 24 * 60 * 60 * 1000;
  const STALE_POSTED_MS = 7 * 24 * 60 * 60 * 1000;
  const STALE_PROCESSING_MS = 10 * 60 * 1000;
  const validatedPicks = recentPicks.filter((p) => p.status === 'validated');
  const staleValidatedPicks = validatedPicks.filter((p) => nowMs - new Date(p.created_at).getTime() > STALE_VALIDATED_MS);
  const postedPicks = recentPicks.filter((p) => p.status === 'posted');
  const stalePostedPicks = postedPicks.filter((p) => nowMs - new Date(p.created_at).getTime() > STALE_POSTED_MS);
  const staleProcessingRows = filteredOutbox.filter((row) => row.status === 'processing' && row.claimed_at !== null && nowMs - new Date(row.claimed_at).getTime() > STALE_PROCESSING_MS);
  const oldestValidated = validatedPicks.map((p) => p.created_at).sort()[0] ?? null;
  const oldestPosted = postedPicks.map((p) => p.created_at).sort()[0] ?? null;

  const aging = { staleValidated: staleValidatedPicks.length, stalePosted: stalePostedPicks.length, staleProcessing: staleProcessingRows.length, oldestValidatedAge: oldestValidated, oldestPostedAge: oldestPosted };

  if (aging.staleValidated > 0 || aging.stalePosted > 0) {
    healthSignals.push({ component: 'api', status: 'degraded', detail: `${aging.staleValidated} stale validated + ${aging.stalePosted} stale posted picks need attention` });
  }
  if (aging.staleProcessing > 0) {
    healthSignals.push({ component: 'worker', status: 'degraded', detail: `${aging.staleProcessing} outbox row(s) stuck in processing > 10min` });
  }

  const picksPipeline = summarizePicksPipeline(recentPicks, recentSettlements, picksPipelineCounts);
  const recap: SettlementSummary = computeSettlementSummary(resolveAllEffectiveSettlements(recentSettlements));
  const memberTiersData = computeMemberTierCounts(memberTierRows);
  const targetRegistry = resolveTargetRegistry();
  const rolloutConfig = buildRolloutConfig(recentReceipts);
  const alertAgent = summarizeAlertAgentRuns(recentRuns);
  const gradingAgent = summarizeGradingAgent(recentRuns);
  const exposureGateRejections = recentPicks.filter((p) => typeof p.promotion_reason === 'string' && p.promotion_reason.startsWith('exposure-')).length;

  const bestBets = summarizeChannelLane('discord:best-bets', outboxRowsToChannelId('discord:best-bets'), recentOutbox, recentReceipts);
  const traderInsights = summarizeChannelLane('discord:trader-insights', outboxRowsToChannelId('discord:trader-insights'), recentOutbox, recentReceipts);
  const canary = summarizeCanaryLane(recentOutbox, recentReceipts);

  // Detect incidents
  const STUCK_OUTBOX_MS = 15 * 60 * 1000;
  const STALE_WORKER_MS = 10 * 60 * 1000;
  const incidents: Array<{ type: string; severity: string; summary: string; affectedCount: number }> = [];
  const stuckRows = recentOutbox.filter((row) => row.status === 'pending' && (nowMs - new Date(row.created_at).getTime()) > STUCK_OUTBOX_MS);
  if (stuckRows.length > 0) incidents.push({ type: 'stuck-outbox', severity: 'critical', summary: `${stuckRows.length} pending outbox row(s) have been stuck for more than 15 minutes`, affectedCount: stuckRows.length });
  if (stuckRows.length > 0) {
    const stalledSince = nowMs - STUCK_OUTBOX_MS;
    const recentReceiptExists = recentReceipts.some((row) => new Date(row.recorded_at).getTime() >= stalledSince);
    if (!recentReceiptExists) incidents.push({ type: 'delivery-stall', severity: 'critical', summary: `${stuckRows.length} pending outbox row(s) have been waiting more than 15 minutes with no recent delivery receipts — worker may be alive but not processing`, affectedCount: stuckRows.length });
  }
  const latestWorkerRun = findLatestWorkerRun(recentRuns);
  const isStaleWorker = !latestWorkerRun || (nowMs - new Date(latestWorkerRun.finished_at ?? latestWorkerRun.started_at).getTime()) > STALE_WORKER_MS;
  if (isStaleWorker) incidents.push({ type: 'stale-worker', severity: 'warning', summary: !latestWorkerRun ? 'No worker heartbeat or distribution runs are visible — worker may be offline' : `Most recent worker activity (${latestWorkerRun.run_type}) is older than 10 minutes`, affectedCount: 1 });
  const deadLetterRows = recentOutbox.filter((row) => row.status === 'dead_letter');
  if (deadLetterRows.length > 0) incidents.push({ type: 'open-dead-letter', severity: 'critical', summary: `${deadLetterRows.length} dead-letter outbox row(s) require manual intervention`, affectedCount: deadLetterRows.length });
  const openCircuits: string[] = [];
  if (bestBets.circuitBreaker.status === 'open') openCircuits.push(bestBets.target);
  if (traderInsights.circuitBreaker.status === 'open') openCircuits.push(traderInsights.target);
  if (openCircuits.length > 0) incidents.push({ type: 'circuit-open', severity: 'critical', summary: `Circuit breaker open for: ${openCircuits.join(', ')}`, affectedCount: openCircuits.length });

  // Build observability summary
  const failedRuns = recentRuns.filter((run) => run.status === 'failed' || run.status === 'cancelled').length;
  const staleWorkerActive = incidents.some((i) => i.type === 'stale-worker');
  const deliveryStallActive = incidents.some((i) => i.type === 'delivery-stall');
  const circuitOpenActive = incidents.some((i) => i.type === 'circuit-open');
  const staleIngestorActive = healthSignals.some((s) => s.component === 'ingestor' && s.status !== 'healthy');
  const latestDistributionRun = recentRuns.find((run) => run.run_type === 'distribution.process');
  const latestIngestorRunRecord = recentRuns.find((run) => run.run_type.startsWith('ingestor'));
  const latestWorkerHeartbeat = recentRuns.find((run) => run.run_type === 'worker.heartbeat');

  const observability = {
    stack: { logs: 'loki' as const, metrics: 'prometheus-json' as const, errors: 'structured-error-events' as const, dashboards: 'operator-web' as const },
    metrics: { failedRuns, failedOutbox: counts.failedOutbox, deadLetterOutbox: counts.deadLetterOutbox, activeIncidents: incidents.length, pendingOutboxAgeMaxMinutes: counts.pendingOutboxAgeMaxMinutes, latestDistributionRunAt: latestDistributionRun?.started_at ?? null, latestIngestorRunAt: latestIngestorRunRecord?.started_at ?? null, latestWorkerHeartbeatAt: latestWorkerHeartbeat?.started_at ?? null },
    alertConditions: [
      { id: 'failed-runs', severity: 'critical', active: failedRuns > 0, detail: `${failedRuns} failed or cancelled system run(s) in the current snapshot` },
      { id: 'dead-letter-outbox', severity: 'critical', active: counts.deadLetterOutbox > 0, detail: `${counts.deadLetterOutbox} dead-letter delivery row(s) require manual intervention` },
      { id: 'delivery-stall', severity: 'critical', active: deliveryStallActive, detail: deliveryStallActive ? 'Distribution has sent rows but receipts are stale or missing' : 'No delivery stall incident is active' },
      { id: 'stale-worker', severity: 'warning', active: staleWorkerActive, detail: staleWorkerActive ? 'Worker heartbeat or distribution activity is stale' : 'Worker heartbeat is within the accepted window' },
      { id: 'circuit-open', severity: 'warning', active: circuitOpenActive, detail: circuitOpenActive ? 'At least one delivery target circuit breaker is open' : 'No open delivery circuit breaker is visible' },
      { id: 'ingestor-stale', severity: 'warning', active: staleIngestorActive, detail: staleIngestorActive ? 'Ingestor freshness health is degraded' : 'Ingestor freshness health is acceptable' },
    ],
  };

  const simulationMode = simulatedDeliveries > 0 || process.env.UNIT_TALK_SIMULATION_MODE === 'true';

  return {
    ok: true,
    data: {
      observedAt: new Date().toISOString(),
      persistenceMode: 'database',
      simulationMode,
      health: healthSignals,
      counts,
      recentOutbox,
      recentReceipts,
      recentSettlements,
      recentRuns,
      recentPicks,
      recentAudit,
      workerRuntime,
      entityHealth: {
        resolvedEventsCount: resolvedEventsCountResult.count ?? 0,
        upcomingEventsCount: upcomingEventsCountResult.count ?? 0,
        resolvedPlayersCount: resolvedPlayersCountResult.count ?? 0,
        resolvedTeamsWithExternalIdCount: resolvedTeamsWithExternalIdCountResult.count ?? 0,
        totalTeamsCount: totalTeamsCountResult.count ?? 0,
        observedAt: new Date().toISOString(),
      },
      upcomingEvents,
      bestBets,
      traderInsights,
      canary,
      ingestorHealth,
      quotaSummary,
      picksPipeline,
      recap,
      memberTiers: memberTiersData,
      boardExposure: { bySport: {}, byGame: {} },
      alertAgent,
      gradingAgent,
      boardUtilization: boardUtil,
      targetRegistry,
      rolloutConfig,
      exposureGateRejections,
      incidents,
      observability,
      aging,
    },
  };
}

export async function getPicksPipelineData(filter?: OutboxFilter): Promise<unknown> {
  const client: Client = getDataClient();
  const fetchLimit = (filter?.limit ?? 25) + 1;

  const [
    validatedCountResult, queuedCountResult, postedCountResult, settledCountResult, picksResult, settlementsResult,
  ] = await Promise.all([
    client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'validated'),
    client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'posted'),
    client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'settled'),
    (() => {
      let q = client.from('picks').select('*');
      if (filter?.lifecycleState) q = q.eq('status', filter.lifecycleState);
      if (filter?.since) q = q.gte('created_at', filter.since);
      return q.order('created_at', { ascending: false }).limit(fetchLimit);
    })(),
    client.from('settlement_records').select('*').order('created_at', { ascending: false }).limit(fetchLimit),
  ]);

  const recentPicks = (picksResult.data ?? []) as PickRecord[];
  const recentSettlements = (settlementsResult.data ?? []) as SettlementRecord[];
  const picksPipelineCounts = {
    validated: validatedCountResult.count ?? 0,
    queued: queuedCountResult.count ?? 0,
    posted: postedCountResult.count ?? 0,
    settled: settledCountResult.count ?? 0,
    total: (validatedCountResult.count ?? 0) + (queuedCountResult.count ?? 0) + (postedCountResult.count ?? 0) + (settledCountResult.count ?? 0),
  };
  const pipeline = summarizePicksPipeline(recentPicks, recentSettlements, picksPipelineCounts);

  return { ok: true, data: { observedAt: new Date().toISOString(), counts: pipeline.counts, recentPicks: pipeline.recentPicks } };
}

export async function getRecapData(): Promise<{ ok: true; data: SettlementSummary }> {
  const client: Client = getDataClient();
  const { data, error } = await client.from('settlement_records').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  const settlements = (data ?? []) as SettlementRecord[];
  const recap = computeSettlementSummary(resolveAllEffectiveSettlements(settlements));
  return { ok: true, data: recap };
}
