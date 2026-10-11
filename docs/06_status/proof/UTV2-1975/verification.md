# PROOF: UTV2-1975

MERGE_SHA: pending merge

> Scaffolded by `ops:lane-start`. Nothing below has been run. Record each command
> actually executed and its real result before review. `post-merge-lane-close.yml`
> binds the merge SHA; never write one here by hand.

Issue: UTV2-1975
Tier: T2
result: static/web/browser PASS; writable DB deferred to protected staging-ci

## ASSERTIONS:

- [x] `PublicHeader` uses `BrandLogo compact` and `/brand/unit-talk-mark-white.svg`.
- [x] Mobile and desktop dimensions preserve the canonical 1000:800 aspect ratio.
- [x] Existing menu interaction code remains unchanged, including Escape handling.

## EVIDENCE:

`pnpm --filter @unit-talk/web type-check` — pass
`pnpm --filter @unit-talk/web test` — 7 tests passed
`NEXT_PUBLIC_SITE_URL=https://unit-talk.com pnpm --filter @unit-talk/web build` — pass
`pnpm verify:static` — pass
`npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no matched rules

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL
(host=unparseable). Staging CI with `CI_SUPABASE_*` credentials is required.

## Verification

- Commands and results are recorded above; all completed gates passed.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 0b0e72932e3b691775ae486088c01ad7da070e2e

## Current-branch browser verification

Production build served locally at http://localhost:4407; no deployment. Screenshots captured from final source SHA256 7b535329d0bb57f0d80f0203d7309830e1b14340eed7502541e10e676b241b0e. Evidence directory: C:/Users/griff/.codex/visualizations/2026/10/10/01a12777-70cb-73b3-9a44-a8a1477c0557/current-main-review/header-correction

1440×900 desktop at DPR2: logo 75×60px CSS, visible artwork 48px high. 390×844 mobile at DPR2: logo 70×56px CSS, artwork 44.8px high. Native 5:4 aspect ratio preserved; object-fit contain; logo and all ancestor transforms none. Canonical source byte equality verified. No clipping, unexpected connection/line artifacts, menu overlap or horizontal overflow. Desktop nav and logo centers at y=40px.

Real browser interactions: open menu => expanded true; Results navigation => /results and menu closed; Escape => menu closed and focus returned to Open menu button. Header matches standalone canonical SVG comparison.

Final source-specific ESLint and apps/web type-check pass; final corrected production build passes.

## SHA binding

Verified source SHA: `0b0e72932e3b691775ae486088c01ad7da070e2e`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1735

`pnpm verify`: static portion PASS; writable-DB stage REFUSED before connecting because local host 127.0.0.1 cannot identify approved staging project. Protected staging CI is pending.
