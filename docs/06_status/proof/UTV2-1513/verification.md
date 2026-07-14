# UTV2-1513 Runtime Verification

Generated at: 2026-07-14T03:54:43.172Z
Issue: UTV2-1513
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1513-public-website-mvp-v2
PR URL: N/A
Head SHA: e4351d1d6a1ae851423ae6dc9d6eab9b245a6b13
Merge SHA: N/A
result: pass

## Verification
- [x] `pnpm type-check`: pass (tsc -b tsconfig.json, no errors)
- [x] `pnpm test`: pass (all node:test suites green, see `pnpm verify:parallel` output below)
- [x] `pnpm verify:parallel`: pass — env:check, lint, type-check, build, test all green
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS — "Changed files: 34, Rules matched: (none) — no R-level artifacts required for this diff"
- [x] `pnpm --filter @unit-talk/web build`: pass — all 12 routes prerendered as static content (/, /contact, /faq, /how-it-works, /pricing, /privacy, /responsible-play, /results, /robots.txt, /sitemap.xml, /terms, /_not-found)

## Runtime Verification
This is a T2 delivery-ui lane (new standalone Next.js app under apps/web) — no live-DB runtime surface to exercise; `pnpm test:db` is not applicable. Verification is build/type/lint/unit-test correctness plus a manual review of claims-discipline compliance:
- No fabricated win-rate/ROI/CLV/performance numbers anywhere in copy (`apps/web/src/lib/site-config.ts`, all page components) — Results page uses `ComingSoonCard`, not invented statistics.
- No guarantee/risk-free language; `BRAND.responsibleLine` and `BRAND.notASportsbook` are present in `site-config.ts` and rendered via `ResponsiblePlayBanner`/footer on every page.
- Undecided launch values (domain, support contact, Discord invite, final pricing) are explicit `TODO(...)` markers in `site-config.ts`, not invented values — tracked separately under UTV2-1482.

## SHA Binding
Head SHA: e4351d1d6a1ae851423ae6dc9d6eab9b245a6b13
Merge SHA: N/A
