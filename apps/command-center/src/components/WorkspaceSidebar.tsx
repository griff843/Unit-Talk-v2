'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type SecondaryNavItem = {
  href: string;
  label: string;
  badge?: string;
  disabled?: boolean;
};

type Workspace = {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Routes that belong to this workspace — used to detect active workspace */
  routes: string[];
  secondaryNav: SecondaryNavItem[];
};

const IconResearch = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconDecision = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const IconOperations = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    <path d="M4.93 4.93a10 10 0 0 0 0 14.14" />
  </svg>
);

const IconIntelligence = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const WORKSPACES: Workspace[] = [
  {
    id: 'research',
    label: 'Research',
    icon: <IconResearch />,
    routes: ['/research'],
    secondaryNav: [
      { href: '/research/props', label: 'Prop Explorer' },
      { href: '/research/lines', label: 'Line-Shopper' },
      { href: '/research/players', label: 'Player Card' },
      { href: '/research/matchups', label: 'Matchup Card' },
      { href: '/research/hit-rate', label: 'Hit Rate', badge: 'shell' },
      { href: '/research/trends', label: 'Trend Filters', disabled: true },
    ],
  },
  {
    id: 'decision',
    label: 'Decision',
    icon: <IconDecision />,
    routes: ['/decision', '/decisions'],
    secondaryNav: [
      { href: '/decision/board-queue', label: 'Board Queue' },
      { href: '/decision/scores', label: 'Score Breakdown' },
      { href: '/decision/preview', label: 'Promotion Preview' },
      { href: '/decision/routing', label: 'Routing Preview' },
      { href: '/decision/board', label: 'Board Saturation' },
      { href: '/decisions', label: 'Review History' },
      { href: '/decision/hedges', label: 'Hedge Overlays', badge: 'shell' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: <IconOperations />,
    routes: ['/', '/burn-in', '/pipeline', '/picks-list', '/picks', '/review', '/held', '/exceptions', '/events', '/interventions'],
    secondaryNav: [
      { href: '/', label: 'Dashboard' },
      { href: '/burn-in', label: 'Readiness / Health Scorecard' },
      { href: '/pipeline', label: 'Pipeline Health' },
      { href: '/picks-list', label: 'Picks List' },
      { href: '/review', label: 'Review Queue' },
      { href: '/held', label: 'Held Picks' },
      { href: '/exceptions', label: 'Exceptions' },
      { href: '/events', label: 'Events Stream' },
      { href: '/interventions', label: 'Intervention Log' },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    icon: <IconIntelligence />,
    routes: ['/performance', '/intelligence'],
    secondaryNav: [
      { href: '/performance', label: 'Performance' },
      { href: '/intelligence', label: 'Form Windows' },
      { href: '/intelligence/attribution', label: 'Governed Attribution' },
      { href: '/intelligence/calibration', label: 'Model Feedback' },
      { href: '/intelligence/roi', label: 'ROI Overview', badge: 'shell' },
    ],
  },
];

function resolveActiveWorkspace(pathname: string): string {
  // Exact root match belongs to Operations
  if (pathname === '/') return 'operations';

  // Check each workspace's routes for a prefix match, longest match wins
  let bestMatch = { workspaceId: 'operations', matchLength: 0 };

  for (const workspace of WORKSPACES) {
    for (const route of workspace.routes) {
      if (route === '/') continue; // root handled above
      if (pathname === route || pathname.startsWith(route + '/')) {
        if (route.length > bestMatch.matchLength) {
          bestMatch = { workspaceId: workspace.id, matchLength: route.length };
        }
      }
    }
  }

  return bestMatch.workspaceId;
}

export function WorkspaceSidebar() {
  const pathname = usePathname();
  const activeWorkspaceId = resolveActiveWorkspace(pathname);

  return (
    <aside className="flex w-[200px] flex-shrink-0 flex-col border-r border-gray-800 bg-gray-950 min-h-screen sticky top-0 overflow-y-auto">
      {/* Brand */}
      <div className="border-b border-gray-800 px-4 py-4">
        <div className="text-sm font-bold tracking-tight text-white">Unit Talk</div>
        <div className="text-xs font-medium uppercase tracking-widest text-gray-500">Command Center</div>
      </div>

      {/* Workspace switcher */}
      <nav className="flex flex-col gap-0.5 p-2 flex-1" aria-label="Workspaces">
        {WORKSPACES.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;

          return (
            <div key={workspace.id}>
              {/* Workspace top-level item */}
              <Link
                href={
                  workspace.id === 'operations'
                    ? '/'
                    : workspace.id === 'research'
                      ? '/research'
                      : workspace.id === 'decision'
                        ? '/decision'
                        : '/intelligence'
                }
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-800 font-medium text-white'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className={isActive ? 'text-white' : 'text-gray-500'}>{workspace.icon}</span>
                {workspace.label}
              </Link>

              {/* Secondary nav — only visible when this workspace is active */}
              {isActive && (
                <div className="mt-0.5 mb-1 flex flex-col gap-0.5 pl-4">
                  {workspace.secondaryNav.map((item) => {
                    const isSecondaryActive = item.href === '/'
                      ? pathname === '/'
                      : pathname === item.href || pathname.startsWith(item.href + '/');

                    if (item.disabled) {
                      return (
                        <span
                          key={item.href}
                          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-gray-600 cursor-not-allowed select-none"
                          title="Coming soon — requires stat history ingest"
                        >
                          {item.label}
                          <span className="rounded bg-gray-800 px-1 py-0.5 text-[10px] text-gray-500">soon</span>
                        </span>
                      );
                    }

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                          isSecondaryActive
                            ? 'bg-gray-700 font-medium text-white'
                            : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                        }`}
                      >
                        {item.label}
                        {item.badge && (
                          <span className="rounded bg-gray-800 px-1 py-0.5 text-[10px] text-gray-500">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
