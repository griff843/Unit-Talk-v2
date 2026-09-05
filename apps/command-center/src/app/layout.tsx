import type { Metadata } from 'next';
import { CommandCenterShell } from '@/components/CommandCenterShell';
import { resolveActorOrRefusal } from '@/lib/require-actor';
import { getPrivilegedGlobalHealth, type GlobalHealth } from '@/lib/global-health';
import './globals.css';

// Command Center pages read privileged, request-time operator truth. Never
// execute those reads while constructing a standalone image.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Unit Talk — Command Center',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // UI-level refusal behind the middleware matcher. App Router can execute child
  // server components in parallel with this layout, so omitting `children` does
  // not prevent their data access. Privileged boundaries enforce authentication
  // independently; this check changes the UI displayed to a refusal.
  //
  // This is defence in depth, not the primary control: the matcher in
  // `middleware.ts` is what normally admits requests, and Next does not
  // re-render layouts on client-side navigation.
  const actorResolution = await resolveActorOrRefusal();

  if (!actorResolution.ok) {
    return (
      <html lang="en" className="dark">
        <body className="cc-shell flex min-h-screen antialiased">
          <main id="main-content" className="p-8">
            <h1>Not authenticated</h1>
            <p>{actorResolution.error}</p>
          </main>
        </body>
      </html>
    );
  }

  let initialHealth: GlobalHealth | null = null;
  try {
    initialHealth = await getPrivilegedGlobalHealth();
  } catch (error) {
    console.error('command_center.initial_health_read_failed', error);
  }

  return (
    <html lang="en" className="dark">
      <body className="cc-shell flex min-h-screen antialiased">
        <a
          href="#main-content"
          className="skip-link sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
        >
          Skip to main content
        </a>
        <CommandCenterShell initialHealth={initialHealth}>{children}</CommandCenterShell>
      </body>
    </html>
  );
}
