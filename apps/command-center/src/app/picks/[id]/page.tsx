import { Card } from '@/components/ui/Card';
import { Table, TableHead, TableBody, Th, Td } from '@/components/ui/Table';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { CorrectionForm } from '@/components/CorrectionForm';
import { InterventionAction } from '@/components/InterventionAction';
import { PickIdentityPanel } from '@/components/PickIdentityPanel';
import { SettlementForm } from '@/components/SettlementForm';
import { getAllowedActions } from '@/lib/pick-actions';
import { humanizeMarketType } from '@/lib/pick-identity';
import { buildScoreInsight, scoreToneClasses } from '@/lib/score-insight';

interface PickDetailPageProps {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}

interface LifecycleRow {
  id: string;
  fromState: string | null;
  toState: string;
  writerRole: string;
  reason: string | null;
  createdAt: string;
}

interface PromotionHistoryRow {
  id: string;
  target: string;
  status: string;
  score: number | null;
  version: string;
  decidedAt: string;
  decidedBy: string;
  overrideAction: string | null;
  reason: string | null;
}

interface OutboxRow {
  id: string;
  target: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReceiptRow {
  id: string;
  outboxId: string;
  externalId: string | null;
  channel: string | null;
  status: string | null;
  recordedAt: string;
}

interface SettlementRow {
  id: string;
  result: string | null;
  status: string;
  confidence: string | null;
  evidenceRef: string | null;
  correctsId: string | null;
  settledBy: string | null;
  settledAt: string | null;
  hasClv: boolean;
  createdAt: string;
  notes?: string | null;
  reviewReason?: string | null;
  clvRaw?: number | null;
  clvPercent?: number | null;
  beatsClosingLine?: boolean | null;
  profitLossUnits?: number | null;
  gameResult?: {
    actualValue: number;
    marketKey: string;
    participantName: string | null;
    eventName: string | null;
    sourcedAt: string;
  } | null;
  outcomeExplanation?: string | null;
  correctedSettlement?: {
    id: string;
    result: string | null;
    settledAt: string | null;
    settledBy: string | null;
  } | null;
}

interface AuditRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface PickDetail {
  id: string;
  status: string;
  approvalStatus: string;
  promotionStatus: string;
  promotionTarget: string | null;
  promotionScore: number | null;
  source: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  stakeUnits: number | null;
  confidence?: number | null;
  sport?: string | null;
  matchup?: string | null;
  eventStartTime?: string | null;
  capperName?: string | null;
  marketTypeLabel?: string | null;
  submittedBy: string | null;
  createdAt: string;
  postedAt: string | null;
  settledAt: string | null;
  submissionId: string | null;
  metadata: Record<string, unknown>;
}

interface PickDetailViewResponse {
  pick: PickDetail;
  lifecycle: LifecycleRow[];
  promotionHistory: PromotionHistoryRow[];
  outboxRows: OutboxRow[];
  receipts: ReceiptRow[];
  settlements: SettlementRow[];
  auditTrail: AuditRow[];
  submission: { id: string; payload: Record<string, unknown>; createdAt: string } | null;
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-36 shrink-0 text-gray-400">{label}</span>
      <span className="font-mono break-all text-gray-200">{value ?? '—'}</span>
    </div>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="py-2 text-xs italic text-gray-500">
        No rows.
      </td>
    </tr>
  );
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function formatRoutingScore(score: number | null) {
  return score != null ? score.toFixed(1) : '—';
}

function summarizeScoreMeaning(pick: PickDetail) {
  if (pick.promotionScore == null) {
    return 'No routing score was persisted for this pick.';
  }

  if (pick.promotionTarget === 'exclusive-insights') {
    return `Exclusive Insights uses a stricter routing bar. ${formatRoutingScore(pick.promotionScore)} is meaningful only as promotion fit, not outcome certainty.`;
  }

  if (pick.promotionTarget === 'trader-insights') {
    return `Trader Insights routing score ${formatRoutingScore(pick.promotionScore)} reflects promotion policy fit against an 80+ lane, not a win probability.`;
  }

  return `Best Bets routing score ${formatRoutingScore(pick.promotionScore)} reflects weighted policy fit against a 70+ lane, not a win probability.`;
}

function summarizeSettlementContext(detail: PickDetailViewResponse) {
  const latest = detail.settlements[0] ?? null;
  if (!latest) {
    return 'Pending settlement';
  }

  if (latest.outcomeExplanation) {
    return latest.outcomeExplanation;
  }

  if (latest.gameResult?.eventName) {
    return `${latest.result ?? latest.status} • ${latest.gameResult.eventName}`;
  }

  return latest.result ?? latest.status;
}

async function fetchPickDetail(pickId: string): Promise<PickDetailViewResponse | null> {
  const operatorWebUrl = process.env['OPERATOR_WEB_URL'] ?? 'http://localhost:4200';
  try {
    const response = await fetch(`${operatorWebUrl}/api/operator/picks/${pickId}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as { ok: boolean; data: PickDetailViewResponse };
    return json.ok ? json.data : null;
  } catch {
    return null;
  }
}

export default async function PickDetailPage({ params }: PickDetailPageProps) {
  const pickId = params.id;
  const detail = await fetchPickDetail(pickId);

  if (detail == null) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb
          items={[
            { label: 'Dashboard', href: '/' },
            { label: 'Picks', href: '/picks-list' },
            { label: `${pickId.slice(0, 8)}...` },
          ]}
        />
        <div>
          <h1 className="text-lg font-bold text-gray-100">Pick Detail</h1>
          <p className="mt-1 font-mono text-sm text-gray-400">{pickId}</p>
        </div>
        <div className="text-sm text-red-400">
          Pick not found or operator-web unavailable: {pickId}
        </div>
      </div>
    );
  }

  const { pick } = detail;
  const allowedActions = getAllowedActions(pick.status);
  const corrections = detail.settlements.filter((settlement) => settlement.correctsId != null);
  const promotionScores = readObject(pick.metadata['promotionScores']);
  const domainAnalysis = readObject(pick.metadata['domainAnalysis']);
  const deviggingResult = readObject(pick.metadata['deviggingResult']);
  const kellySizing = readObject(pick.metadata['kellySizing']);
  const hasRealEdge =
    typeof domainAnalysis?.['realEdge'] === 'number' ||
    typeof pick.metadata['realEdge'] === 'number';
  const edgeSource =
    typeof domainAnalysis?.['realEdgeSource'] === 'string'
      ? domainAnalysis['realEdgeSource']
      : typeof pick.metadata['edgeSource'] === 'string'
        ? pick.metadata['edgeSource']
        : null;
  const hasClv = detail.settlements.some((settlement) => settlement.hasClv);
  const latestSettlementSummary = summarizeSettlementContext(detail);
  const scoreMeaning = summarizeScoreMeaning(pick);
  const scoreInsight = buildScoreInsight(pick.metadata);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/' },
          { label: 'Picks', href: '/picks-list' },
          { label: `${pick.id.slice(0, 12)}...` },
        ]}
      />

      <Card>
        <div className="flex flex-col gap-4">
          <PickIdentityPanel
            pickId={pick.id}
            pick={{
              source: pick.source,
              market: pick.market,
              selection: pick.selection,
              line: pick.line,
              odds: pick.odds,
              metadata: pick.metadata,
              submissionPayload: detail.submission?.payload ?? null,
              matchup: pick.matchup ?? null,
              eventStartTime: pick.eventStartTime ?? null,
              sport: pick.sport ?? null,
              submittedBy: pick.submittedBy,
              capperName: pick.capperName ?? null,
              marketTypeLabel: pick.marketTypeLabel ?? null,
              settlementResult: detail.settlements[0]?.result ?? null,
            }}
          />
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded border border-gray-800 bg-gray-950/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Lifecycle</p>
              <p className="mt-1 text-sm font-semibold text-gray-100">{pick.status}</p>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Approval</p>
              <p className="mt-1 text-sm font-semibold text-gray-100">{pick.approvalStatus}</p>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Promotion</p>
              <p className="mt-1 text-sm font-semibold text-gray-100">{pick.promotionTarget ?? pick.promotionStatus}</p>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Settlement</p>
              <p className="mt-1 text-sm font-semibold text-gray-100">{latestSettlementSummary}</p>
            </div>
          </div>
          <div className="rounded border border-blue-900/60 bg-blue-950/30 p-3 text-sm text-blue-100">
            <p className="font-medium">Routing score: {formatRoutingScore(pick.promotionScore)}</p>
            <p className="mt-1 text-xs text-blue-200/80">{scoreMeaning}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={`rounded border px-2 py-1 text-[11px] ${scoreToneClasses(scoreInsight.reliabilityTone)}`}>
                {scoreInsight.edgeSourceLabel}
              </span>
              <span className="rounded border border-blue-900/60 bg-blue-950/30 px-2 py-1 text-[11px] text-blue-100/90">
                {scoreInsight.reliabilityLabel}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        {allowedActions.length === 0 ? (
          <p className="text-sm text-gray-400">Pick is {pick.status}; no further action available.</p>
        ) : allowedActions.includes('correct') ? (
          <CorrectionForm pickId={pickId} />
        ) : allowedActions.includes('settle') ? (
          <SettlementForm pickId={pickId} isAlreadySettled={false} />
        ) : (
          <p className="text-sm text-gray-400">No actions available for this pick.</p>
        )}
      </div>

      <Card title="Promotion Controls">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <KV label="Promotion Status" value={pick.promotionStatus} />
            <KV label="Promotion Target" value={pick.promotionTarget} />
            <KV
              label="Promotion Score"
              value={pick.promotionScore != null ? String(pick.promotionScore) : null}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <InterventionAction
              label="Rerun Promotion"
              variant="primary"
              pickId={pickId}
              action="rerun_promotion"
            />
            <InterventionAction
              label="Force Promote to Best Bets"
              variant="warning"
              pickId={pickId}
              action="force_promote"
              target="best-bets"
              contextNote={`Current status: ${pick.promotionStatus}. Score: ${pick.promotionScore != null ? pick.promotionScore.toFixed(1) : 'none'}.`}
            />
          </div>
        </div>
      </Card>

      <Card title="Submission Details">
        <div className="flex flex-col gap-1">
          <KV label="ID" value={pick.id} />
          <KV label="Submitted By" value={pick.submittedBy} />
          <KV label="Capper" value={pick.capperName ?? null} />
          <KV label="Source" value={pick.source} />
          <KV label="Sport" value={pick.sport ?? null} />
          <KV label="Matchup" value={pick.matchup ?? null} />
          <KV label="Event Start" value={pick.eventStartTime ?? null} />
          <KV label="Market Type" value={humanizeMarketType(pick.marketTypeLabel ?? pick.market ?? null)} />
          <KV label="Confidence" value={pick.confidence != null ? String(pick.confidence) : null} />
          <KV label="Market" value={pick.market} />
          <KV label="Selection" value={pick.selection} />
          <KV label="Line" value={pick.line != null ? String(pick.line) : null} />
          <KV label="Odds" value={pick.odds != null ? String(pick.odds) : null} />
          <KV label="Stake Units" value={pick.stakeUnits != null ? String(pick.stakeUnits) : null} />
          <KV label="Submission ID" value={pick.submissionId} />
          <KV label="Created At" value={pick.createdAt} />
          <KV label="Posted At" value={pick.postedAt} />
          <KV label="Settled At" value={pick.settledAt} />
        </div>
      </Card>

      <Card title="Lifecycle Transitions">
        <Table>
          <TableHead>
            <Th>From</Th>
            <Th>To</Th>
            <Th>Writer Role</Th>
            <Th>Reason</Th>
            <Th>Timestamp</Th>
          </TableHead>
          <TableBody>
            {detail.lifecycle.length === 0 ? (
              <EmptyRow cols={5} />
            ) : (
              detail.lifecycle.map((row) => (
                <tr key={row.id} className="border-t border-gray-800">
                  <Td>{row.fromState ?? '—'}</Td>
                  <Td>{row.toState}</Td>
                  <Td>{row.writerRole}</Td>
                  <Td>{row.reason ?? '—'}</Td>
                  <Td>{row.createdAt}</Td>
                </tr>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Card title="Promotion State">
        <Table>
          <TableHead>
            <Th>Target</Th>
            <Th>Status</Th>
            <Th>Score</Th>
            <Th>Version</Th>
            <Th>Decided At</Th>
            <Th>Decided By</Th>
          </TableHead>
          <TableBody>
            {detail.promotionHistory.length === 0 ? (
              <EmptyRow cols={6} />
            ) : (
              detail.promotionHistory.map((row) => (
                <tr key={row.id} className="border-t border-gray-800">
                  <Td>{row.target}</Td>
                  <Td>{row.status}</Td>
                  <Td>{row.score != null ? String(row.score) : '—'}</Td>
                  <Td>{row.version}</Td>
                  <Td>{row.decidedAt}</Td>
                  <Td>{row.decidedBy}</Td>
                </tr>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Card title="Discord Delivery Status">
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-xs uppercase text-gray-500">Outbox Rows</p>
            <Table>
              <TableHead>
                <Th>Target</Th>
                <Th>Status</Th>
                <Th>Attempts</Th>
                <Th>Last Error</Th>
                <Th>Created At</Th>
              </TableHead>
              <TableBody>
                {detail.outboxRows.length === 0 ? (
                  <EmptyRow cols={5} />
                ) : (
                  detail.outboxRows.map((row) => (
                    <tr key={row.id} className="border-t border-gray-800">
                      <Td>{row.target}</Td>
                      <Td>{row.status}</Td>
                      <Td>{String(row.attemptCount)}</Td>
                      <Td>{row.lastError ?? '—'}</Td>
                      <Td>{row.createdAt}</Td>
                    </tr>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div>
            <p className="mb-2 text-xs uppercase text-gray-500">Receipts</p>
            <Table>
              <TableHead>
                <Th>External ID</Th>
                <Th>Channel</Th>
                <Th>Outbox ID</Th>
                <Th>Recorded At</Th>
              </TableHead>
              <TableBody>
                {detail.receipts.length === 0 ? (
                  <EmptyRow cols={4} />
                ) : (
                  detail.receipts.map((row) => (
                    <tr key={row.id} className="border-t border-gray-800">
                      <Td>{row.externalId ?? '—'}</Td>
                      <Td>{row.channel ?? '—'}</Td>
                      <Td>{row.outboxId}</Td>
                      <Td>{row.recordedAt}</Td>
                    </tr>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>

      <Card title="Score + Metadata">
        <div className="flex flex-col gap-1">
          <KV label="Promotion Status" value={pick.promotionStatus} />
          <KV label="Promotion Target" value={pick.promotionTarget} />
          <KV
            label="Promotion Score"
            value={pick.promotionScore != null ? String(pick.promotionScore) : null}
          />
        </div>
        {promotionScores != null ? (
          <div className="mt-4">
            <p className="mb-2 text-xs uppercase text-gray-500">Promotion Score Components</p>
            <div className="flex flex-col gap-1">
              {Object.entries(promotionScores).map(([key, value]) => (
                <KV key={key} label={key} value={String(value)} />
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-gray-500">No promotion scores in metadata.</p>
        )}
      </Card>

      <Card title="Intelligence Presence">
        <div className="flex flex-col gap-1">
          <KV label="Domain Analysis" value={domainAnalysis ? 'present' : 'missing'} />
          <KV label="Real Edge" value={hasRealEdge ? 'present' : 'missing'} />
          <KV label="Edge Source" value={edgeSource} />
          <KV label="Devigging Result" value={deviggingResult ? 'present' : 'missing'} />
          <KV label="Kelly Sizing" value={kellySizing ? 'present' : 'missing'} />
          <KV label="CLV" value={
            hasClv
              ? `${detail.settlements.find(s => s.clvPercent != null)?.clvPercent?.toFixed(2) ?? '?'}% (${detail.settlements.find(s => s.beatsClosingLine != null)?.beatsClosingLine ? 'beats line' : 'behind line'})`
              : 'missing'
          } />
        </div>
      </Card>

      <Card title="Settlement Records">
        <Table>
          <TableHead>
            <Th>Result</Th>
            <Th>Status</Th>
            <Th>Confidence</Th>
            <Th>CLV</Th>
            <Th>P/L</Th>
            <Th>Corrects ID</Th>
            <Th>Settled By</Th>
            <Th>Settled At</Th>
          </TableHead>
          <TableBody>
            {detail.settlements.length === 0 ? (
              <EmptyRow cols={8} />
            ) : (
              detail.settlements.map((row) => (
                <tr key={row.id} className="border-t border-gray-800">
                  <Td>{row.result ?? '—'}</Td>
                  <Td>{row.status}</Td>
                  <Td>{row.confidence ?? '—'}</Td>
                  <Td>{row.clvPercent != null ? `${row.clvPercent.toFixed(2)}%` : row.hasClv ? 'present' : '—'}</Td>
                  <Td>{row.profitLossUnits != null ? `${row.profitLossUnits > 0 ? '+' : ''}${row.profitLossUnits.toFixed(2)}u` : '—'}</Td>
                  <Td>{row.correctsId ?? '—'}</Td>
                  <Td>{row.settledBy ?? '—'}</Td>
                  <Td>{row.settledAt ?? '—'}</Td>
                </tr>
              ))
            )}
          </TableBody>
        </Table>
        {detail.settlements.length > 0 && (
          <div className="mt-4 space-y-3">
            {detail.settlements.map((row) => (
              <div key={`${row.id}-detail`} className="rounded border border-gray-800 bg-gray-950/60 p-3 text-sm">
                <p className="font-medium text-gray-100">{row.outcomeExplanation ?? 'No outcome explanation available.'}</p>
                {row.gameResult ? (
                  <p className="mt-1 text-xs text-gray-400">
                    Game result source: {row.gameResult.eventName ?? 'Unknown event'}
                    {row.gameResult.participantName ? ` • ${row.gameResult.participantName}` : ''}
                    {` • actual ${row.gameResult.actualValue}`}
                  </p>
                ) : null}
                {row.reviewReason ? (
                  <p className="mt-1 text-xs text-yellow-400">Review reason: {row.reviewReason}</p>
                ) : null}
                {row.correctedSettlement ? (
                  <p className="mt-1 text-xs text-gray-400">
                    Corrects {row.correctedSettlement.id} ({row.correctedSettlement.result ?? '—'})
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Correction History">
        {corrections.length === 0 ? (
          <p className="text-xs text-gray-500">No corrections for this pick.</p>
        ) : (
          <Table>
            <TableHead>
              <Th>ID</Th>
              <Th>Result</Th>
              <Th>Status</Th>
              <Th>Corrects ID</Th>
              <Th>Settled At</Th>
            </TableHead>
            <TableBody>
              {corrections.map((row) => (
                <tr key={row.id} className="border-t border-gray-800">
                  <Td>{row.id}</Td>
                  <Td>{row.result ?? '—'}</Td>
                  <Td>{row.status}</Td>
                  <Td>{row.correctsId ?? '—'}</Td>
                  <Td>{row.settledAt ?? '—'}</Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card title="Audit Trail">
        <Table>
          <TableHead>
            <Th>Entity Type</Th>
            <Th>Action</Th>
            <Th>Actor</Th>
            <Th>Payload</Th>
            <Th>Timestamp</Th>
          </TableHead>
          <TableBody>
            {detail.auditTrail.length === 0 ? (
              <EmptyRow cols={5} />
            ) : (
              detail.auditTrail.map((row) => (
                <tr key={row.id} className="border-t border-gray-800">
                  <Td>{row.entityType}</Td>
                  <Td>{row.action}</Td>
                  <Td>{row.actor ?? '—'}</Td>
                  <Td>
                    <span className="font-mono text-xs text-gray-400">
                      {(() => {
                        const payload = JSON.stringify(row.payload);
                        return payload.length > 80 ? `${payload.slice(0, 80)}...` : payload;
                      })()}
                    </span>
                  </Td>
                  <Td>{row.createdAt}</Td>
                </tr>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
