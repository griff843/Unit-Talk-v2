import type { Metadata } from 'next';
import { NavLinks } from '@/components/NavLinks';
import './globals.css';

export const metadata: Metadata = {
  title: 'Unit Talk — Command Center',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        <header className="border-b border-gray-800 px-6 py-3">
          <div className="mx-auto flex max-w-screen-xl items-center gap-8">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight text-white">Unit Talk</span>
              <span className="text-xs font-medium uppercase tracking-widest text-gray-500">Command Center</span>
            </div>
            <NavLinks />
          </div>
        </header>
        <main className="mx-auto max-w-screen-xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
