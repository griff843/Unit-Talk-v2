'use client';

import React from 'react';
import { useMemo, useState } from 'react';
import { Card, StatCard } from '@/components/ui';

type SortKey = 'model' | 'requests' | 'tokens' | 'cost' | 'latency' | 'errorRate';

interface ModelBreakdownRow {
  model: string;
  requests: number;
  tokens: number;
  cost: number;
  latency: number;
  errorRate: number;
}

interface RequestLogRow {
  id: string;
  prompt: string;
  model: string;
  latency: number;
  status: 'ok' | 'retry' | 'error';
  requestedAt: string;
}

interface SummaryStat {
  label: string;
  value: number;
  delta: string;
  unit?: string;
}

const SUMMARY_STATS: SummaryStat[] = [
  { label: 'Total Tokens Today', value: 482_190, delta: '+6.4%' },
  { label: 'Estimated Cost', value: 1843.2, unit: '$', delta: '-2.1%' },
  { label: 'Avg Latency', value: 1.82, unit: 's', delta: '-0.4%' },
  { label: 'Error Rate', value: 1.7, unit: '%', delta: '+0.3%' },
];

const MODEL_BREAKDOWN: ModelBreakdownRow[] = [
  { model: 'gpt-5.5', requests: 422, tokens: 210_430, cost: 812.44, latency: 1.52, errorRate: 0.7 },
  { model: 'gpt-5.4', requests: 318, tokens: 158_380, cost: 541.19, latency: 1.88, errorRate: 1.1 },
  { model: 'gpt-5.4-mini', requests: 611, tokens: 89_520, cost: 183.26, latency: 0.74, errorRate: 0.4 },
  { model: 'gpt-5.3-codex', requests: 204, tokens: 23_860, cost: 306.31, latency: 2.96, errorRate: 3.2 },
];

const REQUEST_LOG: RequestLogRow[] = [
  {
    id: 'req-1',
    prompt: 'Summarize the operator-visible runtime anomalies from the last worker cycle and flag any conflicts with board approval state.',
    model: 'gpt-5.5',
    latency: 1.44,
    status: 'ok',
    requestedAt: '2026-04-30T17:52:00.000Z',
  },
  {
    id: 'req-2',
    prompt: 'Draft a recovery action plan for command-center API retries exceeding the error budget in the last ten minutes.',
    model: 'gpt-5.4',
    latency: 2.18,
    status: 'retry',
    requestedAt: '2026-04-30T17:44:00.000Z',
  },
  {
    id: 'req-3',
    prompt: 'Compare the latest score attribution deltas with the review queue outcomes and surface the three biggest disagreement clusters.',
    model: 'gpt-5.3-codex',
    latency: 3.61,
    status: 'error',
    requestedAt: '2026-04-30T17:40:00.000Z',
  },
  {
    id: 'req-4',
    prompt: 'Generate a concise operator handoff summary for the picks that were posted after a manual board override.',
    model: 'gpt-5.4-mini',
    latency: 0.62,
    status: 'ok',
    requestedAt: '2026-04-30T17:38:00.000Z',
  },
];

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatLatency(value: number) {
  return `${value.toFixed(2)}s`;
}

function truncatePrompt(prompt: string) {
  return prompt.length > 92 ? `${prompt.slice(0, 92)}...` : prompt;
}

export function sortModelBreakdown(rows: ModelBreakdownRow[], key: SortKey, direction: 'asc' | 'desc') {
  const sorted = [...rows].sort((left, right) => {
    const leftValue = left[key];
    const rightValue = right[key];

    if (typeof leftValue === 'string' && typeof rightValue === 'string') {
      return leftValue.localeCompare(rightValue);
    }

    return Number(leftValue) - Number(rightValue);
  });

  return direction === 'asc' ? sorted : sorted.reverse();
}

export function filterRequestLog(rows: RequestLogRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    row.model.toLowerCase().includes(normalized) ||
    row.status.toLowerCase().includes(normalized) ||
    row.prompt.toLowerCase().includes(normalized),
  );
}

function statusTone(status: RequestLogRow['status']) {
  if (status === 'error') return 'text-rose-300';
  if (status === 'retry') return 'text-amber-200';
  return 'text-emerald-300';
}

function SortButton({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-2 py-2 pr-4 text-xs uppercase tracking-[0.18em] ${active ? 'text-[var(--cc-text-primary)]' : 'text-[var(--cc-text-muted)]'}`}
    >
      {label}
      <span className="text-[10px]">{active ? (direction === 'asc' ? '↑' : '↓') : '↕'}</span>
    </button>
  );
}

export function IntelligenceWorkspace() {
  const [sortKey, setSortKey] = useState<SortKey>('requests');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);

  const sortedModels = useMemo(
    () => sortModelBreakdown(MODEL_BREAKDOWN, sortKey, sortDirection),
    [sortDirection, sortKey],
  );
  const filteredRequests = useMemo(() => filterRequestLog(REQUEST_LOG, search), [search]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection(key === 'model' ? 'asc' : 'desc');
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {SUMMARY_STATS.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            delta={stat.delta}
            unit={stat.unit}
          />
        ))}
      </section>

      <Card title="Model Breakdown">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-white/8">
              <tr>
                <th><SortButton label="Model" sortKey="model" activeKey={sortKey} direction={sortDirection} onSort={onSort} /></th>
                <th><SortButton label="Requests" sortKey="requests" activeKey={sortKey} direction={sortDirection} onSort={onSort} /></th>
                <th><SortButton label="Tokens" sortKey="tokens" activeKey={sortKey} direction={sortDirection} onSort={onSort} /></th>
                <th><SortButton label="Cost" sortKey="cost" activeKey={sortKey} direction={sortDirection} onSort={onSort} /></th>
                <th><SortButton label="Avg Latency" sortKey="latency" activeKey={sortKey} direction={sortDirection} onSort={onSort} /></th>
                <th><SortButton label="Error %" sortKey="errorRate" activeKey={sortKey} direction={sortDirection} onSort={onSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map((row) => (
                <tr key={row.model} className="border-b border-white/5 text-sm last:border-b-0">
                  <td className="py-3 pr-4 font-medium text-[var(--cc-text-primary)]">{row.model}</td>
                  <td className="py-3 pr-4 text-[var(--cc-text-secondary)]">{row.requests}</td>
                  <td className="py-3 pr-4 text-[var(--cc-text-secondary)]">{formatCompactNumber(row.tokens)}</td>
                  <td className="py-3 pr-4 text-[var(--cc-text-secondary)]">{formatMoney(row.cost)}</td>
                  <td className="py-3 pr-4 text-[var(--cc-text-secondary)]">{formatLatency(row.latency)}</td>
                  <td className="py-3 text-[var(--cc-text-secondary)]">{row.errorRate.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Request Log">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search prompt, model, or status"
            className="w-full rounded-2xl border border-[var(--cc-border-subtle)] bg-white/[0.03] px-4 py-3 text-sm text-[var(--cc-text-primary)] outline-none transition-colors focus:border-[var(--cc-accent)] md:max-w-sm"
          />
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--cc-text-muted)]">
            {filteredRequests.length} visible request{filteredRequests.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="space-y-3">
          {filteredRequests.map((row) => {
            const expanded = expandedRequestId === row.id;

            return (
              <div key={row.id} className="rounded-[20px] border border-white/6 bg-white/[0.02] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setExpandedRequestId((current) => current === row.id ? null : row.id)}
                      className="text-left text-sm leading-6 text-[var(--cc-text-primary)]"
                    >
                      {expanded ? row.prompt : truncatePrompt(row.prompt)}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
                    <span>{row.model}</span>
                    <span>{formatLatency(row.latency)}</span>
                    <span className={statusTone(row.status)}>{row.status}</span>
                    <span>{new Date(row.requestedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredRequests.length === 0 ? (
          <div className="mt-4 rounded-[20px] border border-dashed border-white/10 p-6 text-sm text-[var(--cc-text-secondary)]">
            No request logs match the current search.
          </div>
        ) : null}
      </Card>
    </div>
  );
}
