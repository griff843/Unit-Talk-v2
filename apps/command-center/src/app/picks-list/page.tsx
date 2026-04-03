import { Card } from '@/components/ui/Card';
import { PickFilters } from '@/components/PickFilters';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import Link from 'next/link';
import { Suspense } from 'react';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';
const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;

interface SearchResult {
  picks: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}

async function fetchPickSearch(params: Record<string, string>): Promise<SearchResult> {
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/pick-search?${qs}`, { cache: 'no-store' });
    if (!res.ok) return { picks: [], total: 0, limit: 25, offset: 0 };
    const json = (await res.json()) as { ok: boolean; data: SearchResult };
    return json.ok ? json.data : { picks: [], total: 0, limit: 25, offset: 0 };
  } catch {
    return { picks: [], total: 0, limit: 25, offset: 0 };
  }
}

function readRefreshIntervalMs(searchParams?: Record<string, string | string[] | undefined>) {
  const raw = searchParams?.refresh;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(parsed, 5), 300) * 1000;
  }
  return DEFAULT_AUTO_REFRESH_INTERVAL_MS;
}

function PickResultRow({ pick }: { pick: Record<string, unknown> }) {
  const id = String(pick['id'] ?? '');
  const status = String(pick['status'] ?? '');
  const approval = String(pick['approval_status'] ?? '');
  const source = String(pick['source'] ?? '');
  const submitter = String(pick['submitter'] ?? '—');
  const market = String(pick['market'] ?? '');
  const selection = String(pick['selection'] ?? '');
  const score = pick['promotion_score'] as number | null;
  const createdAt = String(pick['created_at'] ?? '');

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
      <td className="py-2 pr-3">
        <Link href={`/picks/${id}`} className="font-mono text-xs text-blue-400 hover:underline">
          {id.slice(0, 8)}...
        </Link>
      </td>
      <td className="py-2 pr-3 text-xs text-gray-300">{source}</td>
      <td className="py-2 pr-3 text-xs text-gray-300">{submitter}</td>
      <td className="py-2 pr-3 text-xs text-gray-300">{market}</td>
      <td className="py-2 pr-3 text-xs text-gray-300">{selection}</td>
      <td className="py-2 pr-3 text-xs text-gray-300">{score != null ? score.toFixed(1) : '—'}</td>
      <td className="py-2 pr-3 text-xs text-gray-300">{status}</td>
      <td className="py-2 pr-3 text-xs text-gray-300">{approval}</td>
      <td className="py-2 text-xs text-gray-400">{new Date(createdAt).toLocaleDateString()}</td>
    </tr>
  );
}

export default async function PicksListPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params: Record<string, string> = {};
  for (const [key, val] of Object.entries(searchParams)) {
    if (typeof val === 'string' && val.trim()) params[key] = val.trim();
  }

  const { picks, total, limit, offset } = await fetchPickSearch(params);
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);
  const hasFilters = Object.keys(params).length > 0;
  const intervalMs = readRefreshIntervalMs(searchParams);
  const observedAt = new Date().toISOString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100">Picks</h1>
          <p className="text-sm text-gray-500">{hasFilters ? `Filtered results (${total})` : `${total} picks in the search index`}</p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={intervalMs} className="lg:min-w-[360px]" />
      </div>

      <Card>
        <Suspense fallback={<div className="text-xs text-gray-500">Loading filters...</div>}>
          <PickFilters />
        </Suspense>
      </Card>

      <Card title={hasFilters ? `Results (${total})` : `All Picks (${total})`}>
        {picks.length === 0 ? (
          <p className="text-sm text-gray-500">
            {hasFilters ? 'No picks match the current filters.' : 'No picks found.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                    <th className="py-2 pr-3">Pick ID</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Submitted By</th>
                    <th className="py-2 pr-3">Market</th>
                    <th className="py-2 pr-3">Selection</th>
                    <th className="py-2 pr-3">Score</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Approval</th>
                    <th className="py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {picks.map((pick) => (
                    <PickResultRow key={String(pick['id'])} pick={pick} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
                <span>Page {page} of {totalPages} ({total} total)</span>
                <div className="flex gap-2">
                  {offset > 0 && (
                    <Link
                      href={`/picks-list?${new URLSearchParams({ ...params, offset: String(offset - limit) }).toString()}`}
                      className="rounded border border-gray-700 px-2 py-1 hover:bg-gray-800"
                    >
                      Prev
                    </Link>
                  )}
                  {offset + limit < total && (
                    <Link
                      href={`/picks-list?${new URLSearchParams({ ...params, offset: String(offset + limit) }).toString()}`}
                      className="rounded border border-gray-700 px-2 py-1 hover:bg-gray-800"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
