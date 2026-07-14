# PROOF: UTV2-1513
MERGE_SHA: 2422c87817150ccad32ecae9c8a3f51fcf7097ae

ASSERTIONS:
- [x] Public website builds and type-checks clean — PASS (`pnpm --filter @unit-talk/web build`: 12/12 routes prerendered; `pnpm type-check`: no errors)
- [x] Full monorepo verify green on branch — PASS (`pnpm verify:parallel`: env:check, lint, type-check, build, test all green)
- [x] No fabricated performance claims in copy — PASS (manual review of `apps/web/src/lib/site-config.ts` and all page components; Results page uses a coming-soon placeholder, not invented statistics)
- [x] Responsible-play resources present on every page — PASS (`ResponsiblePlayBanner` in `PublicFooter`, dedicated `/responsible-play` page)
- [x] Undecided launch values (domain, support contact, Discord invite, pricing) marked pending PM decision, not invented — PASS (`site-config.ts` constants)
- [ ] R-level artifacts — N/A, `r-level-check.ts` found no rules matched for this diff

EVIDENCE:
```text
pnpm --filter @unit-talk/web build
  Route (app)                              Size     First Load JS
  ┌ ○ /                                    173 B         106 kB
  ├ ○ /_not-found                          993 B         103 kB
  ├ ○ /contact                             173 B         106 kB
  ├ ○ /faq                                 173 B         106 kB
  ├ ○ /how-it-works                        173 B         106 kB
  ├ ○ /pricing                             173 B         106 kB
  ├ ○ /privacy                             167 B         106 kB
  ├ ○ /responsible-play                    129 B         102 kB
  ├ ○ /results                             167 B         106 kB
  ├ ○ /robots.txt                          129 B         102 kB
  ├ ○ /sitemap.xml                         129 B         102 kB
  └ ○ /terms                               167 B         106 kB
  ○  (Static)  prerendered as static content

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
  Verdict: PASS
  Changed files: 34
  Rules matched: (none) — no R-level artifacts required for this diff

pnpm verify:parallel
  [verify:parallel] all checks passed
```

NOTES:
Standard T2 delivery-ui lane, no live-database runtime surface. Re-dispatch of UTV2-1513
after the prior branch (PR #1174) was closed as stale/unmergeable (89 commits behind,
contaminated commit history). This is a clean rebuild off current main.
