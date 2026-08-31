'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getWorkspaceRoutes, isCommandCenterRouteActive } from '@/lib/command-center-nav';

export function IntelligenceWorkspaceNav() {
  const pathname = usePathname();
  const tabs = getWorkspaceRoutes('intelligence');

  return (
    <div className="mb-6 border-b border-gray-800">
      <p className="mb-3 text-xs font-medium uppercase tracking-widest text-gray-500">
        Intelligence
      </p>
      <nav
        className="flex gap-1 overflow-x-auto pb-px"
        aria-label="Intelligence workspace tabs"
      >
        {tabs.map((tab) => {
          const isActive = isCommandCenterRouteActive(tab, pathname);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-b-2 border-blue-500 text-white'
                  : 'border-b-2 border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.label}
              {tab.classification !== 'authoritative' && (
                <span className="rounded bg-gray-800 px-1 py-0.5 text-[10px] text-gray-500">
                  {tab.classification}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
