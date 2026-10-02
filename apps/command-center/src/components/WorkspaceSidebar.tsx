'use client';

import Link from '@/components/OperatorLink';
import { useState } from 'react';

export type SidebarNavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  match?: string[];
  unreadCount?: number;
  active?: boolean;
  unavailable?: boolean;
  workspace?: boolean;
};

export type SidebarNavGroup = {
  label: string;
  items: SidebarNavItem[];
};

export type SidebarHealthStatus = 'healthy' | 'warning' | 'critical';

type WorkspaceSidebarProps = {
  actor?: string;
  canSignOut?: boolean;
  navGroups: SidebarNavGroup[];
  activeRoute: string;
  healthStatus: SidebarHealthStatus;
  healthLabel?: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
  onCloseMobile: () => void;
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function LogoMark() {
  return (
    <svg className="h-10 w-10" viewBox="0 0 1000 800" role="img" aria-label="Unit Talk">
      <path fill="#ffffff" d="M110 80h175v385c0 71 44 115 115 115h105V335h175v385H395c-176 0-285-109-285-285V80z"/>
        <path fill="#ffffff" d="M355 80h535v175H710v465H535V255H355V80z"/>
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {collapsed ? <path d="m9 18 6-6-6-6" /> : <path d="m15 18-6-6 6-6" />}
    </svg>
  );
}

function HealthPulse({ status }: { status: SidebarHealthStatus }) {
  const tone =
    status === 'healthy'
      ? 'bg-[var(--cc-success)]'
      : status === 'warning'
        ? 'bg-[var(--cc-warning)]'
        : 'bg-[var(--cc-danger)]';

  return (
    <div className="relative flex h-3 w-3 items-center justify-center" aria-hidden="true">
      <span className={cx('absolute h-3 w-3 rounded-full opacity-75 animate-[cc-pulse_2s_infinite]', tone)} />
      <span className={cx('relative h-2.5 w-2.5 rounded-full border border-white/30', tone)} />
    </div>
  );
}

function NavItemIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex h-5 w-5 items-center justify-center">{children}</span>;
}

function BoundaryBadge({ collapsed, actor, canSignOut }: { collapsed: boolean; actor?: string; canSignOut?: boolean }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/session', { method: 'DELETE' });
      if (!response.ok) throw new Error('Sign-out refused');
      window.location.reload();
    } catch {
      setError('Could not sign out. Please try again.');
      setPending(false);
    }
  }
  return (
    <div
      className={cx(
        'cc-surface mx-3 mb-3 flex items-center gap-3 overflow-hidden px-3 py-3 transition-[padding,gap] duration-[var(--motion-base)] ease-[var(--ease-out)]',
        collapsed && 'justify-center px-0',
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--cc-border-strong)] bg-[var(--cc-bg-surface-elevated)] text-sm font-semibold text-[var(--cc-text-secondary)]">
        IN
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <div className="break-all text-sm font-medium text-[var(--cc-text-primary)]" data-testid="operator-identity">{actor ?? 'Identity unavailable'}</div>
          <div className="mt-1 inline-flex items-center rounded-full border border-[var(--cc-border-strong)] px-2 py-0.5 text-[10px] uppercase tracking-[0.24em] text-[var(--cc-text-muted)]">
            {actor === 'command-center:dev-bypass' ? 'Unauthenticated development' : actor ? 'Authenticated operator' : 'Identity unavailable'}
          </div>
          {canSignOut && <button type="button" disabled={pending} onClick={signOut} className="mt-2 block rounded px-1 py-2 text-xs text-[var(--cc-text-secondary)] hover:text-white">{pending ? 'Signing out…' : 'Sign out'}</button>}
          {error && <p role="alert" className="mt-1 text-xs text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function WorkspaceSidebar({
  actor,
  canSignOut,
  navGroups,
  activeRoute,
  healthStatus,
  healthLabel,
  collapsed,
  mobileOpen,
  onToggle,
  onCloseMobile,
}: WorkspaceSidebarProps) {
  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm md:hidden"
          aria-label="Close navigation"
          onClick={onCloseMobile}
        />
      )}
      <aside
        className={cx(
          'cc-sidebar fixed inset-y-0 left-0 z-40 flex h-screen w-72 shrink-0 flex-col border-r border-[var(--cc-border-subtle)] transition-transform duration-[200ms] ease-[var(--ease-out)] md:sticky md:top-0 md:z-auto md:translate-x-0 md:transition-[width]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'md:w-16' : 'md:w-60',
        )}
      >
      <div className={cx('flex items-center gap-3 px-3 py-4', collapsed && 'justify-center px-2')}>
        <LogoMark />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <svg className="h-6 w-full max-w-[120px]" viewBox="0 0 1500 320" aria-hidden="true">
              <g fill="#ffffff" transform="translate(0,-20)">
<path d="m 131.37207,252.87109 c 45.33936,0 75.00732,-26.19873 75.00732,-65.55664 V 71.75293 h -41.98974 v 112.09228 c 0,18.90137 -13.15918,32.41944 -33.01758,32.41944 -19.73877,0 -33.137207,-13.6377 -33.137207,-32.41944 V 71.75293 H 56.245117 v 115.56152 c 0,39.35791 29.54834,65.55664 75.126953,65.55664 z M 239.10889,250 h 43.0664 v -74.28955 c 0,-7.41699 -0.11963,-22.13135 -0.71777,-39.47754 9.21143,16.74805 17.70508,31.34277 22.84912,39.59717 L 350.72266,250 h 44.62158 V 71.75293 h -43.06641 v 77.28027 c 0,8.01514 0.23926,22.49024 0.59815,36.60645 -6.93848,-12.80029 -14.4751,-26.19873 -18.66211,-32.89795 L 283.61084,71.75293 H 239.10889 Z M 471.37939,71.75293 h -43.0664 V 250 h 43.0664 z m 26.50879,36.60645 h 52.51709 V 250 h 43.06641 V 108.35938 h 52.39746 V 71.75293 H 497.88818 Z m 226.95801,0 h 52.51709 V 250 h 43.06641 V 108.35938 h 52.39746 V 71.75293 H 724.84619 Z"/>
<path d="M920 250 L990 70 H1048 L1118 250 H1065 L1019 118 L973 250 Z"/>
<path d="m 1151.4844,250 h 122.0215 v -36.60645 h -78.9551 V 71.75293 h -43.0664 z m 148.5302,0 h 43.0665 V 204.66064 L 1365.6909,177.62451 1411.5088,250 h 49.2871 l -66.9922,-101.44531 64.48,-76.80176 h -50.603 l -39.8365,48.80859 c -8.2544,10.28809 -16.5088,20.45655 -24.7631,30.74463 V 71.75293 h -43.0665 z"/>
</g>
            </svg>
            <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--cc-text-muted)]">Command Center</div>
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="cc-icon-button hidden md:inline-flex"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-pressed={collapsed}
        >
          <CollapseIcon collapsed={collapsed} />
        </button>
      </div>

      <div className={cx('mx-3 mb-4 flex items-center rounded-2xl border border-[var(--cc-border-subtle)] bg-[var(--cc-bg-surface-elevated)] px-3 py-3', collapsed && 'mx-2 justify-center px-0')}>
        <HealthPulse status={healthStatus} />
        {!collapsed && (
          <div className="ml-3 min-w-0">
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--cc-text-muted)]">API Health</div>
            <div className="text-sm text-[var(--cc-text-primary)]">{healthLabel ?? healthStatus}</div>
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-16" aria-label="Primary">
        {navGroups.map((group) => (
        <div key={group.label} className="mb-2">
          {!collapsed && (
            <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--cc-text-muted)]">
              {group.label}
            </div>
          )}
        <ul className="space-y-0.5">
          {group.items.map((item) => {
            const isActive = item.active ?? activeRoute === item.href;
            return (
              <li key={item.href}>
                {item.unavailable ? (
                  <span aria-disabled="true" className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm text-[var(--cc-text-muted)]" title={`${item.label} is planned; this workspace is not yet available.`}>
                    <NavItemIcon>{item.icon}</NavItemIcon>
                    {!collapsed && <><span className="flex-1">{item.label}</span><span className="text-[10px]">Future</span></>}
                  </span>
                ) : (
                <Link
                  href={item.href}
                  className={cx(
                    'group relative flex items-center rounded-2xl px-3 py-2 text-sm transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)]',
                    collapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-[color-mix(in_srgb,var(--cc-accent)_14%,transparent)] text-[var(--cc-text-primary)]'
                      : 'text-[var(--cc-text-secondary)] hover:bg-[var(--cc-bg-surface-hover)] hover:text-[var(--cc-text-primary)]',
                  )}
                  aria-current={isActive ? item.workspace ? 'location' : 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  <span
                    className={cx(
                      'absolute left-0 top-2 bottom-2 rounded-r-full transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-out)]',
                      collapsed ? 'w-0' : 'w-1',
                      isActive ? 'bg-violet-400 opacity-100' : 'opacity-0',
                    )}
                  />
                  <NavItemIcon>{item.icon}</NavItemIcon>
                  {!collapsed && <span className="ml-3 flex-1">{item.label}</span>}
                  {!collapsed && typeof item.unreadCount === 'number' && item.unreadCount > 0 && (
                    <span className="cc-badge rounded-full px-2 py-0.5 text-[10px]">{item.unreadCount}</span>
                  )}
                </Link>
                )}
              </li>
            );
          })}
        </ul>
        </div>
        ))}
      </nav>

      <BoundaryBadge collapsed={collapsed} actor={actor} canSignOut={canSignOut} />
      </aside>
    </>
  );
}
