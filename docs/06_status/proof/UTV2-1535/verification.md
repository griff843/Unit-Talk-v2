# UTV2-1535 Verification

Issue: UTV2-1535
Tier: T1
Lane type: governance
Branch: claude/utv2-1535-lane-maximizer-typecaps
Head SHA (at authoring time): e9dfdeee065851aa14681defd406c9c823eda813
Generated at: 2026-07-15T00:42:06Z

## Static verification

### `pnpm exec tsc -b tsconfig.json`
Status: PASS (exit code 0), no diagnostics emitted.

### `pnpm lint`
Status: PASS (exit code 0), `eslint . --cache --cache-location .cache/eslint/` — no problems.

### Targeted tests
Command:
```
npx tsx --test scripts/ops/concurrency-simulation.test.ts scripts/ops/shared.test.ts scripts/ops/lane-start.test.ts scripts/ops/lane-maximizer.test.ts scripts/codex-dispatch.test.ts
```
Output (TAP summary):
```
1..157
# tests 157
# suites 0
# pass 157
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
137 pre-existing tests across these 5 files pass unchanged (regression proof that
`checkConcurrencyLimits()`'s extraction into `concurrency-rules.ts` and re-export from
`lane-start.ts` did not change its behavior, and that `lane-maximizer.ts`'s pre-existing
tests are unaffected by the new wave-projected forecast). 20 new tests in
`scripts/ops/lane-maximizer.test.ts`, numbered 1–20 matching the required acceptance
criteria exactly:

1. Lane 11 is not recommended (over total cap) — `TOTAL_CAP_EXCEEDED`
2. Fifth Claude lane is not recommended — `DISPATCH_LIMIT_CLAUDE`
3. Seventh Codex lane is not recommended — `DISPATCH_LIMIT_CODEX`
4. Fifth Hygiene lane is not recommended (isolated) — `HYGIENE_TYPE_CAP_EXCEEDED`
5. Fourth Governance lane is not recommended (isolated) — `GOVERNANCE_TYPE_CAP_EXCEEDED`
6. Same-app Delivery/UI conflict with an active lane is blocked — `DELIVERY_UI_APP_ACTIVE`
7. Same-app Delivery/UI conflict with an earlier planned candidate (same wave) is blocked — `DELIVERY_UI_APP_ALREADY_PLANNED`
8. Different Delivery/UI apps may both be planned
9. Missing Delivery/UI app identity (undetermined from file_scope) fails closed — `DELIVERY_UI_APP_UNDETERMINED`
10. Same Verification target as an active lane is blocked — `VERIFICATION_TARGET_ACTIVE`
11. Same Verification target as an earlier planned candidate (same wave) is blocked — `VERIFICATION_TARGET_ALREADY_PLANNED`
12. Different Verification targets may both be planned
13. Missing Verification target is blocked — `MISSING_VERIFICATION_TARGET`
14. Malformed Verification target is blocked — `MALFORMED_VERIFICATION_TARGET`
15. An active undetermined Verification target fails closed — `VERIFICATION_TARGET_UNDETERMINED_CONFLICT`
16. Existing singleton behavior remains intact (regression, PROD_POLICY numbers) — `SINGLETON_ACTIVE`
17. Forbidden combinations remain intact across active plus planned lanes (regression + wave extension) — `FORBIDDEN_COMBINATION` sourced from a wave-planned-only lane, not an active one
18. Trial mode does not bypass type caps (adversarial: wide trial headroom, hygiene cap still fires) — `HYGIENE_TYPE_CAP_EXCEEDED`
19. Dispatch commands use the exact validated Delivery/UI file scope (no silent substitution)
20. The recommended wave, replayed candidate-by-candidate through the canonical concurrency evaluator (`checkConcurrencyLimits()`), produces zero violations — full lane-start-vs-lane-maximizer parity integration test

### `pnpm verify`
Status: PASS (exit code 0). Full `env:check + lint + type-check + build + test` run,
including every pre-existing live-DB-backed suite in the repo. No failures.

### R-level check
Command: `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`
```
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```

## Runtime verification (T1 — unconditional per `truth-check-lib.ts`'s `runtime_proof_required` gate)

Command: `pnpm test:db` (`tsx --test apps/api/src/database-smoke.test.ts`) against the
live `zfzdnfwdarxucxtaojxm` Supabase project.

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 100702.889812
```

Live row counts captured immediately after (via `mcp__Supabase__execute_sql` against
project `zfzdnfwdarxucxtaojxm`, `SELECT COUNT(*)`), 2026-07-15T00:41:00Z:

| table | row_count |
|---|---|
| picks | 74,398 |
| pick_lifecycle | 110,504 |
| submissions | 76,457 |
| distribution_outbox | 4,990 |
| audit_log | 195,803 |
| settlement_records | 24,822 |

This diff's own scope (`scripts/ops/*.ts` orchestration tooling + `docs/06_status`
control-plane files) has no DB dependency — this runtime proof exists to satisfy the
unconditional T1 `runtime_proof_required` gate, not because the diff itself touches
database code.

## `ops:lane-start` vs. `lane-maximizer` decision parity

Acceptance criterion: "explicitly compare lane-maximizer's decisions against
lane-start's decisions." Proven by test 20 (`scripts/ops/lane-maximizer.test.ts`):
`evaluateCandidates()`'s own recommended `dispatch_plan.fill_now` wave (5 candidates
spanning hygiene/delivery-ui/verification/governance lane types, against a mixed active
board including a pre-existing active governance lane) is replayed candidate-by-candidate
through `checkConcurrencyLimits()` — the exact same function `ops:lane-start` calls at
real lane-creation time — building a growing "replay board" exactly as `ops:lane-start`
would leave the board after each real `ops:lane-start` invocation. Assertion: zero
violations at every step. Result: PASS.

## SHA Binding

Branch: claude/utv2-1535-lane-maximizer-typecaps
Head SHA (at authoring time): e9dfdeee065851aa14681defd406c9c823eda813
Merge SHA: not yet merged — will be bound by `post-merge-lane-close.yml`'s automated
`ops:proof-generate --merge-sha` run after this PR merges, per this repo's standard T1
closeout automation.
