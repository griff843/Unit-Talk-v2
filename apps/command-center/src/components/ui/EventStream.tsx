import React from 'react';
import { HealthBadge } from './HealthBadge';

export interface EventStreamItem {
  id: string;
  title: string;
  detail: string;
  source: string;
  timestamp: string;
  status: 'healthy' | 'warning' | 'error' | 'unknown';
}

export function EventStream({ items }: { items: EventStreamItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <article key={item.id} className="cc-event-line">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-[var(--cc-text-primary)]">{item.title}</div>
                <HealthBadge status={item.status} />
              </div>
              <p className="text-sm leading-6 text-[var(--cc-text-secondary)]">{item.detail}</p>
            </div>
            <div className="text-right text-xs uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
              <div>{item.source}</div>
              <div className="mt-2">{item.timestamp}</div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
