'use client';

import { useEffect, useMemo, useState } from 'react';

type TopBarProps = {
  title: string;
  breadcrumb: string[];
  lastUpdatedAt?: number;
};

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  );
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

export function TopBar({ title, breadcrumb, lastUpdatedAt = Date.now() }: TopBarProps) {
  const [now, setNow] = useState(Date.now());
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    const nextDark = root.dataset.theme !== 'light';
    setDark(nextDark);

    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const updatedLabel = useMemo(() => formatElapsed(now - lastUpdatedAt), [lastUpdatedAt, now]);

  const toggleTheme = () => {
    const root = document.documentElement;
    const nextDark = root.dataset.theme === 'light';
    root.dataset.theme = nextDark ? 'dark' : 'light';
    setDark(nextDark);
  };

  return (
    <header className="mb-6 flex flex-col gap-4 rounded-[28px] border border-[var(--cc-border-subtle)] bg-[color-mix(in_srgb,var(--cc-bg-surface)_92%,transparent)] px-5 py-4 backdrop-blur md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-[var(--cc-text-muted)]">
          {breadcrumb.map((crumb, index) => (
            <span key={`${crumb}-${index}`} className="inline-flex items-center gap-2">
              {index > 0 && <span className="text-[var(--cc-border-strong)]">/</span>}
              <span>{crumb}</span>
            </span>
          ))}
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--cc-text-primary)]">{title}</h1>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <div className="rounded-full border border-[var(--cc-border-subtle)] bg-[var(--cc-bg-surface-elevated)] px-3 py-2 text-xs text-[var(--cc-text-secondary)]">
          Updated {updatedLabel}
        </div>
        <button type="button" className="cc-icon-button relative" aria-label="Alerts">
          <BellIcon />
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--cc-danger)]" />
        </button>
        <button type="button" onClick={toggleTheme} className="cc-icon-button" aria-label="Toggle color theme">
          <ThemeIcon dark={dark} />
        </button>
      </div>
    </header>
  );
}
