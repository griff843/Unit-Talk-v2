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
        <WorkspaceSidebar />
        <main className="flex-1 min-w-0 overflow-y-auto px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
