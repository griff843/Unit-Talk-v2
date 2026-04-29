'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type TabItem = {
  href: string;
  label: string;
  badge?: string;
};

const INTELLIGENCE_TABS: TabItem[] = [
  { href: '/performance', label: 'Performance' },
  { href: '/intelligence', label: 'Form Windows' },
  { href: '/intelligence/attribution', label: 'Governed Attribution' },
  { href: '/intelligence/calibration', label: 'Model Feedback' },
  { href: '/intelligence/roi', label: 'ROI Overview', badge: 'shell' },
];

export function IntelligenceWorkspaceNav() {
  const pathname = usePathname();

  return (
    <div className="mb-6 border-b border-gray-800">
      <p className="mb-3 text-xs font-medium uppercase tracking-widest text-gray-500">
        Intelligence
      </p>
      <nav
        className="flex gap-1 overflow-x-auto pb-px"
        aria-label="Intelligence workspace tabs"
      >
        {INTELLIGENCE_TABS.map((tab) => {
          // Exact match for top-level tabs to avoid /intelligence matching /intelligence/calibration
          const isActive =
            tab.href === '/intelligence' || tab.href === '/performance'
              ? pathname === tab.href
              : pathname === tab.href || pathname.startsWith(tab.href + '/');

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
              {tab.badge && (
                <span className="rounded bg-gray-800 px-1 py-0.5 text-[10px] text-gray-500">
                  {tab.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
