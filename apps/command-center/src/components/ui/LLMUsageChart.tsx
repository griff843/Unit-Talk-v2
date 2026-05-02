import React from 'react';
export interface LlmUsageRow {
  model: string;
  requests: number;
  tokens: number;
  cost: number;
  latency: number;
  errorRate: number;
}

function maxValue(rows: LlmUsageRow[]) {
  return rows.reduce((current, row) => Math.max(current, row.tokens), 0);
}

export function LLMUsageChart({ rows }: { rows: LlmUsageRow[] }) {
  const ceiling = Math.max(1, maxValue(rows));

  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const width = `${Math.max(10, Math.round((row.tokens / ceiling) * 100))}%`;
        return (
          <div key={row.model} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--cc-text-primary)]">{row.model}</div>
                <div className="text-xs uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
                  {row.requests} requests · {row.latency} ms · {row.errorRate.toFixed(1)}% errors
                </div>
              </div>
              <div className="text-right text-sm text-[var(--cc-text-secondary)]">
                <div>{row.tokens.toLocaleString()} tokens</div>
                <div>${row.cost.toFixed(2)}</div>
              </div>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,rgba(180,155,255,0.35),rgba(180,155,255,0.9))] transition-[width] duration-[var(--motion-slow)]"
                style={{ width }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
