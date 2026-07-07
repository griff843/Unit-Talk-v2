'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getPrimaryCommandCenterRoutes, isCommandCenterRouteActive } from '@/lib/command-center-nav';

export function NavLinks() {
  const pathname = usePathname();
  const navLinks = getPrimaryCommandCenterRoutes();

  return (
    <nav className="flex gap-1">
      {navLinks.map((link) => {
        const isActive = isCommandCenterRouteActive(link, pathname);

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
            {link.shortLabel}
          </Link>
        );
      })}
    </nav>
  );
}
