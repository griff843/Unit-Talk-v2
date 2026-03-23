import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseClientFromConnection,
  type OutboxRecord,
  type ReceiptRecord,
  type SettlementRecord,
  type SystemRunRecord,
  type PickRecord,
  type AuditLogRow,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';
import {
  resolveEffectiveSettlement,
  computeSettlementSummary,
  type SettlementInput,
  type EffectiveSettlement,
  type SettlementSummary,
} from '@unit-talk/domain';

export interface OperatorHealthSignal {
  component: 'api' | 'worker' | 'distribution';
  status: 'healthy' | 'degraded' | 'down';
  detail: string;
}

export interface OperatorSnapshot {
  observedAt: string;
  persistenceMode: 'database' | 'demo';
  health: OperatorHealthSignal[];
  counts: {
    pendingOutbox: number;
    processingOutbox: number;
    failedOutbox: number;
    sentOutbox: number;
  };
  recentOutbox: OutboxRecord[];
  recentReceipts: ReceiptRecord[];
  recentSettlements: SettlementRecord[];
  recentRuns: SystemRunRecord[];
  recentPicks: PickRecord[];
  recentAudit: AuditLogRow[];
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
  picksPipeline: PicksPipelineSummary;
  recap: SettlementSummary;
}

export interface OutboxFilter {
  status?: string;
  target?: string;
  since?: string;
  lifecycleState?: string;
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
}

export interface OperatorServerOptions {
  provider?: OperatorSnapshotProvider;
}

export function createOperatorServer(options: OperatorServerOptions = {}) {
  const provider = options.provider ?? createOperatorSnapshotProvider();

  return http.createServer(async (request, response) => {
    await routeOperatorRequest(request, response, provider);
  });
}

export async function routeOperatorRequest(
  request: IncomingMessage,
  response: ServerResponse,
  provider: OperatorSnapshotProvider,
) {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (method === 'GET' && url.pathname === '/health') {
    const snapshot = await provider.getSnapshot();
    return writeJson(response, 200, {
      ok: true,
      service: 'operator-web',
      persistenceMode: snapshot.persistenceMode,
      observedAt: snapshot.observedAt,
      health: snapshot.health,
    });
  }

  if (method === 'GET' && url.pathname === '/api/operator/snapshot') {
    const outboxStatus = url.searchParams.get('outboxStatus');
    const target = url.searchParams.get('target');
    const since = url.searchParams.get('since');
    const lifecycleState = url.searchParams.get('lifecycleState');
    const filter: OutboxFilter | undefined =
      outboxStatus || target || since || lifecycleState
        ? {
            ...(outboxStatus !== null ? { status: outboxStatus } : {}),
            ...(target !== null ? { target } : {}),
            ...(since !== null ? { since } : {}),
            ...(lifecycleState !== null ? { lifecycleState } : {}),
          }
        : undefined;
    const snapshot = await provider.getSnapshot(filter);
    return writeJson(response, 200, { ok: true, data: snapshot });
  }

  if (method === 'GET' && url.pathname === '/api/operator/picks-pipeline') {
    const since = url.searchParams.get('since');
    const lifecycleState = url.searchParams.get('lifecycleState');
    const filter: OutboxFilter | undefined =
      since || lifecycleState
        ? {
            ...(since !== null ? { since } : {}),
            ...(lifecycleState !== null ? { lifecycleState } : {}),
          }
        : undefined;
    const snapshot = await provider.getSnapshot(filter);
    return writeJson(response, 200, {
      ok: true,
      data: {
        observedAt: snapshot.observedAt,
        counts: snapshot.picksPipeline.counts,
        recentPicks: snapshot.picksPipeline.recentPicks,
      },
    });
  }

  if (method === 'GET' && url.pathname === '/api/operator/recap') {
    const snapshot = await provider.getSnapshot();
    return writeJson(response, 200, { ok: true, data: snapshot.recap });
  }

  if (method === 'GET' && url.pathname === '/') {
    const snapshot = await provider.getSnapshot();
    return writeHtml(response, 200, renderOperatorDashboard(snapshot));
  }

  return writeJson(response, 404, {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${method} ${url.pathname}`,
    },
  });
}

export function createOperatorSnapshotProvider(): OperatorSnapshotProvider {
  try {
    const env = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    const client = createDatabaseClientFromConnection(connection);

    return {
      async getSnapshot(filter?: OutboxFilter) {
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
        ]) {
          if (result.error) {
            throw result.error;
          }
        }

        const recentOutbox = outboxResult.data ?? [];
        const recentReceipts = receiptsResult.data ?? [];
        const recentSettlements = settlementsResult.data ?? [];
        const recentRuns = runsResult.data ?? [];
        const recentPicks = picksResult.data ?? [];
        const recentAudit = auditResult.data ?? [];

        return createSnapshotFromRows({
          persistenceMode: 'database',
          recentOutbox,
          recentReceipts,
          recentSettlements,
          recentRuns,
          recentPicks,
          recentAudit,
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
        });
      },
    };
  } catch {
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
        });
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
  picksPipelineCounts?: PicksPipelineSummary['counts'];
}): OperatorSnapshot {
  const counts = {
    pendingOutbox: input.recentOutbox.filter((row) => row.status === 'pending').length,
    processingOutbox: input.recentOutbox.filter((row) => row.status === 'processing').length,
    failedOutbox: input.recentOutbox.filter((row) => row.status === 'failed').length,
    sentOutbox: input.recentOutbox.filter((row) => row.status === 'sent').length,
  };

  const mostRecentRun = input.recentRuns[0];
  const workerStatus = inferWorkerStatus(mostRecentRun, counts);
  const distributionStatus =
    counts.failedOutbox > 0
      ? {
          component: 'distribution' as const,
          status: 'degraded' as const,
          detail: `${counts.failedOutbox} failed outbox item(s) need attention`,
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
    bestBets: summarizeChannelLane('discord:best-bets', outboxRowsToChannelId('discord:best-bets'), input.recentOutbox, input.recentReceipts),
    traderInsights: summarizeChannelLane(
      'discord:trader-insights',
      outboxRowsToChannelId('discord:trader-insights'),
      input.recentOutbox,
      input.recentReceipts,
    ),
    canary: summarizeCanaryLane(input.recentOutbox, input.recentReceipts),
    picksPipeline: summarizePicksPipeline(
      input.recentPicks,
      input.recentSettlements ?? [],
      input.picksPipelineCounts,
    ),
    recap: computeSettlementSummary(resolveAllEffectiveSettlements(input.recentSettlements ?? [])),
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
): OperatorHealthSignal {
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

function renderOperatorDashboard(snapshot: OperatorSnapshot) {
  const degradedSignals = snapshot.health.filter(
    (s) => s.status === 'degraded' || s.status === 'down',
  );
  const incidentBanner =
    degradedSignals.length > 0
      ? `<div class="incident-banner"><strong>Incident detected</strong>: ${degradedSignals
          .map((s) => `${escapeHtml(s.component)}: ${escapeHtml(s.detail)}`)
          .join(' &bull; ')}</div>`
      : '';

  const healthCards = snapshot.health
    .map(
      (signal) => `
      <article class="card">
        <h2>${escapeHtml(signal.component)}</h2>
        <p class="badge badge-${signal.status}">${escapeHtml(signal.status)}</p>
        <p>${escapeHtml(signal.detail)}</p>
      </article>`,
    )
    .join('');

  const countCards = [
    ['pending outbox', snapshot.counts.pendingOutbox],
    ['processing outbox', snapshot.counts.processingOutbox],
    ['failed outbox', snapshot.counts.failedOutbox],
    ['sent outbox', snapshot.counts.sentOutbox],
  ]
    .map(
      ([label, value]) => `
      <article class="card stat">
        <h2>${escapeHtml(String(label))}</h2>
        <p class="stat-value">${escapeHtml(String(value))}</p>
      </article>`,
    )
    .join('');

  const failedOutbox = snapshot.recentOutbox.filter(
    (row) => row.status === 'failed' || row.status === 'dead_letter',
  );
  const degradedRuns = snapshot.recentRuns.filter(
    (row) => row.status === 'failed' || row.status === 'cancelled',
  );
  const incidentTriageSection =
    failedOutbox.length > 0 || degradedRuns.length > 0
      ? `<section class="incident-triage">
        <h2>Incident Triage</h2>
        ${failedOutbox.length > 0 ? `<h3>Failed / Dead-letter Outbox (${failedOutbox.length})</h3>
        <table>
          <thead><tr><th>ID</th><th>Target</th><th>Status</th><th>Worker</th><th>Updated</th></tr></thead>
          <tbody>${renderTriageOutboxRows(failedOutbox)}</tbody>
        </table>` : ''}
        ${degradedRuns.length > 0 ? `<h3>Failed / Cancelled Runs (${degradedRuns.length})</h3>
        <table>
          <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Actor</th><th>Created</th></tr></thead>
          <tbody>${renderTriageRunRows(degradedRuns)}</tbody>
        </table>` : ''}
      </section>`
      : '';
  const canaryBlockers =
    snapshot.canary.blockers.length > 0
      ? `<ul>${snapshot.canary.blockers
          .map((blocker) => `<li>${escapeHtml(blocker)}</li>`)
          .join('')}</ul>`
      : '<p>No canary blockers are visible in the current snapshot.</p>';
  const canaryReadinessSection = `<section>
        <h2>Canary Readiness</h2>
        <table>
          <thead><tr><th>Target</th><th>Recent Sent</th><th>Recent Failed</th><th>Dead-letter</th><th>Latest Receipt</th><th>Latest Message ID</th><th>Ready</th></tr></thead>
          <tbody><tr>
            <td><code>${escapeHtml(snapshot.canary.target)}</code></td>
            <td><code>${escapeHtml(String(snapshot.canary.recentSentCount))}</code></td>
            <td><code>${escapeHtml(String(snapshot.canary.recentFailureCount))}</code></td>
            <td><code>${escapeHtml(String(snapshot.canary.recentDeadLetterCount))}</code></td>
            <td><code>${escapeHtml(snapshot.canary.latestReceiptRecordedAt ?? 'n/a')}</code></td>
            <td><code>${escapeHtml(snapshot.canary.latestMessageId ?? 'n/a')}</code></td>
            <td><code>${escapeHtml(snapshot.canary.graduationReady ? 'yes' : 'no')}</code></td>
          </tr></tbody>
        </table>
        <div class="card" style="margin-top: 12px;">
          <h3>Graduation blockers</h3>
          ${canaryBlockers}
        </div>
      </section>`;
  const bestBetsBlockers =
    snapshot.bestBets.blockers.length > 0
      ? `<ul>${snapshot.bestBets.blockers
          .map((blocker) => `<li>${escapeHtml(blocker)}</li>`)
          .join('')}</ul>`
      : '<p>No Best Bets blockers are visible in the current snapshot.</p>';
  const bestBetsHealthSection = `<section>
        <h2>Best Bets Health</h2>
        <table>
          <thead><tr><th>Target</th><th>Recent Sent</th><th>Recent Failed</th><th>Dead-letter</th><th>Latest Receipt</th><th>Latest Message ID</th><th>Healthy</th></tr></thead>
          <tbody><tr>
            <td><code>${escapeHtml(snapshot.bestBets.target)}</code></td>
            <td><code>${escapeHtml(String(snapshot.bestBets.recentSentCount))}</code></td>
            <td><code>${escapeHtml(String(snapshot.bestBets.recentFailureCount))}</code></td>
            <td><code>${escapeHtml(String(snapshot.bestBets.recentDeadLetterCount))}</code></td>
            <td><code>${escapeHtml(snapshot.bestBets.latestReceiptRecordedAt ?? 'n/a')}</code></td>
            <td><code>${escapeHtml(snapshot.bestBets.latestMessageId ?? 'n/a')}</code></td>
            <td><code>${escapeHtml(snapshot.bestBets.activationHealthy ? 'yes' : 'no')}</code></td>
          </tr></tbody>
        </table>
        <div class="card" style="margin-top: 12px;">
          <h3>Activation blockers</h3>
          ${bestBetsBlockers}
        </div>
      </section>`;
  const traderInsightsBlockers =
    snapshot.traderInsights.blockers.length > 0
      ? `<ul>${snapshot.traderInsights.blockers
          .map((blocker) => `<li>${escapeHtml(blocker)}</li>`)
          .join('')}</ul>`
      : '<p>No Trader Insights blockers are visible in the current snapshot.</p>';
  const traderInsightsHealthSection = `<section>
        <h2>Trader Insights Health</h2>
        <table>
          <thead><tr><th>Target</th><th>Recent Sent</th><th>Recent Failed</th><th>Dead-letter</th><th>Latest Receipt</th><th>Latest Message ID</th><th>Healthy</th></tr></thead>
          <tbody><tr>
            <td><code>${escapeHtml(snapshot.traderInsights.target)}</code></td>
            <td><code>${escapeHtml(String(snapshot.traderInsights.recentSentCount))}</code></td>
            <td><code>${escapeHtml(String(snapshot.traderInsights.recentFailureCount))}</code></td>
            <td><code>${escapeHtml(String(snapshot.traderInsights.recentDeadLetterCount))}</code></td>
            <td><code>${escapeHtml(snapshot.traderInsights.latestReceiptRecordedAt ?? 'n/a')}</code></td>
            <td><code>${escapeHtml(snapshot.traderInsights.latestMessageId ?? 'n/a')}</code></td>
            <td><code>${escapeHtml(snapshot.traderInsights.activationHealthy ? 'yes' : 'no')}</code></td>
          </tr></tbody>
        </table>
        <div class="card" style="margin-top: 12px;">
          <h3>Activation blockers</h3>
          ${traderInsightsBlockers}
        </div>
      </section>`;
  const picksPipelineRows = renderTableRows(snapshot.picksPipeline.recentPicks, (row) => [
    row.id,
    row.status,
    row.approvalStatus,
    row.promotionStatus ?? 'n/a',
    row.promotionTarget ?? 'n/a',
    row.promotionScore !== null ? String(row.promotionScore) : 'n/a',
    row.settlementResult ?? 'n/a',
    row.createdAt,
  ], 8);
  const picksPipelineCountCards = [
    ['validated', snapshot.picksPipeline.counts.validated],
    ['queued', snapshot.picksPipeline.counts.queued],
    ['posted', snapshot.picksPipeline.counts.posted],
    ['settled', snapshot.picksPipeline.counts.settled],
    ['total picks', snapshot.picksPipeline.counts.total],
  ]
    .map(
      ([label, value]) => `
      <article class="card stat">
        <h2>${escapeHtml(String(label))}</h2>
        <p class="stat-value">${escapeHtml(String(value))}</p>
      </article>`,
    )
    .join('');
  const picksPipelineSection = `<section>
        <h2>Picks Pipeline</h2>
        <div class="grid count-grid">${picksPipelineCountCards}</div>
        <table>
          <thead><tr><th>ID</th><th>Status</th><th>Approval</th><th>Promotion</th><th>Target</th><th>Score</th><th>Settlement</th><th>Created</th></tr></thead>
          <tbody>${picksPipelineRows}</tbody>
        </table>
      </section>`;

  const recapCountCards = [
    ['total picks', snapshot.recap.total_picks],
    ['hit rate %', snapshot.recap.hit_rate_pct.toFixed(1)],
    ['flat-bet ROI %', snapshot.recap.flat_bet_roi.roi_pct.toFixed(1)],
    ['corrections', snapshot.recap.correction_count],
    ['pending review', snapshot.recap.pending_review_count],
  ]
    .map(
      ([label, value]) => `
      <article class="card stat">
        <h2>${escapeHtml(String(label))}</h2>
        <p class="stat-value">${escapeHtml(String(value))}</p>
      </article>`,
    )
    .join('');
  const recapResultRows = Object.entries(snapshot.recap.by_result)
    .map(([result, count]) => `<tr><td><code>${escapeHtml(result)}</code></td><td><code>${escapeHtml(String(count))}</code></td></tr>`)
    .join('') || `<tr><td colspan="2">No settled picks yet.</td></tr>`;
  const recapSection = `<section>
        <h2>Settlement Recap</h2>
        <div class="grid count-grid">${recapCountCards}</div>
        <table>
          <thead><tr><th>Result</th><th>Count</th></tr></thead>
          <tbody>${recapResultRows}</tbody>
        </table>
      </section>`;

  const outboxRows = renderTableRows(snapshot.recentOutbox, (row) => [
    row.id,
    row.target,
    row.status,
    row.claimed_by ?? 'unclaimed',
    row.updated_at,
  ]);
  const receiptRows = renderTableRows(snapshot.recentReceipts, (row) => [
    row.id,
    row.channel ?? 'n/a',
    row.status,
    row.external_id ?? 'n/a',
    row.recorded_at,
  ]);
  const runRows = renderTableRows(snapshot.recentRuns, (row) => [
    row.id,
    row.run_type,
    row.status,
    row.actor ?? 'system',
    row.created_at,
  ]);
  const settlementRows = renderTableRows(snapshot.recentSettlements, (row) => [
    row.id,
    row.pick_id,
    formatSettlementStatusLabel(row),
    row.result ?? 'n/a',
    row.source,
    row.corrects_id ?? 'n/a',
    row.evidence_ref ?? 'n/a',
    row.settled_at,
  ], 8);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unit Talk V2 Operator</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: #fffdf8;
        --ink: #1f2933;
        --muted: #6b7280;
        --line: #d8d0c2;
        --ok: #1f7a4d;
        --warn: #a76500;
        --down: #b42318;
        --accent: #0f4c81;
      }
      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        background: radial-gradient(circle at top, #fff8ea 0%, var(--bg) 52%, #e8e0d4 100%);
        color: var(--ink);
      }
      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 2rem;
      }
      .lede {
        color: var(--muted);
        margin-bottom: 24px;
      }
      .grid {
        display: grid;
        gap: 16px;
      }
      .health-grid, .count-grid {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin-bottom: 24px;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 16px;
        box-shadow: 0 10px 30px rgba(31, 41, 51, 0.06);
      }
      .badge {
        display: inline-block;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 0.85rem;
        font-weight: 700;
        text-transform: uppercase;
      }
      .badge-healthy { background: rgba(31, 122, 77, 0.14); color: var(--ok); }
      .badge-degraded { background: rgba(167, 101, 0, 0.14); color: var(--warn); }
      .badge-down { background: rgba(180, 35, 24, 0.14); color: var(--down); }
      .incident-banner {
        background: rgba(180, 35, 24, 0.08);
        border: 1.5px solid var(--down);
        border-radius: 12px;
        padding: 12px 18px;
        margin-bottom: 20px;
        color: var(--down);
        font-size: 0.95rem;
      }
      .incident-banner strong { font-weight: 700; }
      .incident-triage {
        margin-top: 28px;
        background: rgba(180, 35, 24, 0.04);
        border: 1.5px solid var(--down);
        border-radius: 16px;
        padding: 16px 20px;
      }
      .incident-triage > h2 {
        color: var(--down);
        margin: 0 0 16px;
        font-size: 1.1rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .incident-triage h3 {
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--muted);
        margin: 12px 0 6px;
      }
      .stat-value {
        font-size: 2rem;
        font-weight: 700;
        margin: 8px 0 0;
        color: var(--accent);
      }
      section {
        margin-top: 28px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        background: var(--panel);
        border-radius: 16px;
        overflow: hidden;
        border: 1px solid var(--line);
      }
      th, td {
        padding: 12px 14px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
      }
      th {
        background: #f6f1e8;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      tr:last-child td {
        border-bottom: none;
      }
      code {
        font-family: Consolas, "Courier New", monospace;
        font-size: 0.9em;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Unit Talk V2 Operator</h1>
      <p class="lede">Read-only operational view for the active canary lane. Observed at ${escapeHtml(snapshot.observedAt)} using ${escapeHtml(snapshot.persistenceMode)} mode.</p>
      ${incidentBanner}
      ${incidentTriageSection}
      <section>
        <div class="grid health-grid">${healthCards}</div>
        <div class="grid count-grid">${countCards}</div>
      </section>
      ${canaryReadinessSection}
      ${bestBetsHealthSection}
      ${traderInsightsHealthSection}
      ${picksPipelineSection}
      ${recapSection}
      <section>
        <h2>Recent Outbox</h2>
        <table>
          <thead><tr><th>ID</th><th>Target</th><th>Status</th><th>Worker</th><th>Updated</th></tr></thead>
          <tbody>${outboxRows}</tbody>
        </table>
      </section>
      <section>
        <h2>Recent Receipts</h2>
        <table>
          <thead><tr><th>ID</th><th>Channel</th><th>Status</th><th>External</th><th>Recorded</th></tr></thead>
          <tbody>${receiptRows}</tbody>
        </table>
      </section>
      <section>
        <h2>Recent Settlements</h2>
        <table>
          <thead><tr><th>ID</th><th>Pick</th><th>Status</th><th>Result</th><th>Source</th><th>Corrects</th><th>Evidence</th><th>Settled</th></tr></thead>
          <tbody>${settlementRows}</tbody>
        </table>
      </section>
      <section>
        <h2>Recent Runs</h2>
        <table>
          <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Actor</th><th>Created</th></tr></thead>
          <tbody>${runRows}</tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;
}

function renderTriageOutboxRows(rows: OutboxRecord[]) {
  return renderTableRows(rows, (row) => [
    row.id,
    row.target,
    row.status,
    row.claimed_by ?? 'unclaimed',
    row.updated_at,
  ]);
}

function renderTriageRunRows(rows: SystemRunRecord[]) {
  return renderTableRows(rows, (row) => [
    row.id,
    row.run_type,
    row.status,
    row.actor ?? 'system',
    row.created_at,
  ]);
}

function renderTableRows<T>(rows: T[], mapRow: (row: T) => string[], columnCount = 5) {
  if (rows.length === 0) {
    return `<tr><td colspan="${columnCount}">No rows available yet.</td></tr>`;
  }

  return rows
    .map(
      (row) =>
        `<tr>${mapRow(row)
          .map((value) => `<td><code>${escapeHtml(value)}</code></td>`)
          .join('')}</tr>`,
    )
    .join('');
}

function formatSettlementStatusLabel(row: SettlementRecord) {
  if (row.status === 'manual_review') {
    return '[MANUAL REVIEW] manual_review';
  }

  if (row.corrects_id) {
    return `[CORRECTION] ${row.status}`;
  }

  return row.status;
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function writeHtml(response: ServerResponse, status: number, body: string) {
  response.statusCode = status;
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(body);
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
