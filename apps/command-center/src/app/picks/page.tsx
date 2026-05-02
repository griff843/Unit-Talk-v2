import React from 'react';
import Link from 'next/link';
import { StatCard, TopBar } from '@/components/ui';
import { getPicksContent } from '@/lib/command-center-data';
import { getRouteMeta } from '@/lib/command-center-nav';

export default async function PicksPage() {
  const meta = getRouteMeta('/picks');
  const content = await getPicksContent();

  return (
    <div className="space-y-6">
      <TopBar
        eyebrow={meta.eyebrow}
        title={meta.label}
        description={meta.description}
        liveLabel={meta.liveLabel}
        liveValue={content.metrics[0]?.value ?? 0}
        chips={[
          { label: 'primary lane', value: 'human review' },
          { label: 'release target', value: 'best bets' },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {content.metrics.map((metric) => (
          <StatCard key={metric.label} label={metric.label} value={metric.value} delta={metric.delta} unit={metric.unit} liveUpdate />
        ))}
      </div>

      <div className="cc-grid-12">
        <section className="cc-panel lg:col-span-8">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <div className="cc-kicker">Review queue</div>
              <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Picks waiting for action</h2>
            </div>
            <Link href="/review" className="text-sm uppercase tracking-[0.22em] text-[var(--status-info-fg)]">
              legacy queue
            </Link>
          </div>

          {content.reviewRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="cc-table min-w-full">
                <thead>
                  <tr>
                    <th>Pick</th>
                    <th>Source</th>
                    <th>Score</th>
                    <th>Status</th>
                    <th>Event</th>
                  </tr>
                </thead>
                <tbody>
                  {content.reviewRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="font-medium text-[var(--cc-text-primary)]">{row.selection}</div>
                        <div className="text-sm text-[var(--cc-text-secondary)]">{row.market}</div>
                      </td>
                      <td className="text-sm text-[var(--cc-text-secondary)]">{row.capperDisplayName ?? row.source}</td>
                      <td className="text-sm text-[var(--cc-text-primary)]">{row.promotion_score ?? '-'}</td>
                      <td className="text-sm text-[var(--cc-text-secondary)]">{row.approval_status}</td>
                      <td className="text-sm text-[var(--cc-text-secondary)]">{row.eventName ?? 'Pending event map'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-[1.4rem] border border-dashed border-white/10 p-6 text-sm text-[var(--cc-text-secondary)]">
              Live review rows are unavailable right now. The route still renders cleanly and will populate once the queue source responds.
            </div>
          )}
        </section>

        <section className="cc-panel lg:col-span-4">
          <div className="cc-kicker">Held picks</div>
          <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Intervention pocket</h2>
          <div className="mt-5 space-y-3">
            {content.heldRows.length > 0 ? (
              content.heldRows.map((row) => (
                <article key={row.id} className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-[var(--cc-text-primary)]">{row.selection}</div>
                      <div className="mt-1 text-sm text-[var(--cc-text-secondary)]">{row.market}</div>
                    </div>
                    <div className="text-xs uppercase tracking-[0.2em] text-[var(--cc-text-muted)]">{row.ageHours.toFixed(1)}h</div>
                  </div>
                  <div className="mt-3 text-sm text-[var(--cc-text-secondary)]">{row.holdReason}</div>
                  <div className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--status-info-fg)]">{row.heldBy}</div>
                </article>
              ))
            ) : (
              <div className="rounded-[1.4rem] border border-dashed border-white/10 p-5 text-sm text-[var(--cc-text-secondary)]">
                No held picks were returned. This lane is clear.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
