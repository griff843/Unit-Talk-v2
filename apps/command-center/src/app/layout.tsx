import type { Metadata } from 'next';
import { Cormorant_Garamond, IBM_Plex_Sans } from 'next/font/google';
import { Sidebar } from '@/components/ui';
import './globals.css';

const displayFont = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700'],
});

const bodyFont = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Unit Talk — Command Center',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} dark`}>
      <body className="cc-shell min-h-screen antialiased">
        <a
          href="#main-content"
          className="skip-link sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--status-info-fg)] focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to main content
        </a>
        <div className="cc-mesh" aria-hidden="true" />
        <div className="relative z-10 flex min-h-screen">
          <Sidebar />
          <main id="main-content" className="min-w-0 flex-1 overflow-y-auto px-4 pb-10 pt-20 sm:px-6 lg:px-10 lg:pt-8">
            <div className="mx-auto max-w-[1440px]">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
