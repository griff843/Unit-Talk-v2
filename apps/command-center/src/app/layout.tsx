import type { Metadata } from 'next';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Unit Talk — Command Center',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="flex min-h-screen bg-gray-950 text-gray-100 antialiased">
        <a
          href="#main-content"
          className="skip-link sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-blue-600 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to main content
        </a>
        <WorkspaceSidebar />
        <main id="main-content" className="flex-1 min-w-0 overflow-y-auto px-6 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
