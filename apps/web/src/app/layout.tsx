import type { Metadata, Viewport } from 'next';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { BRAND, PAGE_TITLES, SITE_URL } from '@/lib/site-config';
import { pageMetadata } from '@/lib/site-metadata';
import './globals.css';
export const metadata: Metadata = {
  ...pageMetadata(PAGE_TITLES.home, BRAND.description, '/'),
  metadataBase: new URL(SITE_URL),
  icons: {
    icon: [
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-64.png', sizes: '64x64', type: 'image/png' },
    ],
    apple: [
      {
        url: '/brand/unit-talk-icon-256.png',
        sizes: '256x256',
        type: 'image/png',
      },
    ],
  },
};
export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#090a0a',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
