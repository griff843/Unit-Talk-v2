# WORK-2026102202 Diff Summary

Execution SHA: `9eb932b13ee2df6ae7dfab8e2270f7e1af2028a0`

Diff base: `0c83ff016e3f5a650e5913ddf81de40d2395ff4b` (`origin/main`)

Merge SHA: pending merge

PR: https://github.com/griff843/Unit-Talk-v2/pull/1772

## What changed

- Added the fail-closed public gate `NEXT_PUBLIC_ENABLE_VIP_CHECKOUT`; only the exact value `true`
  enables checkout, while unset and invalid values remain off.
- Added the verified Whop checkout URL only to VIP tier checkout configuration. Trial, VIP+, Free,
  and Black Label receive no checkout URL.
- On the pricing page only, the enabled VIP checkout replaces the existing informational VIP CTA
  and reports availability. With the gate off, the existing CTA, href, and unavailable copy remain
  unchanged.
- External HTTP(S) CTA links render with `target="_blank"` and `rel="noopener noreferrer"`.
- Expanded the site configuration test to cover enabled, unset, and invalid gate states, exact URL
  assignment, tier isolation, off-state preservation, render wiring, and external-link safeguards.
- No environment value, deployment configuration, or publishing surface was changed.

| File                                    | Change                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `apps/web/src/lib/site-config.ts`       | Added fail-closed VIP checkout configuration and env resolution.         |
| `apps/web/src/lib/site-config.test.ts`  | Added both-state and invalid-state checkout assertions.                  |
| `apps/web/src/components/CTAButton.tsx` | Added safe external-link rendering.                                      |
| `apps/web/src/components/PlanCard.tsx`  | Added opt-in checkout CTA rendering with unchanged fallback.             |
| `apps/web/src/app/pricing/page.tsx`     | Enabled checkout presentation only on pricing and only through the gate. |

## SHA Binding

Execution SHA: `9eb932b13ee2df6ae7dfab8e2270f7e1af2028a0`

Merge SHA: pending merge

PR: https://github.com/griff843/Unit-Talk-v2/pull/1772
