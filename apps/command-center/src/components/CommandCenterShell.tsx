'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CommandPalette } from '@/components/CommandPalette';
import { TopBar } from '@/components/TopBar';
import { SidebarHealthStatus, SidebarNavGroup, WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import type { CommandEntry } from '@/lib/command-palette-model';
import {
  getPrimaryCommandCenterRoutes,
  getPrimaryRouteForPath,
  getRouteMeta,
  type CommandCenterPrimaryIcon,
  type CommandCenterRoute,
} from '@/lib/command-center-nav';

type CommandCenterShellProps = { children: React.ReactNode };

function icon(path: React.ReactNode) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {path}
    </svg>
  );
}

const PRIMARY_ICONS: Record<CommandCenterPrimaryIcon, React.ReactNode> = {
  overview: icon(<><path d="M4 5h16v14H4z" /><path d="M4 10h16" /><path d="M9 10v9" /></>),
  review: icon(<><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></>),
  picks: icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M9 4v16" /></>),
  settlement: icon(<><path d="M4 4h16v16H4z" /><path d="m8 12 2.5 2.5L16 9" /></>),
  exceptions: icon(<><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>),
  health: icon(<path d="M3 12h4l3-9 4 18 3-9h4" />),
};

function buildNavigation(): { groups: SidebarNavGroup[]; commands: CommandEntry[] } {
  const routes = getPrimaryCommandCenterRoutes();
  return {
    groups: [{
      label: 'Operator workflow',
      items: routes.map((routeEntry) => ({
        href: routeEntry.href,
        label: routeEntry.label,
        icon: PRIMARY_ICONS[routeEntry.primaryIcon!],
      })),
    }],
    commands: routes.map((routeEntry) => ({
      href: routeEntry.href,
      label: routeEntry.label,
      group: 'Operator workflow',
      keywords: [routeEntry.description],
    })),
  };
}

function titleize(pathname: string) {
  const segment = pathname.split('/').filter(Boolean).at(-1) ?? 'Overview';
  return segment.split('-').map((value) => value.charAt(0).toUpperCase() + value.slice(1)).join(' ');
}

function resolveChrome(pathname: string, routeEntry: CommandCenterRoute | null) {
  const primaryHref = getPrimaryRouteForPath(pathname);
  const primary = primaryHref ? getRouteMeta(primaryHref) : null;
  const title = routeEntry?.label ?? titleize(pathname);
  return {
    activeRoute: primaryHref ?? '',
    breadcrumb: ['Command Center', ...(primary && primary.href !== routeEntry?.href ? [primary.label] : []), title],
    title,
  };
}

function useGlobalHealth(): { status: SidebarHealthStatus; label: string; pending: boolean } {
  const [state, setState] = useState<{ status: SidebarHealthStatus; label: string }>({
    status: 'warning',
    label: 'checking…',
  });
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setPending(true);
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        const body = (await response.json()) as { status?: string };
        if (cancelled) return;
        const next = body.status === 'healthy'
          ? { status: 'healthy' as const, label: 'healthy' }
          : body.status === 'degraded'
            ? { status: 'warning' as const, label: 'degraded' }
            : body.status === 'down'
              ? { status: 'critical' as const, label: 'down' }
              : { status: 'warning' as const, label: 'unknown' };
        setState(next);
      } catch {
        if (!cancelled) setState({ status: 'warning', label: 'unavailable' });
      } finally {
        if (!cancelled) setPending(false);
      }
    };
    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return { ...state, pending };
}

function RouteDispositionNotice({ routeEntry }: { routeEntry: CommandCenterRoute | null }) {
  if (!routeEntry || routeEntry.classification === 'authoritative') return null;

  const tone = routeEntry.classification === 'degraded'
    ? 'border-amber-500/35 bg-amber-500/10 text-amber-100'
    : 'border-sky-500/25 bg-sky-500/10 text-sky-100';

  return (
    <aside className={`mb-6 rounded-2xl border px-4 py-3 ${tone}`} data-route-classification={routeEntry.classification}>
      <div className="text-xs font-semibold uppercase tracking-[0.2em]">{routeEntry.classification} surface</div>
      <p className="mt-1 text-sm opacity-90">{routeEntry.classificationReason}</p>
    </aside>
  );
}

export function CommandCenterShell({ children }: CommandCenterShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigation = useMemo(buildNavigation, []);
  const routeEntry = getRouteMeta(pathname);
  const chrome = resolveChrome(pathname, routeEntry);
  const health = useGlobalHealth();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <WorkspaceSidebar
        navGroups={navigation.groups}
        activeRoute={chrome.activeRoute}
        healthStatus={health.status}
        healthLabel={health.pending ? `${health.label} ·` : health.label}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggle={() => setCollapsed((current) => !current)}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <main id="main-content" className="min-w-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <TopBar
          title={chrome.title}
          breadcrumb={chrome.breadcrumb}
          onOpenNavigation={() => setMobileOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <RouteDispositionNotice routeEntry={routeEntry} />
        {children}
      </main>
      <CommandPalette entries={navigation.commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
