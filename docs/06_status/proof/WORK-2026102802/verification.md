# PROOF: WORK-2026102802

MERGE_SHA: 8eff8d2301fc2f05684ea99ed014fdf283e42077

Issue: WORK-2026102802
Tier: T2
Branch: codex/work-2026102802-cc-wave1-discovery-settlement-context
Executor: codex-cli (codex-luna-medium; routing evidence in `model-routing.json`); finished by the orchestrator (Claude) after the Codex run timed out with uncommitted work
Head SHA (last non-proof commit): 9efd8ca0b07db65fba2876ea6cada7f4d2738547
result: pass

## ASSERTIONS:

- [x] Sidebar `LogoMark` uses viewBox `0 0 740 500` and the two approved emblem paths at an explicit 40x40. No app-to-app import.
- [x] `mapPickIdentityRead` builds the settlement target: capper, matchup, current effective settlement (latest record, including a correction) and its source. It also coerces string numerics such as `"3.50"` (`pick-identity.test.ts`, 3 tests).
- [x] `SettlementWorkbench` renders `SettlementTargetSummary` above the controls, with the UUID kept as secondary text. Settlement confirmation, append-only semantics and the server action are unchanged.
- [x] `pickSearchEntry` returns "Find pick <fragment>" → `/picks?q=<fragment>` only for an ID fragment of 6+ hex characters. `pickIdPrefixRange` bounds every uuid with that prefix (`command-palette-model.test.ts`).
- [x] The Picks explorer keeps capper, sport, dateFrom, dateTo and ID-prefix search in its URL state (`picks-explorer-query.test.ts`). `searchPicks` filters capper and sport on base `picks` columns, normalising their case, so the count stays on `picks` (`queues-count-relation.test.ts` green).
- [x] The ROI page labels the published cohort and its windows, states that Track Only is excluded and links to Performance. `analytics.ts` is unchanged.
- [x] No server action added (`server-action-guard.test.ts` green). No write, API, schema, delivery, authentication or containment change.

## EVIDENCE:

```text
$ pnpm exec tsx --test src/lib/*.test.ts src/lib/*.test.tsx src/lib/data/*.test.ts   (apps/command-center, = pnpm test:command-center)
# tests 701  # pass 701  # fail 0
$ pnpm exec tsc --noEmit -p tsconfig.json   (apps/command-center)
exit 0
$ pnpm exec next build   (apps/command-center)
✓ Compiled successfully
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS  (rules matched: operator-ui)
```

Local visual run, 2026-10-28, desktop 1440x900 and mobile 390x844, served on loopback only:
- The sidebar emblem, the palette "Find pick fa5e1dd2" entry and the ROI layout rendered.
- The local environment holds containment placeholder credentials, so the data-bound panels showed their load-failed states. Data-bound content is proven by the tests above, not by screenshots.
- This run found and fixed a client-bundle regression: `node:crypto` was pulled into the palette through `@unit-talk/contracts`. That fix is commit 9efd8ca0b07db65fba2876ea6cada7f4d2738547.

Nothing was written to production.

Writable live DB: not applicable to read-only Command Center surfaces. The protected staging-ci proof runs in the required CI `verify` context.

## Verification

- `pnpm verify`: executed by the required CI `verify` check on the PR head (verification of record).
- `pnpm type-check`: Command Center `tsc --noEmit` exit 0 on 9efd8ca0b07db65fba2876ea6cada7f4d2738547.
- `pnpm test` (focused): `pnpm test:command-center` 701/701 PASS on 9efd8ca0b07db65fba2876ea6cada7f4d2738547.

## Merge SHA Binding

Merge SHA: 8eff8d2301fc2f05684ea99ed014fdf283e42077
PR: https://github.com/griff843/Unit-Talk-v2/pull/1798
Execution SHA: 9efd8ca0b07db65fba2876ea6cada7f4d2738547
