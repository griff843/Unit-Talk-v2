'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/picks-list', label: 'Picks' },
  { href: '/review', label: 'Review' },
  { href: '/held', label: 'Held' },
  { href: '/exceptions', label: 'Exceptions' },
  { href: '/performance', label: 'Performance' },
  { href: '/intelligence', label: 'Intelligence' },
  { href: '/decisions', label: 'Decisions' },
  { href: '/interventions', label: 'Audit' },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1">
      {NAV_LINKS.map((link) => {
        const isActive = link.href === '/'
          ? pathname === '/'
          : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              isActive
                ? 'bg-gray-800 text-white font-medium'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
