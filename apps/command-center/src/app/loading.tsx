import React from 'react';

/**
 * The route-transition boundary for every Command Center page.
 *
 * Without this file the App Router has nothing to show while a server
 * component renders. It keeps the *previous* page mounted and fully painted,
 * and swaps it only once the new RSC payload arrives. Nothing in the shell
 * fills that gap either: `CommandCenterShell` tracks `usePathname()`, which
 * does not change until the navigation has already committed, and it holds no
 * transition state. So an operator clicking a nav item saw the old page sit
 * there, unchanged and still interactive, for the entire server render --
 * which is indistinguishable from a click that did nothing.
 *
 * That gap was seconds, not milliseconds: before UTV2-1942 every request paid
 * an eighteen-query health read in the root layout, and the heaviest pages then
 * ran a `count` that exceeded the 8s `authenticated` statement timeout
 * outright. Those costs are removed in the same change, but removing them is
 * not a substitute for this boundary -- a page that legitimately takes 600ms
 * still needs to say so, and a future slow query would otherwise silently
 * reintroduce the same "nothing happens when I click" symptom.
 *
 * Only two routes (`/decision/preview`, `/decision/routing`) declared their own
 * loading state. A segment's own `loading.tsx` still takes precedence over this
 * one; this is the default for the other ~53.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="route-loading"
      className="animate-pulse space-y-4"
    >
      <span className="sr-only">Loading page…</span>

      {/* Page heading */}
      <div className="h-6 w-56 rounded bg-white/[0.06]" />
      <div className="h-3 w-80 rounded bg-white/[0.04]" />

      {/* Content rows. Deliberately generic: this boundary covers every
          operator surface, and a skeleton that mimicked one page's table would
          misdescribe the other fifty-two. */}
      <div className="space-y-2 pt-2">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="h-10 rounded border border-white/[0.04] bg-white/[0.02]" />
        ))}
      </div>
    </div>
  );
}
