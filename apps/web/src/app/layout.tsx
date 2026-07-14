import type { Metadata } from 'next';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { BRAND, PAGE_TITLES, SITE_URL } from '@/lib/site-config';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: PAGE_TITLES.home,
    template: '%s | Unit Talk',
  },
  description: BRAND.description,
  openGraph: {
    title: PAGE_TITLES.home,
    description: BRAND.description,
    type: 'website',
    siteName: BRAND.name,
  },
  twitter: {
    card: 'summary_large_image',
    title: PAGE_TITLES.home,
    description: BRAND.description,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:bg-[var(--ut-signal)] focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--ut-signal-ink)]"
        >
          Skip to main content
        </a>
        <PublicHeader />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <PublicFooter />
      </body>
    </html>
  );
}
