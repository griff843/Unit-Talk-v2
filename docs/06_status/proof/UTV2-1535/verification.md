# PROOF: UTV2-1535
MERGE_SHA: 08b4ac0a1e9c45e64674362452d5e3d7ff1b84a3

ASSERTIONS:
- [x] evaluateCandidates() forecasts total lane cap, Claude/Codex executor caps, singleton lane types, forbidden combinations, Hygiene<=4, Governance<=3, Delivery/UI<=1-per-app, and Verification<=1-per-target, all via one canonical checkConcurrencyLimits() call, not five separate hand-rolled checks
- [x] checkConcurrencyLimits() (byte-identical logic, moved from scripts/ops/lane-start.ts) extracted into a new shared module scripts/ops/concurrency-rules.ts, so both lane-start.ts (real fail-closed authority) and lane-maximizer.ts (advisory planner) call the exact same implementation -- no third, divergent copy
- [x] Delivery/UI app identity derived deterministically from file_scope_lock only (deriveDeliveryUiApp(), scripts/ops/shared.ts) -- never title/branch/text; undetermined app fails closed
- [x] Verification target identity remains explicit-only (never inferred from issue_id/title/branch/purpose/file scope) -- missing/malformed target blocks; an active legacy Verification lane with no trustworthy target fails closed
- [x] Wave projection: each accepted candidate is appended as a synthetic active-shaped entry to a growing projectedActive list, and every subsequent candidate in the same wave is evaluated against it -- mirroring what ops:lane-start would enforce if each dispatch_command ran in sequence
- [x] Trial-mode total/executor headroom never bypasses type_caps, proven adversarially with a wide-open trial config still rejecting a 5th hygiene lane
- [x] File-scope overlap checked against active lanes AND already-planned candidates in the same wave
- [x] 20 new deterministic tests added (numbered 1-20, matching the required acceptance criteria exactly) plus all 137 pre-existing tests in the touched suites retained and passing unchanged, plus 8 more added after Codex review round 1 (165/165 total)
- [x] Test 20 replays the planner's own recommended wave candidate-by-candidate through checkConcurrencyLimits() directly, proving lane-start/lane-maximizer decision parity with zero violations
- [x] pnpm exec tsc -b tsconfig.json, pnpm lint, pnpm verify (full), and the R-level check all pass clean
- [x] pnpm test:db passes against the live zfzdnfwdarxucxtaojxm Supabase project (7/7), satisfying the unconditional T1 runtime_proof_required gate
- [x] file_scope_lock in the lane manifest declares every touched path upfront -- File Scope Lock passes with no override needed
- [x] No cross-issue UTV2-### references in commit subjects/bodies, PR title, or PR body -- only UTV2-1535 appears

EVIDENCE:
```text
$ npx tsx --test scripts/ops/concurrency-simulation.test.ts scripts/ops/concurrency-rules.test.ts scripts/ops/shared.test.ts scripts/ops/lane-start.test.ts scripts/ops/lane-maximizer.test.ts scripts/codex-dispatch.test.ts
...
1..165
# tests 165
# suites 0
# pass 165
# fail 0
# cancelled 0
# skipped 0
# todo 0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 11
Rules matched: (none) — no R-level artifacts required for this diff

$ pnpm exec tsc -b tsconfig.json
(exit 0, no diagnostics)

$ pnpm test:db
...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

---

# UTV2-1535 Verification

Issue: UTV2-1535
Tier: T1
Lane type: governance
Branch: claude/utv2-1535-lane-maximizer-typecaps
Head SHA (at authoring time): e9dfdeee065851aa14681defd406c9c823eda813
Generated at: 2026-07-15T00:42:06Z

## Verification

All static and runtime verification for this diff is green: `pnpm exec tsc -b tsconfig.json`,
`pnpm lint`, the targeted test suite (165/165, after the Codex review round below added 8
more), `pnpm verify` (full), the R-level check, and `pnpm test:db` against the live
Supabase project all pass. Details for each are below.

## Static verification

### `pnpm exec tsc -b tsconfig.json`
Status: PASS (exit code 0), no diagnostics emitted.

### `pnpm lint`
Status: PASS (exit code 0), `eslint . --cache --cache-location .cache/eslint/` — no problems.

### Targeted tests
Command:
```
npx tsx --test scripts/ops/concurrency-simulation.test.ts scripts/ops/concurrency-rules.test.ts scripts/ops/shared.test.ts scripts/ops/lane-start.test.ts scripts/ops/lane-maximizer.test.ts scripts/codex-dispatch.test.ts
```
Output (TAP summary, final, after the Codex review round):
```
1..165
# tests 165
# suites 0
# pass 165
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
137 pre-existing tests across the original 5 files pass unchanged (regression proof that
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
21. (added after Codex review round 1) synthesized policy clamps total to the configured total, not maxClaude + maxCodex, when config total is smaller — `scripts/ops/lane-maximizer.test.ts`

Plus 7 tests added after Codex review round 1 in the new `scripts/ops/concurrency-rules.test.ts`
covering `isValidVerificationTarget()` directly and the fixed undetermined-active-target
behavior (malformed active target now fails closed; genuinely missing active target still
fails closed; a distinct valid active target still allows the incoming lane).

### `pnpm verify`
Status: PASS (exit code 0). Full `env:check + lint + type-check + build + test` run,
including every pre-existing live-DB-backed suite in the repo. No failures.

### R-level check
Command: `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`
```
Verdict: PASS
Changed files: 11
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

## Codex review round 1

Triggered via `@codex review` after CI first went green (excluding the PM-gated Merge
Gate). 2 findings, both real and material, both fixed in commit `86519566`:

1. **Total cap clamp** (`scripts/ops/lane-maximizer.ts`) — the synthesized default
   policy always set `total: limits.maxClaude + limits.maxCodex`, ignoring a real
   `CONCURRENCY_CONFIG.json` total set below the sum of the executor caps. Fixed to
   `total: Math.min(cfg.total, limits.maxClaude + limits.maxCodex)`. Regression test 21
   (`lane-maximizer.test.ts`) temporarily patches the real config file to
   total=5/executors={claude:4,codex:4} and proves a 6th lane is blocked at the smaller
   configured total.
2. **Malformed verification target** (`scripts/ops/concurrency-rules.ts`) — the
   undetermined-active check for verification lanes was presence-only, so a non-empty
   but malformed active target (e.g. a stray `UNI-###` id) was silently treated as
   trustworthy instead of failing closed. Fixed by adding `isValidVerificationTarget()`
   (format-validated via `requireVerificationTarget()`) and using it for the
   undetermined check; also removed `lane-maximizer.ts`'s own duplicate copy of this
   helper. New dedicated test file `scripts/ops/concurrency-rules.test.ts` (7 tests)
   covers the fix plus regression coverage.

Both review threads were replied to with file:line evidence citing commit `86519566`
and resolved via GraphQL `resolveReviewThread`. No findings were left open.

## SHA Binding

Branch: claude/utv2-1535-lane-maximizer-typecaps
Head SHA (at authoring time): e9dfdeee065851aa14681defd406c9c823eda813
Head SHA (after Codex review round 1): 86519566e19644ab1d913e5842a0aecf7150c7f8
Merge SHA: not yet merged — will be bound by `post-merge-lane-close.yml`'s automated
`ops:proof-generate --merge-sha` run after this PR merges, per this repo's standard T1
closeout automation.
