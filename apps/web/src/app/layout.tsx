import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { BRAND, PAGE_TITLES, SITE_URL } from '@/lib/site-config';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

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
      <body className={`${inter.className} flex min-h-screen flex-col antialiased`}>
        <PublicHeader />
        <main className="flex-1">{children}</main>
        <PublicFooter />
      </body>
    </html>
  );
}
