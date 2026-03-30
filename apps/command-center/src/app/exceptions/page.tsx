import { Card } from '@/components/ui/Card';
import { InterventionAction } from '@/components/InterventionAction';
import { retryDelivery, rerunPromotion, overridePromotion } from '@/app/actions/intervention';
import Link from 'next/link';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

interface ExceptionQueues {
  counts: {
    failedDelivery: number;
    deadLetter: number;
    pendingManualReview: number;
    staleValidated: number;
    rerunCandidates: number;
  };
  failedDelivery: Array<Record<string, unknown>>;
  deadLetter: Array<Record<string, unknown>>;
  pendingManualReview: Array<Record<string, unknown>>;
  staleValidated: Array<Record<string, unknown>>;
  rerunCandidates: Array<Record<string, unknown>>;
}

async function fetchExceptionQueues(): Promise<ExceptionQueues | null> {
  try {
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/exception-queues`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data: ExceptionQueues };
    return json.ok ? json.data : null;
  } catch {
    return null;
  }
}

function PickLink({ id }: { id: string }) {
  return (
    <Link href={`/picks/${id}`} className="font-mono text-xs text-blue-400 hover:underline" aria-label={`Pick ${id}`}>
      {String(id).slice(0, 8)}...
    </Link>
  );
}

function CountBadge({ count, color }: { count: number; color: string }) {
  if (count === 0) return <span className="text-xs text-gray-500">0</span>;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${color}`}>{count}</span>;
}

function DeliveryRow({ row, onRetry }: { row: Record<string, unknown>; onRetry: (pickId: string, reason: string) => Promise<{ ok: boolean; error?: string }> }) {
  const pickId = String(row['pick_id'] ?? '');
  const pick = row['pick'] as Record<string, unknown> | null;
  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/50">
      <td className="py-2 pr-3"><PickLink id={pickId} /></td>
      <td className="py-2 pr-3 text-xs text-gray-300">{String(row['target'] ?? '')}</td>
      <td className="py-2 pr-3 text-xs text-gray-300">{String(row['status'] ?? '')}</td>
      <td className="py-2 pr-3 text-xs text-gray-300">{String(row['attempt_count'] ?? 0)}</td>
      <td className="py-2 pr-3 text-xs text-gray-400 max-w-[200px] truncate" title={String(row['last_error'] ?? '')}>{String(row['last_error'] ?? '—')}</td>
      <td className="py-2 pr-3 text-xs text-gray-300">{row['ageHours'] as number}h</td>
      <td className="py-2 pr-3 text-xs text-gray-300">{pick ? String(pick['status']) : '—'}</td>
      <td className="py-2">
        <InterventionAction label="Retry" variant="primary" onExecute={(reason) => onRetry(pickId, reason)} />
      </td>
    </tr>
  );
}

export default async function ExceptionsPage() {
  const data = await fetchExceptionQueues();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-bold text-gray-100">Exception Operations</h1>

      {/* Summary counts */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Failed Delivery', count: data?.counts.failedDelivery ?? 0, color: 'bg-red-500/20 text-red-400' },
          { label: 'Dead Letter', count: data?.counts.deadLetter ?? 0, color: 'bg-red-500/20 text-red-400' },
          { label: 'Manual Review', count: data?.counts.pendingManualReview ?? 0, color: 'bg-yellow-500/20 text-yellow-400' },
          { label: 'Stale Validated', count: data?.counts.staleValidated ?? 0, color: 'bg-yellow-500/20 text-yellow-400' },
          { label: 'Rerun Candidates', count: data?.counts.rerunCandidates ?? 0, color: 'bg-blue-500/20 text-blue-400' },
        ].map((q) => (
          <div key={q.label} className="rounded border border-gray-800 bg-gray-900/50 p-3 text-center">
            <CountBadge count={q.count} color={q.color} />
            <p className="mt-1 text-[10px] font-medium uppercase text-gray-500">{q.label}</p>
          </div>
        ))}
      </div>

      {/* Failed Delivery Queue */}
      {(data?.failedDelivery.length ?? 0) > 0 && (
        <Card title={`Failed Delivery (${data!.counts.failedDelivery})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Pick</th><th className="py-2 pr-3">Target</th><th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Attempts</th><th className="py-2 pr-3">Error</th><th className="py-2 pr-3">Age</th>
                  <th className="py-2 pr-3">Lifecycle</th><th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {data!.failedDelivery.map((row, i) => (
                  <DeliveryRow key={i} row={row} onRetry={retryDelivery} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Dead Letter Queue */}
      {(data?.deadLetter.length ?? 0) > 0 && (
        <Card title={`Dead Letter (${data!.counts.deadLetter})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Pick</th><th className="py-2 pr-3">Target</th><th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Attempts</th><th className="py-2 pr-3">Error</th><th className="py-2 pr-3">Age</th>
                  <th className="py-2 pr-3">Lifecycle</th><th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {data!.deadLetter.map((row, i) => (
                  <DeliveryRow key={i} row={row} onRetry={retryDelivery} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Manual Review Queue */}
      {(data?.pendingManualReview.length ?? 0) > 0 && (
        <Card title={`Pending Manual Review (${data!.counts.pendingManualReview})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Pick</th><th className="py-2 pr-3">Review Reason</th>
                  <th className="py-2 pr-3">Settled By</th><th className="py-2 pr-3">Created</th><th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {data!.pendingManualReview.map((row, i) => (
                  <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 pr-3"><PickLink id={String(row['pick_id'] ?? '')} /></td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{String(row['review_reason'] ?? '—')}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{String(row['settled_by'] ?? '—')}</td>
                    <td className="py-2 pr-3 text-xs text-gray-400">{new Date(String(row['created_at'])).toLocaleDateString()}</td>
                    <td className="py-2">
                      <Link href={`/picks/${row['pick_id']}?status=posted`} className="text-xs text-blue-400 hover:underline">
                        Resolve
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Rerun / Override Candidates */}
      {(data?.rerunCandidates.length ?? 0) > 0 && (
        <Card title={`Rerun / Override Candidates (${data!.counts.rerunCandidates})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Pick</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Market</th>
                  <th className="py-2 pr-3">Score</th><th className="py-2 pr-3">Promo Status</th><th className="py-2 pr-3">Target</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data!.rerunCandidates.map((row, i) => {
                  const pickId = String(row['id'] ?? '');
                  return (
                    <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="py-2 pr-3"><PickLink id={pickId} /></td>
                      <td className="py-2 pr-3 text-xs text-gray-300">{String(row['source'] ?? '')}</td>
                      <td className="py-2 pr-3 text-xs text-gray-300">{String(row['market'] ?? '')}</td>
                      <td className="py-2 pr-3 text-xs text-gray-300">{row['promotion_score'] != null ? Number(row['promotion_score']).toFixed(1) : '—'}</td>
                      <td className="py-2 pr-3 text-xs text-yellow-400">{String(row['promotion_status'] ?? '')}</td>
                      <td className="py-2 pr-3 text-xs text-gray-300">{String(row['promotion_target'] ?? '—')}</td>
                      <td className="py-2">
                        <div className="flex gap-2">
                          <InterventionAction label="Rerun" variant="primary" onExecute={(reason) => rerunPromotion(pickId, reason)} />
                          <InterventionAction label="Force Promote" variant="success" onExecute={(reason) => overridePromotion(pickId, 'force_promote', reason)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Stale Validated */}
      {(data?.staleValidated.length ?? 0) > 0 && (
        <Card title={`Stale Validated (${data!.counts.staleValidated})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Pick</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Market</th>
                  <th className="py-2 pr-3">Score</th><th className="py-2 pr-3">Age</th><th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {data!.staleValidated.map((row, i) => {
                  const pickId = String(row['id'] ?? '');
                  return (
                    <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="py-2 pr-3"><PickLink id={pickId} /></td>
                      <td className="py-2 pr-3 text-xs text-gray-300">{String(row['source'] ?? '')}</td>
                      <td className="py-2 pr-3 text-xs text-gray-300">{String(row['market'] ?? '')}</td>
                      <td className="py-2 pr-3 text-xs text-gray-300">{row['promotion_score'] != null ? Number(row['promotion_score']).toFixed(1) : '—'}</td>
                      <td className="py-2 pr-3 text-xs text-yellow-400">{row['ageHours'] as number}h</td>
                      <td className="py-2">
                        <InterventionAction label="Rerun Promo" variant="primary" onExecute={(reason) => rerunPromotion(pickId, reason)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Empty state */}
      {data && data.counts.failedDelivery === 0 && data.counts.deadLetter === 0 && data.counts.pendingManualReview === 0 && data.counts.staleValidated === 0 && data.counts.rerunCandidates === 0 && (
        <Card>
          <p className="text-sm text-gray-500">No active exceptions. System is healthy.</p>
        </Card>
      )}
    </div>
  );
}
