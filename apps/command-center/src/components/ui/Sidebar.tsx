'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { COMMAND_CENTER_ROUTES } from '@/lib/command-center-nav';

function RouteIcon({ label }: { label: string }) {
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cc-text-secondary)]">
      {label}
    </span>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-4 py-5">
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_top,rgba(180,155,255,0.45),rgba(180,155,255,0.05)_55%,transparent_70%)] ring-1 ring-white/10">
            <span className="text-sm font-semibold tracking-[0.28em] text-[var(--status-info-fg)]">UT</span>
          </div>
          {!collapsed ? (
            <div>
              <div className="font-[family:var(--font-display)] text-xl leading-none text-[var(--cc-text-primary)]">Unit Talk</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-[var(--cc-text-muted)]">Command Center</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="px-3 py-4">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="hidden w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs uppercase tracking-[0.24em] text-[var(--cc-text-secondary)] transition-colors hover:bg-white/[0.08] lg:flex"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3 pb-6" aria-label="Primary">
        {COMMAND_CENTER_ROUTES.map((route) => {
          const active = pathname === route.href;
          return (
            <Link
              key={route.href}
              href={route.href}
              onClick={() => setMobileOpen(false)}
              className={`group flex items-center gap-3 rounded-[1.4rem] px-3 py-3 transition-all duration-[var(--motion-base)] ${
                active
                  ? 'bg-[linear-gradient(135deg,rgba(109,86,255,0.18),rgba(246,247,251,0.05))] text-[var(--cc-text-primary)] ring-1 ring-[rgba(180,155,255,0.24)]'
                  : 'text-[var(--cc-text-secondary)] hover:bg-white/[0.05] hover:text-[var(--cc-text-primary)]'
              }`}
            >
              <RouteIcon label={route.shortLabel} />
              {!collapsed ? (
                <div className="min-w-0">
                  <div className="text-sm font-medium">{route.label}</div>
                  <div className="truncate text-xs text-[var(--cc-text-muted)]">{route.eyebrow}</div>
                </div>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {!collapsed ? (
        <div className="m-3 rounded-[1.6rem] border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-4">
          <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--cc-text-muted)]">Operating Mode</div>
          <div className="mt-2 font-[family:var(--font-display)] text-xl text-[var(--cc-text-primary)]">Night Shift</div>
          <p className="mt-2 text-sm text-[var(--cc-text-secondary)]">
            Tight, signal-first UI tuned for rapid operator scan speed.
          </p>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-[var(--surface-overlay)] text-[var(--cc-text-primary)] shadow-[0_12px_40px_rgba(11,15,25,0.32)] backdrop-blur lg:hidden"
        aria-label="Open navigation"
      >
        <span className="text-lg">+</span>
      </button>

      <aside
        className={`hidden min-h-screen border-r border-white/10 bg-[var(--surface-overlay)]/95 backdrop-blur lg:block ${
          collapsed ? 'w-20' : 'w-60'
        } transition-[width] duration-[var(--motion-slow)]`}
      >
        {nav}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <aside className="absolute inset-y-0 left-0 w-[18rem] border-r border-white/10 bg-[var(--surface-overlay)]">
            {nav}
          </aside>
        </div>
      ) : null}
    </>
  );
}
