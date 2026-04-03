import { Card } from '@/components/ui/Card';
import { Table, TableHead, TableBody, Th, Td } from '@/components/ui/Table';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { CorrectionForm } from '@/components/CorrectionForm';
import { InterventionAction } from '@/components/InterventionAction';
import { SettlementForm } from '@/components/SettlementForm';
import { getAllowedActions } from '@/lib/pick-actions';

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
  createdAt: string;
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
      <span className="font-mono text-gray-200 break-all">{value ?? '—'}</span>
    </div>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="py-2 text-xs text-gray-500 italic">
        No rows.
      </td>
    </tr>
  );
}

async function fetchPickDetail(pickId: string): Promise<PickDetailViewResponse | null> {
  const operatorWebUrl = process.env['OPERATOR_WEB_URL'] ?? 'http://localhost:4200';
  try {
    const res = await fetch(`${operatorWebUrl}/api/operator/picks/${pickId}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data: PickDetailViewResponse };
    return json.ok ? json.data : null;
  } catch {
    return null;
  }
}

/**
 * Pick detail page.
 *
 * Renders the full lifecycle trace (8 sections) fetched from operator-web,
 * plus the appropriate settlement or correction surface based on pick status.
 *
 * - status not yet settled → SettlementForm
 * - status === 'settled'   → CorrectionForm
 * - status === 'voided'    → informational message only
 */
export default async function PickDetailPage({ params }: PickDetailPageProps) {
  const pickId = params.id;

  const detail = await fetchPickDetail(pickId);

  if (detail == null) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb items={[{ label: 'Dashboard', href: '/' }, { label: 'Picks', href: '/picks-list' }, { label: pickId.slice(0, 8) + '...' }]} />
        <div>
          <h1 className="text-lg font-bold text-gray-100">Pick Detail</h1>
          <p className="mt-1 font-mono text-sm text-gray-400">{pickId}</p>
        </div>
        <div className="text-red-400 text-sm">
          Pick not found or operator-web unavailable: {pickId}
        </div>
      </div>
    );
  }

  const { pick } = detail;
  const allowedActions = getAllowedActions(pick.status);
  const corrections = detail.settlements.filter((s) => s.correctsId != null);
  const breadcrumbs = [
    { label: 'Dashboard', href: '/' },
    { label: 'Picks', href: '/picks-list' },
    { label: pick.id.slice(0, 12) + '...' },
  ];
  const promotionScores =
    pick.metadata['promotionScores'] != null &&
    typeof pick.metadata['promotionScores'] === 'object' &&
    !Array.isArray(pick.metadata['promotionScores'])
      ? (pick.metadata['promotionScores'] as Record<string, unknown>)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb items={breadcrumbs} />
      <div>
        <h1 className="text-lg font-bold text-gray-100">Pick Detail</h1>
        <p className="mt-1 font-mono text-xs text-gray-400">{pick.id}</p>
        <p className="mt-1 text-sm text-gray-500">
          Status: <span className="font-medium text-gray-300">{pick.status}</span>
        </p>
      </div>

      {/* Settlement / Correction surface — derived from canonical pick state */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        {allowedActions.length === 0 ? (
          <p className="text-sm text-gray-400">Pick is {pick.status} — no further action available.</p>
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
            <KV label="Promotion Score" value={pick.promotionScore != null ? String(pick.promotionScore) : null} />
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
              variant="success"
              pickId={pickId}
              action="force_promote"
              target="best-bets"
            />
          </div>
        </div>
      </Card>

      {/* Section 1: Submission Details */}
      <Card title="Submission Details">
        <div className="flex flex-col gap-1">
          <KV label="ID" value={pick.id} />
          <KV label="Submitted By" value={pick.submittedBy} />
          <KV label="Source" value={pick.source} />
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

      {/* Section 2: Lifecycle Transitions */}
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

      {/* Section 3: Promotion State */}
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

      {/* Section 4: Discord Delivery Status */}
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

      {/* Section 5: Score + Metadata */}
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
              {Object.entries(promotionScores).map(([key, val]) => (
                <KV key={key} label={key} value={String(val)} />
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-gray-500">No promotionScores in metadata.</p>
        )}
      </Card>

      {/* Section 6: Settlement Records */}
      <Card title="Settlement Records">
        <Table>
          <TableHead>
            <Th>Result</Th>
            <Th>Status</Th>
            <Th>Confidence</Th>
            <Th>Corrects ID</Th>
            <Th>Settled By</Th>
            <Th>Settled At</Th>
          </TableHead>
          <TableBody>
            {detail.settlements.length === 0 ? (
              <EmptyRow cols={6} />
            ) : (
              detail.settlements.map((row) => (
                <tr key={row.id} className="border-t border-gray-800">
                  <Td>{row.result ?? '—'}</Td>
                  <Td>{row.status}</Td>
                  <Td>{row.confidence ?? '—'}</Td>
                  <Td>{row.correctsId ?? '—'}</Td>
                  <Td>{row.settledBy ?? '—'}</Td>
                  <Td>{row.settledAt ?? '—'}</Td>
                </tr>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Section 7: Correction History */}
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

      {/* Section 8: Audit Trail */}
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
                        const s = JSON.stringify(row.payload);
                        return s.length > 80 ? s.slice(0, 80) + '…' : s;
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
