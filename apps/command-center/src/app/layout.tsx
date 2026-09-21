import type { Metadata } from 'next';
import { CommandCenterShell } from '@/components/CommandCenterShell';
import { resolveActorOrRefusal } from '@/lib/require-actor';
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

  // The shell resolves global health itself, client-side, via `/api/health` --
  // on mount and every 30s thereafter, behind that route's 30s server cache.
  //
  // This layout used to `await getPrivilegedGlobalHealth()` first, purely to
  // seed the sidebar badge's first paint. That read is `getDashboardData()`:
  // eighteen database queries, the entire Overview payload, uncached, on the
  // critical path of EVERY request the middleware matcher admits -- including
  // 404s, which run no page query at all. Measured against production it cost
  // 5.5s on a 404 and dominated all 55 routes, because a layout is not a page.
  //
  // Seeding one badge is not worth blocking first byte on. Passing `null`
  // renders the badge as "unavailable" for the moment before the client fetch
  // resolves, which is honest -- health genuinely is unknown until it is read.
  return (
    <html lang="en" className="dark">
      <body className="cc-shell flex min-h-screen antialiased">
        <a
          href="#main-content"
          className="skip-link sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
        >
          Skip to main content
        </a>
        <CommandCenterShell initialHealth={null} actor={actorResolution.actor} canSignOut={actorResolution.method === 'session'}>{children}</CommandCenterShell>
      </body>
    </html>
  );
}
