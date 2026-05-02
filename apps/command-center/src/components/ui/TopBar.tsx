import React from 'react';
import { CounterAnimation } from './CounterAnimation';

interface TopBarChip {
  label: string;
  value: string;
}

export interface TopBarProps {
  eyebrow: string;
  title: string;
  description: string;
  liveLabel: string;
  liveValue: number;
  chips?: TopBarChip[];
}

export function TopBar({ eyebrow, title, description, liveLabel, liveValue, chips = [] }: TopBarProps) {
  return (
    <section className="cc-topbar">
      <div className="space-y-4">
        <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--cc-text-muted)]">{eyebrow}</div>
        <div className="space-y-3">
          <h1 className="font-[family:var(--font-display)] text-4xl leading-none text-[var(--cc-text-primary)] sm:text-5xl">
            {title}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-[var(--cc-text-secondary)] sm:text-base">
            {description}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:items-end">
        <div className="rounded-[1.75rem] border border-white/10 bg-black/20 px-5 py-4 text-left shadow-[0_20px_40px_rgba(8,11,18,0.25)]">
          <div className="text-[10px] uppercase tracking-[0.32em] text-[var(--cc-text-muted)]">{liveLabel}</div>
          <div className="mt-3 flex items-end gap-3">
            <CounterAnimation
              value={liveValue}
              duration={360}
              className="font-[family:var(--font-display)] text-4xl tracking-[-0.08em] text-[var(--cc-text-primary)]"
            />
            <span className="rounded-full border border-[rgba(180,155,255,0.28)] bg-[rgba(180,155,255,0.12)] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[var(--status-info-fg)]">
              live
            </span>
          </div>
        </div>
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <div
                key={`${chip.label}-${chip.value}`}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs uppercase tracking-[0.18em] text-[var(--cc-text-secondary)]"
              >
                <span className="text-[var(--cc-text-muted)]">{chip.label}</span> {chip.value}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
