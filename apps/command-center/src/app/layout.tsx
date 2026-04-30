import type { Metadata } from 'next';
import { CommandCenterShell } from '@/components/CommandCenterShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Unit Talk — Command Center',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="cc-shell flex min-h-screen antialiased">
        <a
          href="#main-content"
          className="skip-link sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
        >
          Skip to main content
        </a>
        <CommandCenterShell>{children}</CommandCenterShell>
      </body>
    </html>
  );
}
