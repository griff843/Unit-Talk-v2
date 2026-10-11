# PROOF: UTV2-1801

MERGE_SHA: pending merge

Issue: UTV2-1801
Tier: T2
result: REVIEW_CANDIDATE_PENDING_PROTECTED_CI

## ASSERTIONS:

- [x] Canonical logo assets unchanged: focused node:test plus HTTP byte comparisons.
- [x] Contract-backed Trial/VIP pricing and conditional availability: focused tests and claims-and-launch-gaps.md.
- [x] Ten authorized public routes, canonical metadata, internal links and real assets: focused tests plus http-route-audit.json.
- [x] Responsive layout and keyboard interactions: browser-routes.json, browser-boundaries.json, ui-interactions.json and screenshots/.
- [x] Production build, app type check, scoped lint and full static verification pass.
- [x] URL inversion: an unset variable makes the production build exit 1 at page-data collection; placeholder origins are rejected by focused test.
- [x] Committed-source R-level gate passes with no matched rules.
- [ ] Exact-head protected staging CI remains pending.

## EVIDENCE:

| Executed command/check | Actual result |
|---|---|
| NEXT_PUBLIC_SITE_URL=https://unit-talk.com pnpm type-check | PASS |
| NEXT_PUBLIC_SITE_URL=https://unit-talk.com pnpm test | PASS |
| NEXT_PUBLIC_SITE_URL=https://unit-talk.com pnpm exec tsx --test apps/web/src/lib/site-config.test.ts | PASS: 7 tests, 0 failures |
| pnpm --filter @unit-talk/web test | PASS: 7 tests, 0 failures |
| pnpm --filter @unit-talk/web build | PASS: 15 generated pages, shared first-load JS 102 kB |
| pnpm --filter @unit-talk/web type-check | PASS |
| pnpm exec eslint apps/web/src apps/web/next.config.mjs apps/web/tailwind.config.ts | PASS |
| NEXT_PUBLIC_SITE_URL=https://unit-talk.com pnpm verify:static | PASS |
| env -u NEXT_PUBLIC_SITE_URL pnpm --filter @unit-talk/web build | EXPECTED FAIL: exit 1, `NEXT_PUBLIC_SITE_URL is required and must be the public HTTPS origin.` |
| git diff --check | PASS |
| Mechanical HTTP audit | PASS: 10 routes, 14 internal hrefs, 8 byte-identical approved assets, explicit 404 and placeholder canonical rejection |
| Browser route audit | PASS: 20 desktop/mobile route checks; six extra boundary checks at 320, 768 and 1024 px |
| Keyboard behavior | PASS: menu/Escape/focus, navigation, FAQ/Enter, table scroll, skip link |
| Declared theme contrast pairs | PASS: 13 text pairs, minimum 6.28:1; secondary button border 3.46:1 |
| Production preview desktop trace | LCP 208 ms, TTFB 6 ms, CLS 0; no INP sample |
| Production preview mobile trace | LCP 896 ms, TTFB 5 ms, INP 85 ms, CLS 0; 4x CPU, Fast 4G |
| pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD | PASS: 78 changed files; no rules matched |

Executed final-diff R-level output (unchanged source; issue-owned proof annotations only):

```text
Verdict: PASS
Changed files: 79
Rules matched: (none) — no R-level artifacts required for this diff
```

Logs are copied to logs/. Browser/performance evidence describes the prepared source snapshot, not a production deployment. Local lab metrics are not field Core Web Vitals.

The first static-verification attempt found that an earlier standalone Next build had regenerated the tracked `next-env.d.ts` shim. The generated shim was restored to the repository version, then the exact final source passed `pnpm verify:static`. No generated source artifact is included.

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (`host=unparseable`). Writable DB verification requires `xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. No database, provider, production secret, deployment or delivery target was accessed.

## Verification binding

Lane base: f9536812a1de8be8b79f92d7c0bcf72b36bd07f1.
Current metadata HEAD: d087ae7861a17339f6d8fca77bf98bba6d2c67af.
Implementation SHA: `01e2c460173fd3f3e79e97d22f7aece1cc4c18be`. source-snapshot.json binds the prepared handoff bytes; this registered review adds the fail-closed URL correction, large-image metadata and final mechanical tests described above. Protected exact-head PR checks remain pending.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1732

## Reviewed build refresh

After the registered executor completed, the unchanged implementation commit 01e2c460173fd3f3e79e97d22f7aece1cc4c18be was built again with the required real origin (PASS), served as an isolated standalone production preview on port 4401, and mechanically audited: all ten routes, fourteen internal links/anchors, eight byte-identical approved assets and final wide social artwork passed. Placeholder inversion exited 1 as expected; unknown route returned 404. App type-check and diff whitespace passed after restoring the generated shim. The approved screenshot/layout evidence is retained; review corrections affect metadata, configuration and test coverage, not page geometry or brand assets.

## Final social-asset inspection correction

Post-review visual inspection found the transparent white wordmark could disappear on light social-preview canvases. Social metadata now references the existing approved dark app icon, unit-talk-icon-1024.png, copied byte-identically with its original 1024×1024 proportions. Header/footer wordmarks and monogram geometry are unchanged. This ordinary in-scope QA correction is committed at 3a20740c9ded9b62aba72ec7408a0c766f220393. Final focused tests (7/7), production build, app type-check and scoped lint pass. Fresh HTTP audit of port 4402 proves all ten routes, fourteen internal links/anchors and nine canonical assets, final dark social artwork, placeholder failure and explicit 404. No artwork was redrawn, regenerated or composited. Prior wide-artwork review notes describe the superseded intermediate candidate.
