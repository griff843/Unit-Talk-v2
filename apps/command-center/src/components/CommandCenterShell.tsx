'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { SidebarHealthStatus, SidebarNavGroup, SidebarNavItem, WorkspaceSidebar } from '@/components/WorkspaceSidebar';

type CommandCenterShellProps = {
  children: React.ReactNode;
};

function icon(path: React.ReactNode) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {path}
    </svg>
  );
}

const dot = icon(<circle cx="12" cy="12" r="4" />);

const NAV_GROUPS: SidebarNavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/', label: 'Executive Overview', icon: icon(<path d="M3 12h18M3 6h18M3 18h18" />), match: ['/'] },
      { href: '/fire-board', label: 'Fire Board', icon: icon(<path d="M12 2c1 4-4 5-4 10a4 4 0 0 0 8 0c0-2-1-3-1-5 3 2 5 4 5 7a8 8 0 1 1-16 0c0-6 7-8 8-12Z" />), match: ['/fire-board'] },
      { href: '/pipeline', label: "Today's Action", icon: icon(<><path d="M4 7h16" /><path d="M7 12h10" /><path d="M10 17h4" /></>), match: ['/pipeline', '/picks', '/picks-list', '/events'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/api-health', label: 'System Health', icon: icon(<path d="M3 12h4l3-9 4 18 3-9h4" />), match: ['/api-health', '/burn-in', '/model-health', '/runtime-dashboard', '/ops', '/agents'] },
      { href: '/operations/outbox', label: 'Dispatch / Outbox', icon: icon(<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></>), match: ['/operations/outbox'] },
      { href: '/operations/approvals', label: 'Approvals', icon: icon(<><path d="M20 6 9 17l-5-5" /></>), match: ['/operations/approvals', '/held', '/decisions'] },
      { href: '/operations/governance', label: 'Governance', icon: icon(<><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>), match: ['/operations/governance'] },
      { href: '/operations/discord', label: 'Discord Control', icon: icon(<><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><path d="M8 17c2.5 1.3 5.5 1.3 8 0" /><path d="M19 5c-1.5-1-3.5-1.5-5-1.5h-4C8.5 3.5 6.5 4 5 5 3 8 2.5 12 3 16c1.7 1.3 3.5 2 5 2l1-2" /><path d="M15 16l1 2c1.5 0 3.3-.7 5-2 .5-4 0-8-2-11" /></>), match: ['/operations/discord'] },
      { href: '/operations/results', label: 'Results Ops', icon: icon(<><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></>), match: ['/operations/results', '/exceptions', '/interventions'] },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { href: '/research/lines', label: 'Odds Board', icon: dot, match: ['/research/lines'] },
      { href: '/research/props', label: 'Props Explorer', icon: dot, match: ['/research/props'] },
      { href: '/intel/ev-feed', label: 'EV Feed', icon: dot, match: ['/intel/ev-feed'] },
      { href: '/intel/arbitrage', label: 'Arbitrage Finder', icon: dot, match: ['/intel/arbitrage'] },
      { href: '/intel/middles', label: 'Middle Finder', icon: dot, match: ['/intel/middles'] },
      { href: '/intel/boosts', label: 'Boost Analyzer', icon: dot, match: ['/intel/boosts'] },
      { href: '/intel/sharp-books', label: 'Sharp Book Compare', icon: dot, match: ['/intel/sharp-books'] },
      { href: '/intel/line-movement', label: 'Line Movement', icon: dot, match: ['/intel/line-movement'] },
      { href: '/research/players', label: 'Player Research', icon: dot, match: ['/research/players'] },
      { href: '/intel/teams', label: 'Team Research', icon: dot, match: ['/intel/teams', '/research/matchups'] },
      { href: '/intel/injuries', label: 'Injury Monitor', icon: dot, match: ['/intel/injuries'] },
      { href: '/research/trends', label: 'Trend Explorer', icon: dot, match: ['/research/trends', '/research/hit-rate', '/intelligence', '/performance', '/research'] },
      { href: '/intel/alerts', label: 'Alert Builder', icon: dot, match: ['/intel/alerts'] },
    ],
  },
  {
    label: 'Execution',
    items: [
      { href: '/execution/pick-builder', label: 'Pick Builder', icon: icon(<><path d="M12 5v14" /><path d="M5 12h14" /></>), match: ['/execution/pick-builder'] },
      { href: '/review', label: 'Review Queue', icon: icon(<><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></>), match: ['/review', '/decision'] },
      { href: '/execution/discord-preview', label: 'Discord Preview', icon: icon(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 15h6" /><path d="M7 11h10" /></>), match: ['/execution/discord-preview'] },
      { href: '/execution/scheduled', label: 'Scheduled Dispatch', icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>), match: ['/execution/scheduled'] },
      { href: '/execution/results', label: 'Results Tracking', icon: icon(<><path d="M9 11l3 3 8-8" /><path d="M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" /></>), match: ['/execution/results'] },
    ],
  },
];

const ALL_NAV_ITEMS: SidebarNavItem[] = NAV_GROUPS.flatMap((group) => group.items);

function titleize(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function resolveActiveRoute(pathname: string) {
  let best: { href: string; length: number } | null = null;
  for (const item of ALL_NAV_ITEMS) {
    const patterns = item.match ?? [item.href];
    for (const pattern of patterns) {
      const matches = pathname === pattern || (pattern !== '/' && pathname.startsWith(pattern + '/'));
      if (matches && (!best || pattern.length > best.length)) {
        best = { href: item.href, length: pattern.length };
      }
    }
  }
  return best?.href ?? '/';
}

function resolveHealthStatus(pathname: string): SidebarHealthStatus {
  if (pathname.startsWith('/exceptions') || pathname.startsWith('/held') || pathname.startsWith('/fire-board')) {
    return 'warning';
  }
  if (pathname.startsWith('/burn-in')) {
    return 'critical';
  }
  return 'healthy';
}

function resolveChrome(pathname: string) {
  const segments = pathname === '/' ? [] : pathname.split('/').filter(Boolean);
  const activeRoute = resolveActiveRoute(pathname);
  const activeItem = ALL_NAV_ITEMS.find((item) => item.href === activeRoute) ?? ALL_NAV_ITEMS[0];
  const activeGroup = NAV_GROUPS.find((group) => group.items.some((item) => item.href === activeRoute));
  const leaf = segments.length > 0 ? titleize(segments[segments.length - 1]!) : activeItem.label;

  return {
    activeRoute,
    breadcrumb: [
      'Command Center',
      ...(activeGroup ? [activeGroup.label] : []),
      activeItem.label,
      ...(leaf !== activeItem.label ? [leaf] : []),
    ],
    title: leaf,
    healthStatus: resolveHealthStatus(pathname),
  };
}

export function CommandCenterShell({ children }: CommandCenterShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const chrome = resolveChrome(pathname);

  return (
    <>
      <WorkspaceSidebar
        navGroups={NAV_GROUPS}
        activeRoute={chrome.activeRoute}
        healthStatus={chrome.healthStatus}
        collapsed={collapsed}
        onToggle={() => setCollapsed((current) => !current)}
      />
      <main id="main-content" className="flex-1 min-w-0 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <TopBar title={chrome.title} breadcrumb={chrome.breadcrumb} />
        {children}
      </main>
    </>
  );
}
