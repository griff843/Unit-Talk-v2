import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Unit Talk — Command Center',
};

const NAV_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/picks-list', label: 'Picks' },
  { href: '/review', label: 'Review' },
  { href: '/held', label: 'Held' },
  { href: '/performance', label: 'Performance' },
  { href: '/decisions', label: 'Decisions' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        <header className="border-b border-gray-800 px-6 py-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold tracking-tight text-white">Unit Talk</span>
              <span className="text-sm text-gray-500">Command Center</span>
            </div>
            <nav className="flex gap-4">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-screen-xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
