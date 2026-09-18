import Link from 'next/link';

import { Table, TableHead, TableBody, Td, Th, EmptyState, DegradedState } from '@/components/ui';
import { getHeldQueue } from '@/lib/data/queues';
import { describeSuppression, NO_REASON_RECORDED } from '@/lib/suppression';
import { describeThrown } from '@/lib/describe-error';

export const metadata = { title: 'Held picks — Unit Talk Command Center' };
export const dynamic = 'force-dynamic';

/**
 * The dedicated held-picks surface.
 *
 * `T1_PRODUCTION_READINESS_CONTRACT.md` Dimension 5 requires a held queue that "exists and shows
 * picks in held status". This route used to be a `redirect()` to `/operations/approvals`. That
 * cockpit does merge held rows with awaiting_approval and review, but it flattens away the three
 * fields that make a hold actionable — who placed it, when, and why — and an operator cannot see
 * the held population on its own. `getHeldQueue` already computes all of it; only the surface was
 * missing.
 *
 * `/review` still excludes held picks by construction (`getReviewQueue` applies
 * `.or('review_decision.is.null,review_decision.neq.hold')`), which is why sending an operator
 * there was wrong and remains wrong.
 */
export default async function HeldPicksPage() {
  let queue: Awaited<ReturnType<typeof getHeldQueue>> | null = null;
  let thrown: string | null = null;

  try {
    queue = await getHeldQueue({});
  } catch (err) {
    thrown = describeThrown(err);
  }

  if (thrown || queue?.degraded) {
    return (
      <div className="space-y-4">
        <Header total={null} />
        <DegradedState
          severity="warning"
          title="Held queue unavailable — this page is not reporting an empty hold list"
          causes={[thrown ?? queue?.degraded ?? 'held queue unavailable']}
          action={{ label: 'Retry', href: '/held' }}
        />
      </div>
    );
  }

  const picks = queue?.picks ?? [];
  const total = queue?.total ?? 0;

  return (
    <div className="space-y-4">
      <Header total={total} />

      {picks.length === 0 ? (
        <EmptyState message="No picks are currently held. This page loaded the held queue successfully; it is not reporting an unknown state." />
      ) : (
        <div className="cc-surface overflow-hidden">
          <div className="border-b border-gray-800 px-4 py-3 text-xs text-gray-500">
            Loaded {picks.length} rows · source query reported {total} before fixture exclusion
          </div>
          <div className="overflow-x-auto px-4 pb-2">
            <Table>
              <TableHead>
                <Th>Pick</Th>
                <Th>Held by</Th>
                <Th>Age</Th>
                <Th>Hold reason</Th>
                <Th>Routing</Th>
                <Th align="right">Score</Th>
              </TableHead>
              <TableBody>
                {picks.map((pick) => {
                  const suppression = describeSuppression(pick.promotionStatus, pick.promotionReason);
                  return (
                    <tr key={pick.id} className="border-t border-gray-800 hover:bg-white/[0.02]">
                      <Td>
                        <Link
                          href={`/picks/${pick.id}`}
                          className="font-medium text-gray-100 hover:text-blue-300 hover:underline"
                        >
                          {pick.selection || 'Unknown pick'}
                        </Link>
                        <div className="text-[11px] text-gray-500">
                          {pick.marketTypeDisplayName ?? pick.market ?? '—'} ·{' '}
                          <span className="font-mono">{pick.id.slice(0, 8)}</span>
                        </div>
                      </Td>
                      <Td>
                        <span className="text-xs text-gray-300">{pick.heldBy}</span>
                        <div className="text-[11px] text-gray-500">{formatWhen(pick.heldAt)}</div>
                      </Td>
                      <Td>
                        <span className={pick.ageHours >= 24 ? 'text-amber-300' : 'text-gray-400'}>
                          {humanizeHours(pick.ageHours)}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-[11px] text-gray-300">{pick.holdReason}</span>
                      </Td>
                      <Td>
                        {suppression.suppressed ? (
                          suppression.missingReason ? (
                            <span className="text-[10px] font-semibold text-rose-400">
                              {NO_REASON_RECORDED}
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-300/90">{suppression.reason}</span>
                          )
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </Td>
                      <Td>
                        <span className="font-mono font-semibold text-gray-100">
                          {pick.promotion_score != null ? pick.promotion_score.toFixed(1) : '—'}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-500">
        A hold is recorded as <span className="font-mono">review_decision = &apos;hold&apos;</span> on a pick
        still awaiting approval. To act on one, open the pick or use the approvals cockpit at{' '}
        <Link href="/operations/approvals" className="text-blue-300 hover:underline">
          /operations/approvals
        </Link>
        .
      </p>
    </div>
  );
}

function Header({ total }: { total: number | null }) {
  return (
    <div>
      <h1 className="text-lg font-semibold text-gray-100">Held picks</h1>
      <p className="text-xs text-gray-500">
        {total == null
          ? 'Picks placed on hold during review.'
          : `${total} pick${total === 1 ? '' : 's'} placed on hold during review.`}
      </p>
    </div>
  );
}

function humanizeHours(hours: number): string {
  if (hours < 1) return '< 1h';
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
