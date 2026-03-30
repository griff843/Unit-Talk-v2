import type {
  DashboardData,
  DeliveryStatus,
  LifecycleSignal,
  LifecycleStatus,
  PickRow,
  SettlementStatus,
  SignalStatus,
  StatsSnapshot,
} from './types.js';

const OPERATOR_WEB_BASE =
  process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

// ── Raw fetch helpers ────────────────────────────────────────────────────────

export async function fetchSnapshot(): Promise<unknown> {
  const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/snapshot`, {
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

// ── Signal derivation ────────────────────────────────────────────────────────

function deriveSignals(
  snapshot: unknown,
  recap: unknown,
): LifecycleSignal[] {
  const snap = asRecord(snapshot);
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
  const recapData = asRecord(recap);
  const byResult = asRecord(recapData['by_result']);
  const wins = asNumber(byResult['win']);
  const losses = asNumber(byResult['loss']);
  const pushes = asNumber(byResult['push']);
  const total = wins + losses + pushes;

  let settlementStatus: SignalStatus;
  let settlementDetail: string;
  if (total === 0) {
    settlementStatus = 'BROKEN';
    settlementDetail = 'No settled picks';
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
  const totalPicks = asNumber(recapData['total_picks']);
  const settledPickCount = recentPicks.filter(
    (p) => asRecord(p)['status'] === 'settled',
  ).length;

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

// ── Pick rows mapping ────────────────────────────────────────────────────────

function mapPickRows(pipeline: unknown, outbox: unknown[], recentSettlements: unknown[]): PickRow[] {
  const pipelineData = asRecord(pipeline);
  const picks = asArray(pipelineData['recentPicks']);

  return picks.map((pick) => {
    const p = asRecord(pick);
    const pickId = asString(p['id']);
    const status = asString(p['status']);
    const promotionTarget = asStringOrNull(p['promotionTarget']);
    const promotionScore = asNumberOrNull(p['promotionScore']);
    const settlementResult = asStringOrNull(p['settlementResult']);
    const createdAt = asString(p['createdAt']);

    // Find matching outbox row
    const outboxRow =
      outbox
        .map(asRecord)
        .find((o) => asString(o['pick_id']) === pickId) ?? null;

    return {
      id: pickId,
      submittedAt: createdAt,
      submitter: asString(p['source'] ?? p['approvalStatus'], 'unknown'),
      source: asString(p['source'] ?? p['approvalStatus'], 'unknown'),
      sport: promotionTarget ?? 'unknown',
      pickDetails: {
        market: promotionTarget ?? '—',
        selection: '—',
        line: null,
        odds: null,
      },
      unitSize: null,
      score: promotionScore,
      lifecycleStatus: mapLifecycleStatus(status),
      deliveryStatus: mapDeliveryStatus(outboxRow),
      settlementStatus: mapSettlementStatus(pickId, settlementResult, recentSettlements),
      result: settlementResult,
    };
  });
}

// ── Stats mapping ────────────────────────────────────────────────────────────

function mapStats(recap: unknown): StatsSnapshot {
  const r = asRecord(recap);
  const byResult = asRecord(r['by_result']);
  const flatBetRoi = asRecord(r['flat_bet_roi']);

  const wins = asNumber(byResult['win']);
  const losses = asNumber(byResult['loss']);
  const pushes = asNumber(byResult['push']);
  const total = asNumber(r['total_picks']);
  const roiPct = asNumberOrNull(flatBetRoi['roi_pct']);

  return { total, wins, losses, pushes, roiPct };
}

// ── Main dashboard fetch ─────────────────────────────────────────────────────

export async function fetchDashboardData(): Promise<DashboardData> {
  const [snapshot, pipeline, recap] = await Promise.all([
    fetchSnapshot(),
    fetchPicksPipeline(),
    fetchRecap(),
  ]);

  const snap = asRecord(snapshot);
  const outbox = asArray(snap['recentOutbox']);
  const recentSettlements = asArray(snap['recentSettlements']);

  const signals = deriveSignals(snapshot, recap);
  const picks = mapPickRows(pipeline, outbox, recentSettlements);
  const stats = mapStats(recap);
  const observedAt = asString(snap['observedAt'], new Date().toISOString());

  return { signals, picks, stats, observedAt };
}
