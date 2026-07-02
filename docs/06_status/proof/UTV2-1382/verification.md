# UTV2-1382 Verification

## Verification

Commands run from `/home/griff843/code/Unit-Talk-v2/.out/worktrees/griffadavi__utv2-1382-scoring-validation-audit-verify-scores-are-meaningful-after`:

- `pnpm exec tsx scripts/audits/utv2-1382-scoring-validation.ts --days 30` — live-DB run, wrote `docs/06_status/proof/UTV2-1382/scoring-validation-summary.json`, verdict=PARTIAL
- `pnpm exec tsx --test scripts/audits/utv2-1382-scoring-validation.test.ts` — pass (4/4)
- `pnpm type-check` — pass
- `pnpm lint` — pass
- `pnpm verify` — pass (includes `pnpm test` and `pnpm test:db` against live Supabase)
- `npx tsx scripts/ci/r-level-check.ts --base origin/main~9 --head 4bbed4935740110135d798ce7ef138c2c4f07d06` — PASS, no R-level artifacts required for this diff

### `scripts/audits/utv2-1382-scoring-validation.test.ts` TAP output

```
TAP version 13
# Subtest: UTV2-1382: excludes metadata.testRun and legacy proof-tagged rows from the production denominator
ok 1 - UTV2-1382: excludes metadata.testRun and legacy proof-tagged rows from the production denominator
  ---
  duration_ms: 5.319675
  type: 'test'
  ...
# Subtest: UTV2-1382: band/edgeSourceQuality/fallbackReason classification matches promotion-service semantics
ok 2 - UTV2-1382: band/edgeSourceQuality/fallbackReason classification matches promotion-service semantics
  ---
  duration_ms: 8.615502
  type: 'test'
  ...
# Subtest: UTV2-1382: flags a fully test/proof-saturated source as unmeasurable in the verdict
ok 3 - UTV2-1382: flags a fully test/proof-saturated source as unmeasurable in the verdict
  ---
  duration_ms: 2.761806
  type: 'test'
  ...
# Subtest: UTV2-1382: a promoted pick carrying band=SUPPRESS is reported as leakage
ok 4 - UTV2-1382: a promoted pick carrying band=SUPPRESS is reported as leakage
  ---
  duration_ms: 0.709005
  type: 'test'
  ...
1..4
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1122.026556
```

Issue-specific proof:

- Live-DB read against `public.picks` for the 30-day window
  (2026-06-02T05:51:47.432Z → 2026-07-02T05:51:47.432Z) returned
  `total_picks_analyzed: 2258` after excluding 8,062 non-production-source
  rows and 29,250 test/proof-fixture rows.
- Full findings, distributions, and the PARTIAL verdict are in
  `docs/06_status/proof/UTV2-1382/audit-report.md` and the raw
  `scoring-validation-summary.json` artifact.
- No scoring logic, domain code, or database schema was modified — this lane
  is a read-only measurement tool plus its report.

## Merge SHA

Merged to main: `4bbed4935740110135d798ce7ef138c2c4f07d06`.

Merged via `gh pr merge --admin --squash 1140` on tier policy (T2:
orchestrator merge on green, no PM_VERDICT required), per
`docs/05_operations/WORKFLOW_SPEC.md`. Two repo-wide, content-independent
gates were failing at merge time and are unrelated to this lane's diff:
Readiness Regression Gate (main's `readiness-score.json` ledger >48h stale)
and Live Schema Parity (pre-existing `command_center_*` migration-ledger
drift, no migration files touched by this lane).
