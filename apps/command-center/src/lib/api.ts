import type {
  BoardStateData,
  DashboardData,
  DashboardRuntimeData,
  DeliveryStatus,
  IntelligenceCoverage,
  LifecycleSignal,
  LifecycleStatus,
  OperationalException,
  PickRow,
  ProviderHealth,
  SettlementStatus,
  SignalStatus,
  StatsSnapshot,
} from './types.js';

const OPERATOR_WEB_BASE =
  process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

// ── Raw fetch helpers ────────────────────────────────────────────────────────

export async function fetchSnapshot(limit?: number): Promise<unknown> {
  const params = new URLSearchParams();
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    params.set('limit', String(Math.round(limit)));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/snapshot${suffix}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Snapshot fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchPicksPipeline(): Promise<unknown> {
  const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/picks-pipeline`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Pipeline fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchRecap(): Promise<unknown> {
  const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/recap`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Recap fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchExceptionQueues(): Promise<unknown> {
  const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/exception-queues`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Exception queues fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchIntelligenceCoverage(window = '7d'): Promise<IntelligenceCoverage> {
  const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/intelligence-coverage?window=${encodeURIComponent(window)}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Intelligence coverage fetch failed: ${res.status}`);
  const json = (await res.json()) as { ok: boolean; data: IntelligenceCoverage };
  if (!json.ok) {
    throw new Error('Intelligence coverage fetch failed');
  }
  return json.data;
}

export async function fetchProviderHealth(): Promise<ProviderHealth> {
  const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/provider-health`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Provider health fetch failed: ${res.status}`);
  const json = (await res.json()) as { ok: boolean; data: ProviderHealth };
  if (!json.ok) {
    throw new Error('Provider health fetch failed');
  }
  return json.data;
}

export async function fetchBoardState(target = 'best-bets'): Promise<BoardStateData> {
  const res = await fetch(
    `${OPERATOR_WEB_BASE}/api/operator/board-state?target=${encodeURIComponent(target)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Board state fetch failed: ${res.status}`);
  const json = (await res.json()) as { ok: boolean; data: BoardStateData };
  if (!json.ok) {
    throw new Error('Board state fetch failed');
  }
  return json.data;
}

// ── Type-safe accessors (unknown → primitive) ────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function readJsonObject(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }

  return null;
}

// ── Signal derivation ────────────────────────────────────────────────────────

function unwrapResponse(raw: unknown): Record<string, unknown> {
  const top = asRecord(raw);
  // Operator-web wraps all responses: { ok, data: { ... } }
  const data = top['data'];
  return data !== undefined ? asRecord(data) : top;
}

export function deriveSignals(
  snapshot: unknown,
  recap: unknown,
  pipeline?: unknown,
): LifecycleSignal[] {
  const snap = unwrapResponse(snapshot);
  const counts = asRecord(snap['counts']);
  const recentPicks = asArray(snap['recentPicks']);
  const recentReceipts = asArray(snap['recentReceipts']);
  const recentSettlements = asArray(snap['recentSettlements']);

  const deadLetterOutbox = asNumber(counts['deadLetterOutbox']);
  const failedOutbox = asNumber(counts['failedOutbox']);
  const pendingManualReview = asNumber(counts['pendingManualReview']);

  // ── submission ──────────────────────────────────────────────────────────
  const submissionStatus: SignalStatus =
    recentPicks.length > 0 ? 'WORKING' : 'BROKEN';
  const submissionDetail =
    recentPicks.length > 0
      ? `${recentPicks.length} recent pick(s)`
      : 'No recent picks';

  // ── scoring ─────────────────────────────────────────────────────────────
  let scoringStatus: SignalStatus;
  let scoringDetail: string;
  if (recentPicks.length === 0) {
    scoringStatus = 'BROKEN';
    scoringDetail = 'No picks to evaluate';
  } else {
    const withScore = recentPicks.filter(
      (p) => asNumberOrNull(asRecord(p)['promotion_score']) !== null,
    ).length;
    const ratio = withScore / recentPicks.length;
    if (ratio > 0.5) {
      scoringStatus = 'WORKING';
      scoringDetail = `${withScore}/${recentPicks.length} picks scored`;
    } else if (ratio > 0) {
      scoringStatus = 'DEGRADED';
      scoringDetail = `Only ${withScore}/${recentPicks.length} picks scored`;
    } else {
      scoringStatus = 'BROKEN';
      scoringDetail = 'No picks have scores';
    }
  }

  // ── promotion ────────────────────────────────────────────────────────────
  let promotionStatus: SignalStatus;
  let promotionDetail: string;
  if (recentPicks.length === 0) {
    promotionStatus = 'BROKEN';
    promotionDetail = 'No picks';
  } else {
    const qualified = recentPicks.filter(
      (p) => asRecord(p)['promotion_status'] === 'qualified',
    ).length;
    const pending = recentPicks.filter(
      (p) => asRecord(p)['promotion_status'] === 'pending',
    ).length;
    const notEligible = recentPicks.filter(
      (p) => asRecord(p)['promotion_status'] === 'not_eligible',
    ).length;

    if (qualified > 0) {
      promotionStatus = 'WORKING';
      promotionDetail = `${qualified} qualified`;
    } else if (
      notEligible === recentPicks.length ||
      (notEligible > 0 && qualified === 0 && pending === 0)
    ) {
      promotionStatus = 'BROKEN';
      promotionDetail = `All ${notEligible} not eligible`;
    } else {
      promotionStatus = 'DEGRADED';
      promotionDetail = `${pending} pending, 0 qualified`;
    }
  }

  // ── discord_delivery ─────────────────────────────────────────────────────
  let discordStatus: SignalStatus;
  let discordDetail: string;
  if (deadLetterOutbox > 0 && recentReceipts.length === 0) {
    discordStatus = 'BROKEN';
    discordDetail = `${deadLetterOutbox} dead-letter, no receipts`;
  } else if (failedOutbox > 0) {
    discordStatus = 'DEGRADED';
    discordDetail = `${failedOutbox} failed outbox row(s)`;
  } else if (recentReceipts.length > 0 && deadLetterOutbox === 0) {
    discordStatus = 'WORKING';
    discordDetail = `${recentReceipts.length} recent receipt(s)`;
  } else {
    discordStatus = 'BROKEN';
    discordDetail = 'No receipts recorded';
  }

  // ── settlement ───────────────────────────────────────────────────────────
  const recapData = unwrapResponse(recap);
  const byResult = asRecord(recapData['by_result']);
  const wins = asNumber(byResult['win']);
  const losses = asNumber(byResult['loss']);
  const pushes = asNumber(byResult['push']);
  const total = wins + losses + pushes;

  let settlementStatus: SignalStatus;
  let settlementDetail: string;
  if (total === 0) {
    settlementStatus = 'WORKING';
    settlementDetail = 'No settled picks yet';
  } else if (pendingManualReview > 0 || recentSettlements.some(
    (s) => asRecord(s)['status'] === 'manual_review',
  )) {
    settlementStatus = 'DEGRADED';
    settlementDetail = `${total} settled; pending manual review`;
  } else {
    settlementStatus = 'WORKING';
    settlementDetail = `${total} settled (${wins}W/${losses}L/${pushes}P)`;
  }

  // ── stats_propagation ────────────────────────────────────────────────────
  // Use pipeline settled count (covers ALL picks in DB) instead of
  // recentPicks (limited to 12 most recent — causes false divergence).
  const totalPicks = asNumber(recapData['total_picks']);
  const pipelineCounts = pipeline ? asRecord(unwrapResponse(pipeline)['counts']) : null;
  const settledPickCount = pipelineCounts
    ? asNumber(pipelineCounts['settled'])
    : recentPicks.filter((p) => asRecord(p)['status'] === 'settled').length;

  let statsStatus: SignalStatus;
  let statsDetail: string;
  if (totalPicks === 0 && settledPickCount === 0) {
    statsStatus = 'WORKING';
    statsDetail = 'No settled picks yet';
  } else if (totalPicks === 0 && settledPickCount > 0) {
    statsStatus = 'BROKEN';
    statsDetail = `Recap shows 0; ${settledPickCount} picks settled`;
  } else {
    const divergence =
      settledPickCount > 0
        ? Math.abs(totalPicks - settledPickCount) / settledPickCount
        : 0;
    if (divergence > 0.2) {
      statsStatus = 'BROKEN';
      statsDetail = `Recap (${totalPicks}) diverges from settled picks (${settledPickCount})`;
    } else {
      statsStatus = 'WORKING';
      statsDetail = `Recap: ${totalPicks} picks`;
    }
  }

  return [
    { signal: 'submission', status: submissionStatus, detail: submissionDetail },
    { signal: 'scoring', status: scoringStatus, detail: scoringDetail },
    { signal: 'promotion', status: promotionStatus, detail: promotionDetail },
    { signal: 'discord_delivery', status: discordStatus, detail: discordDetail },
    { signal: 'settlement', status: settlementStatus, detail: settlementDetail },
    { signal: 'stats_propagation', status: statsStatus, detail: statsDetail },
  ];
}

export function resolveLaneHealth(
  lane: Record<string, unknown>,
  kind: 'canary' | 'activation',
): boolean {
  const explicit = kind === 'canary'
    ? lane['graduationReady']
    : lane['activationHealthy'];
  if (typeof explicit === 'boolean') {
    return explicit;
  }

  const failures =
    asNumber(lane['recentFailureCount']) +
    asNumber(lane['recentDeadLetterCount']);
  const sent = asNumber(lane['recentSentCount']);

  if (kind === 'canary') {
    return failures === 0 && sent > 0;
  }

  return failures === 0;
}

// ── Lifecycle status mapping ─────────────────────────────────────────────────

function mapLifecycleStatus(status: string): LifecycleStatus {
  switch (status) {
    case 'submitted': return 'submitted';
    case 'validated': return 'validated';
    case 'queued': return 'queued';
    case 'posted': return 'posted';
    case 'settled': return 'settled';
    case 'voided': return 'voided';
    default: return 'validated';
  }
}

// ── Promotion status mapping ─────────────────────────────────────────────────

function mapPromotionStatus(status: string): PickRow['promotionStatus'] {
  switch (status) {
    case 'qualified': return 'qualified';
    case 'not_eligible': return 'not_eligible';
    case 'suppressed': return 'suppressed';
    case 'expired': return 'expired';
    default: return 'pending';
  }
}

// ── Delivery status mapping ──────────────────────────────────────────────────

function mapDeliveryStatus(outboxRow: Record<string, unknown> | null): DeliveryStatus {
  if (outboxRow === null) return 'not_promoted';
  const status = asString(outboxRow['status']);
  switch (status) {
    case 'pending':
    case 'processing': return 'queued';
    case 'sent': return 'delivered';
    case 'failed': return 'failed';
    case 'dead_letter': return 'dead_letter';
    default: return 'not_promoted';
  }
}

// ── Settlement status mapping ────────────────────────────────────────────────

function mapSettlementStatus(
  pickId: string,
  settlementResult: string | null,
  recentSettlements: unknown[],
): SettlementStatus {
  if (settlementResult === null) return 'pending';

  // Check recentSettlements for this pick to determine if corrected or manual_review
  const settlementForPick = recentSettlements
    .map(asRecord)
    .filter((s) => asString(s['pick_id']) === pickId);

  if (settlementForPick.some((s) => asString(s['status']) === 'manual_review')) {
    return 'manual_review';
  }
  if (settlementForPick.some((s) => s['corrects_id'] !== null && s['corrects_id'] !== undefined)) {
    return 'corrected';
  }
  return 'settled';
}

function readSubmittedBy(pick: Record<string, unknown>): string {
  const metadata = readJsonObject(pick['metadata']);
  const candidates = [
    pick['submitted_by'],
    metadata?.['submittedBy'],
    metadata?.['submitted_by'],
    metadata?.['capper'],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return asString(pick['source'], 'unknown');
}

function readSport(pick: Record<string, unknown>): string | null {
  const metadata = readJsonObject(pick['metadata']);
  const candidates = [metadata?.['sport'], metadata?.['league']];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function buildIntelligenceSummary(
  pick: Record<string, unknown>,
  settlementRows: Array<Record<string, unknown>>,
): PickRow['intelligence'] {
  const metadata = readJsonObject(pick['metadata']);
  const domainAnalysis = readJsonObject(metadata?.['domainAnalysis']);
  const deviggingResult = readJsonObject(metadata?.['deviggingResult']);
  const kellySizing = readJsonObject(metadata?.['kellySizing']);
  const realEdge =
    typeof domainAnalysis?.['realEdge'] === 'number' ||
    typeof metadata?.['realEdge'] === 'number';
  const edgeSource =
    typeof domainAnalysis?.['realEdgeSource'] === 'string'
      ? domainAnalysis['realEdgeSource']
      : typeof metadata?.['edgeSource'] === 'string'
        ? metadata['edgeSource']
        : null;
  const clv = settlementRows.some((row) => {
    const payload = readJsonObject(row['payload']);
    return typeof payload?.['clvRaw'] === 'number' || typeof payload?.['clvPercent'] === 'number';
  });

  return {
    domainAnalysis: domainAnalysis !== null,
    deviggingResult: deviggingResult !== null,
    kellySizing: kellySizing !== null,
    realEdge,
    edgeSource,
    clv,
  };
}

// ── Pick rows mapping ────────────────────────────────────────────────────────
//
// Uses snapshot.recentPicks (full PickRecord with all DB columns, snake_case)
// instead of picksPipeline.recentPicks (which strips source/market/selection/
// line/odds/stake_units). Settlement result is resolved from the pipeline
// endpoint which applies correction-aware effective settlement logic.

export function mapPickRows(
  snapshotPicks: unknown[],
  pipelinePicks: unknown[],
  outbox: unknown[],
  recentSettlements: unknown[],
  recentReceipts: unknown[],
): PickRow[] {
  // Build a lookup from pipeline picks for settlement result (correction-aware)
  const pipelineByPickId = new Map<string, Record<string, unknown>>();
  for (const pp of pipelinePicks) {
    const row = asRecord(pp);
    const id = asString(row['id']);
    if (id) pipelineByPickId.set(id, row);
  }

  return snapshotPicks.map((pick) => {
    const p = asRecord(pick);
    const pickId = asString(p['id']);
    const status = asString(p['status']);
    const createdAt = asString(p['created_at']);

    // Real fields from full PickRecord (snapshot, snake_case DB columns)
    const source = asString(p['source'], 'unknown');
    const market = asString(p['market'], '—');
    const selection = asString(p['selection'], '—');
    const line = asNumberOrNull(p['line']);
    const odds = asNumberOrNull(p['odds']);
    const stakeUnits = asNumberOrNull(p['stake_units']);
    const promotionScore = asNumberOrNull(p['promotion_score']);
    const promotionStatus = asString(p['promotion_status'], 'pending');
    const promotionReason = asStringOrNull(p['promotion_reason']);
    const promotionTarget = asStringOrNull(p['promotion_target']);

    // Settlement result from pipeline (correction-aware effective result)
    const pipelineRow = pipelineByPickId.get(pickId);
    const settlementResult = pipelineRow
      ? asStringOrNull(pipelineRow['settlementResult'])
      : null;

    // Find matching outbox row
    const outboxRow =
      outbox
        .map(asRecord)
        .find((o) => asString(o['pick_id']) === pickId) ?? null;
    const outboxId = outboxRow ? asString(outboxRow['id']) : '';
    const receiptRow =
      recentReceipts
        .map(asRecord)
        .find((receipt) => asString(receipt['outbox_id']) === outboxId) ?? null;
    const settlementRows = recentSettlements
      .map(asRecord)
      .filter((settlement) => asString(settlement['pick_id']) === pickId);

    return {
      id: pickId,
      submittedAt: createdAt,
      submitter: readSubmittedBy(p),
      source,
      sport: readSport(p),
      pickDetails: {
        market,
        selection,
        line,
        odds,
      },
      unitSize: stakeUnits,
      score: promotionScore,
      lifecycleStatus: mapLifecycleStatus(status),
      promotionStatus: mapPromotionStatus(promotionStatus),
      promotionReason,
      promotionTarget,
      deliveryStatus: mapDeliveryStatus(outboxRow),
      receiptStatus: receiptRow ? asStringOrNull(receiptRow['status']) : null,
      receiptChannel: receiptRow ? asStringOrNull(receiptRow['channel']) : null,
      settlementStatus: mapSettlementStatus(pickId, settlementResult, recentSettlements),
      result: settlementResult,
      intelligence: buildIntelligenceSummary(p, settlementRows),
    };
  });
}

// ── Stats mapping ────────────────────────────────────────────────────────────

function mapStats(recap: unknown): StatsSnapshot {
  const r = unwrapResponse(recap);
  const byResult = asRecord(r['by_result']);
  const flatBetRoi = asRecord(r['flat_bet_roi']);

  const wins = asNumber(byResult['win']);
  const losses = asNumber(byResult['loss']);
  const pushes = asNumber(byResult['push']);
  const total = asNumber(r['total_picks']);
  const roiPct = asNumberOrNull(flatBetRoi['roi_pct']);

  return { total, wins, losses, pushes, roiPct };
}

// ── Exception detection ─────────────────────────────────────────────────────

const SETTLEMENT_PENDING_HOURS = 48;

function detectExceptions(
  snapshot: unknown,
  recap: unknown,
  picks: PickRow[],
): OperationalException[] {
  const exceptions: OperationalException[] = [];
  const snap = unwrapResponse(snapshot);
  const recentSettlements = asArray(snap['recentSettlements']);
  const outboxRows = asArray(snap['recentOutbox']);
  const now = Date.now();
  let exId = 0;

  // Picks pending settlement too long
  for (const pick of picks) {
    if (
      (pick.lifecycleStatus === 'posted' || pick.lifecycleStatus === 'queued') &&
      pick.settlementStatus === 'pending'
    ) {
      const age = now - new Date(pick.submittedAt).getTime();
      const hours = age / (1000 * 60 * 60);
      if (hours > SETTLEMENT_PENDING_HOURS) {
        exceptions.push({
          id: `exc-${++exId}`,
          severity: hours > SETTLEMENT_PENDING_HOURS * 2 ? 'critical' : 'warning',
          category: 'settlement',
          title: 'Pick pending settlement',
          detail: `Pick has been in "${pick.lifecycleStatus}" for ${Math.floor(hours)}h without settlement`,
          pickId: pick.id,
        });
      }
    }
  }

  // Failed Discord deliveries
  for (const row of outboxRows) {
    const o = asRecord(row);
    const status = asString(o['status']);
    const pickId = asString(o['pick_id']);
    if (status === 'failed') {
      exceptions.push({
        id: `exc-${++exId}`,
        severity: 'warning',
        category: 'delivery',
        title: 'Failed Discord delivery',
        detail: `Outbox row failed — attempts: ${asNumber(o['attempt_count'])}`,
        pickId: pickId || undefined,
      });
    }
    if (status === 'dead_letter') {
      exceptions.push({
        id: `exc-${++exId}`,
        severity: 'critical',
        category: 'delivery',
        title: 'Dead-letter delivery',
        detail: `Delivery exhausted all retries — pick will not be posted`,
        pickId: pickId || undefined,
      });
    }
  }

  // Stuck lifecycle states (validated or queued for too long)
  for (const pick of picks) {
    if (pick.lifecycleStatus === 'validated') {
      const age = now - new Date(pick.submittedAt).getTime();
      const hours = age / (1000 * 60 * 60);
      if (hours > 4) {
        exceptions.push({
          id: `exc-${++exId}`,
          severity: hours > 24 ? 'critical' : 'warning',
          category: 'lifecycle',
          title: 'Stuck in validated',
          detail: `Pick has been "validated" for ${Math.floor(hours)}h — expected to advance to queued`,
          pickId: pick.id,
        });
      }
    }
  }

  // Missing scores
  for (const pick of picks) {
    if (pick.score === null && pick.lifecycleStatus !== 'voided') {
      exceptions.push({
        id: `exc-${++exId}`,
        severity: 'warning',
        category: 'scoring',
        title: 'Missing promotion score',
        detail: `Pick has no promotion score`,
        pickId: pick.id,
      });
    }
  }

  // Missing results on settled picks
  for (const pick of picks) {
    if (pick.lifecycleStatus === 'settled' && pick.result === null) {
      exceptions.push({
        id: `exc-${++exId}`,
        severity: 'critical',
        category: 'settlement',
        title: 'Settled without result',
        detail: `Pick is marked "settled" but has no result (win/loss/push)`,
        pickId: pick.id,
      });
    }
  }

  // Manual review items (correction conflicts / pending reviews)
  for (const row of recentSettlements) {
    const s = asRecord(row);
    if (asString(s['status']) === 'manual_review') {
      exceptions.push({
        id: `exc-${++exId}`,
        severity: 'warning',
        category: 'correction',
        title: 'Pending manual review',
        detail: `Settlement record requires manual review`,
        pickId: asString(s['pick_id']) || undefined,
      });
    }
  }

  return exceptions;
}

// ── Main dashboard fetch ─────────────────────────────────────────────────────

export async function fetchDashboardData(): Promise<DashboardData> {
  const [snapshot, pipeline, recap] = await Promise.all([
    fetchSnapshot(),
    fetchPicksPipeline(),
    fetchRecap(),
  ]);

  const snap = unwrapResponse(snapshot);
  const outbox = asArray(snap['recentOutbox']);
  const recentReceipts = asArray(snap['recentReceipts']);
  const recentSettlements = asArray(snap['recentSettlements']);
  const snapshotPicks = asArray(snap['recentPicks']);

  // Pipeline picks carry correction-aware settlement results (camelCase keys)
  const pipelineData = unwrapResponse(pipeline);
  const pipelinePicks = asArray(pipelineData['recentPicks']);

  const signals = deriveSignals(snapshot, recap, pipeline);
  const picks = mapPickRows(snapshotPicks, pipelinePicks, outbox, recentSettlements, recentReceipts);
  const stats = mapStats(recap);
  const exceptions = detectExceptions(snapshot, recap, picks);
  const observedAt = asString(snap['observedAt'], new Date().toISOString());

  return { signals, picks, stats, exceptions, observedAt };
}

export async function fetchDashboardRuntimeData(): Promise<DashboardRuntimeData> {
  const [snapshot, providerHealth] = await Promise.all([
    fetchSnapshot(),
    fetchProviderHealth(),
  ]);
  const snap = unwrapResponse(snapshot);
  const counts = asRecord(snap['counts']);
  const workerRuntime = asRecord(snap['workerRuntime']);
  const aging = asRecord(snap['aging']);
  const canary = asRecord(snap['canary']);
  const bestBets = asRecord(snap['bestBets']);
  const traderInsights = asRecord(snap['traderInsights']);

  const activeProviders = providerHealth.providers.filter((provider) => provider.status === 'active').length;
  const staleProviders = providerHealth.providers.filter((provider) => provider.status === 'stale').length;
  const absentProviders = providerHealth.providers.filter((provider) => provider.status === 'absent').length;

  return {
    outbox: {
      pending: asNumber(counts['pendingOutbox']),
      processing: asNumber(counts['processingOutbox']),
      sent: asNumber(counts['sentOutbox']),
      failed: asNumber(counts['failedOutbox']),
      deadLetter: asNumber(counts['deadLetterOutbox']),
      simulated: asNumber(counts['simulatedDeliveries']),
    },
    worker: {
      drainState: asString(workerRuntime['drainState'], 'unknown'),
      detail: asString(workerRuntime['detail'], 'Unavailable'),
      latestRunAt: asStringOrNull(workerRuntime['latestDistributionRunAt']),
      latestReceiptAt: asStringOrNull(workerRuntime['latestReceiptRecordedAt']),
    },
    aging: {
      staleValidated: asNumber(aging['staleValidated']),
      stalePosted: asNumber(aging['stalePosted']),
      staleProcessing: asNumber(aging['staleProcessing']),
    },
    deliveryTargets: [
      {
        target: asString(canary['target'], 'discord:canary'),
        recentSentCount: asNumber(canary['recentSentCount']),
        recentFailureCount: asNumber(canary['recentFailureCount']),
        latestSentAt: asStringOrNull(canary['latestSentAt']),
        healthy: resolveLaneHealth(canary, 'canary'),
      },
      {
        target: asString(bestBets['target'], 'discord:best-bets'),
        recentSentCount: asNumber(bestBets['recentSentCount']),
        recentFailureCount: asNumber(bestBets['recentFailureCount']),
        latestSentAt: asStringOrNull(bestBets['latestSentAt']),
        healthy: resolveLaneHealth(bestBets, 'activation'),
      },
      {
        target: asString(traderInsights['target'], 'discord:trader-insights'),
        recentSentCount: asNumber(traderInsights['recentSentCount']),
        recentFailureCount: asNumber(traderInsights['recentFailureCount']),
        latestSentAt: asStringOrNull(traderInsights['latestSentAt']),
        healthy: resolveLaneHealth(traderInsights, 'activation'),
      },
    ],
    providerSummary: {
      active: activeProviders,
      stale: staleProviders,
      absent: absentProviders,
      distinctEventsLast24h: providerHealth.distinctEventsLast24h,
      ingestorStatus: providerHealth.ingestorHealth.status,
    },
  };
}
