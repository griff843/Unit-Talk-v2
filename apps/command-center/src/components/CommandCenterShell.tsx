'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { SidebarHealthStatus, SidebarNavItem, WorkspaceSidebar } from '@/components/WorkspaceSidebar';

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

const NAV_ITEMS: SidebarNavItem[] = [
  { href: '/', label: 'Overview', icon: icon(<path d="M3 12h18M3 6h18M3 18h18" />), match: ['/'] },
  { href: '/picks', label: 'Picks', icon: icon(<><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></>), match: ['/picks', '/picks-list'] },
  { href: '/pipeline', label: 'Pipeline', icon: icon(<><path d="M4 7h16" /><path d="M7 12h10" /><path d="M10 17h4" /></>), match: ['/pipeline', '/review', '/decision', '/decisions', '/held'] },
  { href: '/events', label: 'Events', icon: icon(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>), match: ['/events', '/research', '/research/matchups', '/research/players', '/research/props', '/research/lines', '/research/hit-rate'] },
  { href: '/api-health', label: 'API Health', icon: icon(<><path d="M3 12h4l3-9 4 18 3-9h4" /></>), match: ['/api-health', '/burn-in', '/model-health'] },
  { href: '/agents', label: 'Agents', icon: icon(<><path d="M12 2a3 3 0 0 0-3 3v2H7a2 2 0 0 0-2 2v3a7 7 0 1 0 14 0V9a2 2 0 0 0-2-2h-2V5a3 3 0 0 0-3-3Z" /></>), match: ['/agents', '/interventions'] },
  { href: '/intelligence', label: 'Intelligence', icon: icon(<><path d="m12 3 2.5 5 5.5.8-4 3.9.9 5.5L12 16l-4.9 2.2.9-5.5-4-3.9 5.5-.8L12 3Z" /></>), match: ['/intelligence', '/performance'] },
  { href: '/ops', label: 'Ops', icon: icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.82-.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H4a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.6-1l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1 .6h.09a1.7 1.7 0 0 0 1.1-.4l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c0 .38.14.74.4 1H20a2 2 0 1 1 0 4h-.09c-.26.26-.4.62-.4 1Z" /></>), match: ['/ops', '/exceptions'] },
];

function titleize(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function resolveActiveRoute(pathname: string) {
  for (const item of NAV_ITEMS) {
    const patterns = item.match ?? [item.href];
    if (patterns.some((pattern) => pathname === pattern || pathname.startsWith(pattern + '/'))) {
      return item.href;
    }
  }
  return '/';
}

function resolveHealthStatus(pathname: string): SidebarHealthStatus {
  if (pathname.startsWith('/exceptions') || pathname.startsWith('/held')) {
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
  const activeItem = NAV_ITEMS.find((item) => item.href === activeRoute) ?? NAV_ITEMS[0];
  const leaf = segments.length > 0 ? titleize(segments[segments.length - 1]!) : activeItem.label;

  return {
    activeRoute,
    breadcrumb: ['Command Center', activeItem.label, ...(leaf !== activeItem.label ? [leaf] : [])],
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
        navItems={NAV_ITEMS}
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
