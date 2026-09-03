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
  // Second gate, behind the middleware matcher. Page server components hold
  // service-role database access, so if a request ever reaches the tree without
  // the middleware-issued actor, the page below must not execute at all —
  // omitting `children` is what prevents that, since an element React never
  // renders never runs.
  //
  // This is defence in depth, not the primary control: the matcher in
  // `middleware.ts` is what admits requests, and Next does not re-render layouts
  // on client-side navigation. Both gates have to fail for privileged code to
  // run anonymously.
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
