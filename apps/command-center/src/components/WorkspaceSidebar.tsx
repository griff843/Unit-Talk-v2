'use client';

import Link from 'next/link';

export type SidebarNavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  match?: string[];
  unreadCount?: number;
};

export type SidebarHealthStatus = 'healthy' | 'warning' | 'critical';

type WorkspaceSidebarProps = {
  navItems: SidebarNavItem[];
  activeRoute: string;
  healthStatus: SidebarHealthStatus;
  collapsed: boolean;
  onToggle: () => void;
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function LogoMark() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--cc-accent),#7c3aed)] text-sm font-semibold text-white shadow-[0_12px_30px_-14px_rgba(61,139,255,0.8)]">
      UT
    </div>
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

function OperatorBadge({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cx(
        'cc-surface mx-3 mb-3 flex items-center gap-3 overflow-hidden px-3 py-3 transition-[padding,gap] duration-[var(--motion-base)] ease-[var(--ease-out)]',
        collapsed && 'justify-center px-0',
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f97316,#fb7185)] text-sm font-semibold text-white">
        OA
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--cc-text-primary)]">Operator Alpha</div>
          <div className="mt-1 inline-flex items-center rounded-full border border-[var(--cc-border-strong)] px-2 py-0.5 text-[10px] uppercase tracking-[0.24em] text-[var(--cc-text-muted)]">
            Runtime Lane
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkspaceSidebar({
  navItems,
  activeRoute,
  healthStatus,
  collapsed,
  onToggle,
}: WorkspaceSidebarProps) {
  return (
    <aside
      className={cx(
        'cc-sidebar sticky top-0 flex min-h-screen shrink-0 flex-col border-r border-[var(--cc-border-subtle)] transition-[width] duration-[200ms] ease-[var(--ease-out)]',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className={cx('flex items-center gap-3 px-3 py-4', collapsed && 'justify-center px-2')}>
        <LogoMark />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-[0.18em] text-[var(--cc-text-primary)]">UNIT TALK</div>
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
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--cc-text-muted)]">Global Health</div>
            <div className="text-sm text-[var(--cc-text-primary)]">{healthStatus}</div>
          </div>
        )}
      </div>

      <nav className="flex-1 px-2 pb-4" aria-label="Primary">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = activeRoute === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cx(
                    'group relative flex items-center rounded-2xl px-3 py-3 text-sm transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)]',
                    collapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-[color-mix(in_srgb,var(--cc-accent)_14%,transparent)] text-[var(--cc-text-primary)]'
                      : 'text-[var(--cc-text-secondary)] hover:bg-[var(--cc-bg-surface-hover)] hover:text-[var(--cc-text-primary)]',
                  )}
                  aria-current={isActive ? 'page' : undefined}
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
              </li>
            );
          })}
        </ul>
      </nav>

      <OperatorBadge collapsed={collapsed} />
    </aside>
  );
}
