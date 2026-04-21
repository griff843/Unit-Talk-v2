import Link from 'next/link';
import { Suspense } from 'react';
import { PickFilters } from '@/components/PickFilters';
import { PickIdentityPanel } from '@/components/PickIdentityPanel';
import { Card } from '@/components/ui/Card';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { buildScoreInsight, scoreToneClasses } from '@/lib/score-insight';
import { InlineSettleButton } from '@/components/InlineSettleButton';

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
    const response = await fetch(`${OPERATOR_WEB_BASE}/api/operator/pick-search?${qs}`, { cache: 'no-store' });
    if (!response.ok) {
      return { picks: [], total: 0, limit: 25, offset: 0 };
    }

    const json = (await response.json()) as { ok: boolean; data: SearchResult };
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
  const score = typeof pick['promotion_score'] === 'number' ? pick['promotion_score'] : null;
  const createdAt = String(pick['created_at'] ?? '');
  const reviewDecision = typeof pick['review_decision'] === 'string' ? pick['review_decision'] : null;
  const settlementResult = typeof pick['settlement_result'] === 'string' ? pick['settlement_result'] : null;
  const metadata =
    typeof pick['metadata'] === 'object' && pick['metadata'] !== null && !Array.isArray(pick['metadata'])
      ? (pick['metadata'] as Record<string, unknown>)
      : null;
  const scoreInsight = buildScoreInsight(metadata);

  return (
    <tr className="border-b border-gray-800 transition-colors hover:bg-gray-800/50">
      <td className="py-3 pr-3 align-top">
        <PickIdentityPanel
          compact
          pickId={`${id.slice(0, 8)}...`}
          href={`/picks/${id}`}
          pick={{
            source: typeof pick['source'] === 'string' ? pick['source'] : null,
            market: typeof pick['market'] === 'string' ? pick['market'] : null,
            selection: typeof pick['selection'] === 'string' ? pick['selection'] : null,
            line: typeof pick['line'] === 'number' ? pick['line'] : null,
            odds: typeof pick['odds'] === 'number' ? pick['odds'] : null,
            metadata,
            matchup: typeof pick['matchup'] === 'string' ? pick['matchup'] : null,
            eventStartTime: typeof pick['eventStartTime'] === 'string' ? pick['eventStartTime'] : null,
            sport: typeof pick['sport'] === 'string' ? pick['sport'] : null,
            submitter: typeof pick['submitter'] === 'string' ? pick['submitter'] : null,
            capperDisplayName: typeof pick['capper_display_name'] === 'string' ? pick['capper_display_name'] : null,
            marketTypeDisplayName:
              typeof pick['market_type_display_name'] === 'string' ? pick['market_type_display_name'] : null,
            settlementResult,
            reviewDecision,
          }}
        />
      </td>
      <td className="py-3 pr-3 align-top text-xs text-gray-300">
        <div className="flex flex-col gap-1">
          <span>{score != null ? score.toFixed(1) : '—'}</span>
          <span
            className={`inline-flex w-fit rounded border px-2 py-0.5 text-[10px] ${scoreToneClasses(scoreInsight.reliabilityTone)}`}
          >
            {scoreInsight.edgeSourceLabel}
          </span>
        </div>
      </td>
      <td className="py-3 pr-3 align-top text-xs text-gray-300">{status}</td>
      <td className="py-3 pr-3 align-top text-xs text-gray-300">{approval}</td>
      <td className="py-3 pr-3 align-top text-xs text-gray-300">{reviewDecision ?? '—'}</td>
      <td className="py-3 pr-3 align-top text-xs text-gray-300">{settlementResult ?? '—'}</td>
      <td className="py-3 align-top text-xs text-gray-400">{new Date(createdAt).toLocaleDateString()}</td>
      <td className="py-3 align-top">
        {status === 'posted' && <InlineSettleButton pickId={id} />}
      </td>
    </tr>
  );
}

export default async function PicksListPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string' && value.trim()) {
      params[key] = value.trim();
    }
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
          <p className="text-sm text-gray-500">
            {hasFilters ? `Filtered results (${total})` : `${total} picks in the search index`}
          </p>
        </div>
        <AutoRefreshStatusBar
          lastUpdatedAt={observedAt}
          intervalMs={intervalMs}
          className="lg:min-w-[360px]"
        />
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
                    <th className="py-2 pr-3">Bet</th>
                    <th className="py-2 pr-3">Routing Score</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Approval</th>
                    <th className="py-2 pr-3">Review</th>
                    <th className="py-2 pr-3">Result</th>
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2">Settle</th>
                  </tr>
                </thead>
                <tbody>
                  {picks.map((pick) => (
                    <PickResultRow key={String(pick['id'])} pick={pick} />
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
                <span>
                  Page {page} of {totalPages} ({total} total)
                </span>
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
