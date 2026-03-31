import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OutboxRecord, SystemRunRecord, SettlementRecord } from '@unit-talk/db';
import type { OperatorIncident, OperatorRouteDependencies, OperatorSnapshot } from '../server.js';
import { writeHtml } from '../http-utils.js';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function formatClvPercent(payload: unknown): string {
  const v = readJsonObject(payload)?.['clvPercent'];
  return typeof v === 'number' ? v.toFixed(1) + '%' : '—';
}

function formatBeatsLine(payload: unknown): string {
  const v = readJsonObject(payload)?.['beatsClosingLine'];
  return typeof v === 'boolean' ? (v ? '✓' : '✗') : '—';
}

function renderActiveIncidentsSection(incidents: OperatorIncident[]): string {
  if (incidents.length === 0) return '';

  const rows = incidents.map((incident) => `
      <tr>
        <td><code>${escapeHtml(incident.type)}</code></td>
        <td><span class="badge badge-${incident.severity === 'critical' ? 'down' : 'degraded'}">${escapeHtml(incident.severity)}</span></td>
        <td>${escapeHtml(incident.summary)}</td>
        <td><code>${escapeHtml(String(incident.affectedCount))}</code></td>
      </tr>`).join('');

  return `<section class="active-incidents" id="active-incidents">
      <h2>Active Incidents (${escapeHtml(String(incidents.length))})</h2>
      <table>
        <thead><tr><th>Type</th><th>Severity</th><th>Summary</th><th>Affected</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderRolloutConfigSection(snapshot: OperatorSnapshot): string {
  if (!snapshot.rolloutConfig || snapshot.rolloutConfig.length === 0) return '';

  const hasPartialRollout = snapshot.rolloutConfig.some((entry) => entry.rolloutPct < 100);
  const headerNote = hasPartialRollout
    ? ' <span class="badge badge-degraded">PARTIAL ROLLOUT ACTIVE</span>'
    : '';

  const rows = snapshot.rolloutConfig
    .map(
      (entry) =>
        `<tr>
          <td><code>${escapeHtml(entry.target)}</code></td>
          <td><code>${escapeHtml(String(entry.enabled))}</code></td>
          <td><code>${escapeHtml(String(entry.rolloutPct))}%</code>${entry.rolloutPct < 100 ? ' <span class="badge badge-degraded">partial</span>' : ''}</td>
          <td><code>${entry.sportFilter && entry.sportFilter.length > 0 ? escapeHtml(entry.sportFilter.join(', ')) : 'all'}</code></td>
          <td><code>${escapeHtml(String(entry.skippedCount))}</code></td>
        </tr>`,
    )
    .join('');

  return `<section>
        <h2>Rollout Controls${headerNote}</h2>
        <table>
          <thead><tr><th>Target</th><th>Enabled</th><th>Rollout %</th><th>Sport Filter</th><th>Skipped (recent)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
}

function renderAgingSection(snapshot: OperatorSnapshot): string {
  const { aging } = snapshot;
  const hasWarning = aging.staleValidated > 0 || aging.stalePosted > 0 || aging.staleProcessing > 0;
  const badgeClass = hasWarning ? 'badge-degraded' : 'badge-healthy';
  const badgeLabel = hasWarning ? 'NEEDS ATTENTION' : 'HEALTHY';

  const rows = [
    ['Stale Validated (>24h)', String(aging.staleValidated), aging.staleValidated > 0 ? 'var(--warn)' : ''],
    ['Stale Posted (>7d ungraded)', String(aging.stalePosted), aging.stalePosted > 0 ? 'var(--warn)' : ''],
    ['Stuck Processing (>10min)', String(aging.staleProcessing), aging.staleProcessing > 0 ? 'var(--warn)' : ''],
  ]
    .map(
      ([label, value, color]) =>
        `<tr><td>${escapeHtml(label!)}</td><td${color ? ` style="color:${color};font-weight:700"` : ''}><code>${escapeHtml(value!)}</code></td></tr>`,
    )
    .join('');

  const oldestInfo = [
    aging.oldestValidatedAge ? `Oldest validated: ${escapeHtml(aging.oldestValidatedAge)}` : null,
    aging.oldestPostedAge ? `Oldest posted: ${escapeHtml(aging.oldestPostedAge)}` : null,
  ]
    .filter(Boolean)
    .map((line) => `<p style="margin:4px 0;color:var(--muted);font-size:0.9rem">${line}</p>`)
    .join('');

  return `<section${hasWarning ? ' style="background:rgba(167,101,0,0.04);border:1.5px solid var(--warn);border-radius:16px;padding:16px 20px"' : ''}>
        <h2>Aging <span class="badge ${badgeClass}">${badgeLabel}</span></h2>
        <table>
          <thead><tr><th>Metric</th><th>Count</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${oldestInfo}
      </section>`;
}

export function renderOperatorDashboard(snapshot: OperatorSnapshot) {
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
  const entityCatalogCard = snapshot.entityHealth
    ? `
      <article class="card">
        <h2>Entity Catalog</h2>
        <p>Events resolved: ${escapeHtml(String(snapshot.entityHealth.resolvedEventsCount))} (${escapeHtml(String(snapshot.entityHealth.upcomingEventsCount))} upcoming)</p>
        <p>Players resolved: ${escapeHtml(String(snapshot.entityHealth.resolvedPlayersCount))}</p>
        <p>Teams with SGO ID: ${escapeHtml(String(snapshot.entityHealth.resolvedTeamsWithExternalIdCount))} / ${escapeHtml(String(snapshot.entityHealth.totalTeamsCount))}</p>
      </article>`
    : '';

  const ingestorCard = `
      <article class="card">
        <h2>Ingestor</h2>
        <p>Status: <strong>${escapeHtml(snapshot.ingestorHealth.status)}</strong></p>
        <p>Last run: ${escapeHtml(snapshot.ingestorHealth.lastRunAt ?? '\u2014')}</p>
        <p>Run count: ${escapeHtml(String(snapshot.ingestorHealth.runCount))}</p>
      </article>`;
  const quotaRows =
    snapshot.quotaSummary.providers.length > 0
      ? renderTableRows(snapshot.quotaSummary.providers, (row) => [
          row.provider,
          String(row.runCount),
          String(row.requestCount),
          String(row.successfulRequests),
          String(row.creditsUsed),
          row.remaining === null ? '—' : String(row.remaining),
          row.limit === null ? '—' : String(row.limit),
          String(row.rateLimitHitCount),
          row.backoffMs === 0 ? '0 ms' : `${row.backoffMs} ms`,
          row.lastStatus === null ? '—' : String(row.lastStatus),
          row.resetAt ?? '—',
        ], 11)
      : '<tr><td colspan="11">No provider quota telemetry is visible in recent ingestor runs.</td></tr>';
  const quotaCard = `
      <article class="card">
        <h2>API Quota</h2>
        <p>Observed at: ${escapeHtml(snapshot.quotaSummary.observedAt)}</p>
        <table>
          <thead>
            <tr><th>Provider</th><th>Runs</th><th>Requests</th><th>Success</th><th>Credits</th><th>Remaining</th><th>Limit</th><th>Rate limit hits</th><th>Backoff</th><th>Last status</th><th>Reset</th></tr>
          </thead>
          <tbody>${quotaRows}</tbody>
        </table>
      </article>`;
  const workerRuntimeCard = `
      <article class="card">
        <h2>Worker Runtime</h2>
        <p>Status: <strong>${escapeHtml(snapshot.workerRuntime.drainState)}</strong></p>
        <p>${escapeHtml(snapshot.workerRuntime.detail)}</p>
        <p>Last distribution run: ${escapeHtml(snapshot.workerRuntime.latestDistributionRunAt ?? '\u2014')}</p>
        <p>Last successful drain: ${escapeHtml(snapshot.workerRuntime.latestSuccessfulDistributionRunAt ?? '\u2014')}</p>
        <p>Last receipt: ${escapeHtml(snapshot.workerRuntime.latestReceiptRecordedAt ?? '\u2014')}</p>
      </article>`;

  const countCards = [
    ['pending outbox', snapshot.counts.pendingOutbox],
    ['processing outbox', snapshot.counts.processingOutbox],
    ['failed outbox', snapshot.counts.failedOutbox],
    ['dead-letter outbox', snapshot.counts.deadLetterOutbox],
    ['sent outbox', snapshot.counts.sentOutbox],
    ['simulated deliveries', snapshot.counts.simulatedDeliveries],
  ]
    .map(
      ([label, value]) => `
      <article class="card stat">
        <h2>${escapeHtml(String(label))}</h2>
        <p class="stat-value">${escapeHtml(String(value))}</p>
      </article>`,
    )
    .join('');
  const upcomingEventRows = renderTableRows(
    snapshot.upcomingEvents,
    (row) => [
      row.eventName,
      row.eventDate,
      row.sport,
      row.teams.join(', ') || 'n/a',
      String(row.playerCount),
    ],
    5,
  );
  const latestIngestRun = snapshot.recentRuns.find((row) => row.run_type === 'ingestor.cycle');
  const ingestDuration = latestIngestRun?.finished_at
    ? `${Math.max(
        0,
        (new Date(latestIngestRun.finished_at).getTime() - new Date(latestIngestRun.started_at).getTime()) /
          1000,
      ).toFixed(1)}s`
    : 'n/a';
  const ingestLeague = readJsonObject(latestIngestRun?.details)?.['league'];
  const lastIngestCycleSection = latestIngestRun
    ? `<section>
        <h2>Last Ingest Cycle</h2>
        <table>
          <thead><tr><th>Status</th><th>League</th><th>Started</th><th>Duration</th></tr></thead>
          <tbody><tr>
            <td><code>${escapeHtml(latestIngestRun.status)}</code></td>
            <td><code>${escapeHtml(typeof ingestLeague === 'string' ? ingestLeague : 'n/a')}</code></td>
            <td><code>${escapeHtml(latestIngestRun.started_at)}</code></td>
            <td><code>${escapeHtml(ingestDuration)}</code></td>
          </tr></tbody>
        </table>
      </section>`
    : `<section>
        <h2>Last Ingest Cycle</h2>
        <div class="card"><p>No recent ingest cycles.</p></div>
      </section>`;
  const upcomingEventsSection = `<section>
        <h2>Upcoming Events</h2>
        <table>
          <thead><tr><th>Event</th><th>Date</th><th>Sport</th><th>Teams</th><th>Player Count</th></tr></thead>
          <tbody>${upcomingEventRows}</tbody>
        </table>
      </section>`;

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

  const bySportRows = Object.entries(snapshot.boardExposure.bySport)
    .sort(([, a], [, b]) => b - a)
    .map(([sport, count]) => `<tr><td>${escapeHtml(sport)}</td><td>${escapeHtml(String(count))}</td></tr>`)
    .join('');
  const byGameRows = Object.entries(snapshot.boardExposure.byGame)
    .sort(([, a], [, b]) => b - a)
    .map(([game, count]) => `<tr><td>${escapeHtml(game)}</td><td>${escapeHtml(String(count))}</td></tr>`)
    .join('');
  const boardExposureSection = `<section>
        <h2>Board Exposure (Posted Picks)</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
          <div>
            <h3>By Sport</h3>
            <table><thead><tr><th>Sport</th><th>Count</th></tr></thead>
            <tbody>${bySportRows || '<tr><td colspan="2">No posted picks</td></tr>'}</tbody></table>
          </div>
          <div>
            <h3>By Game</h3>
            <table><thead><tr><th>Game</th><th>Count</th></tr></thead>
            <tbody>${byGameRows || '<tr><td colspan="2">No posted picks</td></tr>'}</tbody></table>
          </div>
        </div>
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
    formatClvPercent(row.payload),
    formatBeatsLine(row.payload),
  ], 10);

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
      .simulation-banner {
        background: rgba(167, 101, 0, 0.12);
        border: 1.5px solid var(--warn);
        border-radius: 12px;
        padding: 12px 18px;
        margin-bottom: 20px;
        color: var(--warn);
        font-size: 0.95rem;
      }
      .simulation-banner strong { font-weight: 700; }
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
      ${snapshot.simulationMode ? `<div class="simulation-banner"><strong>SIMULATION MODE ACTIVE</strong> &mdash; ${escapeHtml(String(snapshot.counts.simulatedDeliveries))} simulated delivery receipt(s) detected in current window.</div>` : ''}
      ${incidentBanner}
      ${renderActiveIncidentsSection(snapshot.incidents)}
      ${incidentTriageSection}
      <section>
        <div class="grid health-grid">${healthCards}${entityCatalogCard}${ingestorCard}${quotaCard}${workerRuntimeCard}</div>
        <div class="grid count-grid">${countCards}</div>
      </section>
      ${upcomingEventsSection}
      ${lastIngestCycleSection}
      ${renderRolloutConfigSection(snapshot)}
      ${canaryReadinessSection}
      ${bestBetsHealthSection}
      ${traderInsightsHealthSection}
      ${picksPipelineSection}
      ${renderAgingSection(snapshot)}
      ${recapSection}
      ${boardExposureSection}
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
          <thead><tr><th>ID</th><th>Pick</th><th>Status</th><th>Result</th><th>Source</th><th>Corrects</th><th>Evidence</th><th>Settled</th><th>CLV%</th><th>Beats Line</th></tr></thead>
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

export async function handleDashboardRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const snapshot = await deps.provider.getSnapshot();
  writeHtml(response, 200, renderOperatorDashboard(snapshot));
}
