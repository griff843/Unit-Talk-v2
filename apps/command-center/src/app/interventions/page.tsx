import { Card } from '@/components/ui/Card';
import Link from 'next/link';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_ref: string;
  action: string;
  actor: string;
  payload: Record<string, unknown>;
  created_at: string;
}

const INTERVENTION_ACTIONS: ReadonlySet<string> = new Set([
  'delivery.retry',
  'promotion.rerun',
  'promotion.override.force_promote',
  'promotion.override.suppress',
  'review.approve',
  'review.deny',
  'review.hold',
  'review.return',
]);

async function fetchInterventionAudit(): Promise<AuditRow[]> {
  try {
    const provider = await fetch(`${OPERATOR_WEB_BASE}/api/operator/snapshot`, { cache: 'no-store' });
    if (!provider.ok) return [];
    const json = (await provider.json()) as { ok: boolean; data: { recentAudit: AuditRow[] } };
    if (!json.ok) return [];
    // Filter to intervention actions only — exact match, no prefix matching
    return (json.data.recentAudit ?? []).filter((row) =>
      INTERVENTION_ACTIONS.has(row.action),
    );
  } catch {
    return [];
  }
}

const ACTION_COLORS: Record<string, string> = {
  'delivery.retry': 'text-blue-400',
  'promotion.rerun': 'text-blue-400',
  'promotion.override.force_promote': 'text-emerald-400',
  'promotion.override.suppress': 'text-red-400',
  'review.approve': 'text-emerald-400',
  'review.deny': 'text-red-400',
  'review.hold': 'text-yellow-400',
  'review.return': 'text-blue-400',
};

function getActionColor(action: string): string {
  return ACTION_COLORS[action] ?? 'text-gray-300';
}

function PayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const reason = payload['reason'] as string | undefined;
  const before = payload['before'] as Record<string, unknown> | undefined;
  const after = payload['after'] as Record<string, unknown> | undefined;

  return (
    <div className="flex flex-col gap-0.5">
      {reason && <span className="text-gray-300">Reason: {reason}</span>}
      {before && after && (
        <span className="text-gray-500">
          {JSON.stringify(before)} → {JSON.stringify(after)}
        </span>
      )}
      {!reason && !before && (
        <span className="text-gray-500">{JSON.stringify(payload).slice(0, 100)}</span>
      )}
    </div>
  );
}

export default async function InterventionsPage() {
  const audit = await fetchInterventionAudit();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-bold text-gray-100">Intervention Audit</h1>

      <Card title={`Recent Interventions (${audit.length})`}>
        {audit.length === 0 ? (
          <p className="text-sm text-gray-500">No interventions recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">Pick</th>
                  <th className="py-2 pr-3">Operator</th>
                  <th className="py-2 pr-3">Details</th>
                  <th className="py-2">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((row) => (
                  <tr key={row.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className={`py-2 pr-3 text-xs font-medium ${getActionColor(row.action)}`}>
                      {row.action}
                    </td>
                    <td className="py-2 pr-3">
                      {row.entity_ref ? (
                        <Link href={`/picks/${row.entity_ref}`} className="font-mono text-xs text-blue-400 hover:underline">
                          {row.entity_ref.slice(0, 8)}...
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{row.actor ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs">
                      <PayloadSummary payload={row.payload} />
                    </td>
                    <td className="py-2 text-xs text-gray-400">{new Date(row.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
