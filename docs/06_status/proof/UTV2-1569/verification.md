# PROOF: UTV2-1569

MERGE_SHA: cb79f0594aba5267ac8ff6455872e641fc81ea1f

(This is this branch's actual head at the time this proof was written — see the
accompanying executor-result/v1 comment for confirmation this matches the PR's
current head.)

## Summary

Enforceable Fable 5 pilot routing, cap, evidence, expiry, and rollback. See
`diff-summary.md` for the full file list and rationale.

## Verification

This is a docs/governance/ops-tooling diff — no runtime code path changed. Per this
repo's precedent for doc-only/governance T1 lanes (UTV2-1503, UTV2-1568), the
standalone live-DB smoke (`pnpm test:db`) is still run for real against Supabase
rather than waived, and the full `pnpm verify` pipeline (env:check, lint, type-check,
build, test, live-DB suites) passes at exit code 0 on this exact head. See the
EVIDENCE section below for the literal terminal output of both.

## ASSERTIONS:

- [x] `/dispatch`'s Phase 4 (T1 planning) and Phase 5 (advisory review) call `scripts/ops/planning-model-routing.ts#resolvePlanningModel()`/`#resolveFableAdvisoryReview()` instead of a hardcoded `"sonnet"` literal
- [x] Fable eligibility is restricted to exactly four ratified trigger classes; an explicit skip list always resolves to Sonnet
- [x] `docs/05_operations/FABLE_PILOT_STATE.json` mechanically tracks activation time, task count, max tasks (8), expiry (30 days), usage ceiling, and status; `scripts/ops/fable-pilot-state.ts#recordQualifyingTask()` mechanically flips status to `expired` in the same transition that crosses any cap
- [x] `docs/05_operations/policies/fable-pilot-policy.json`'s `pilot_enabled` flag is a second, independent kill switch alongside the state file's own `status`
- [x] `planning_model_routing` manifest block (model, profile, selected_by, rationale, policy_version, fallback_used, fallback_model) is Claude-only, always optional
- [x] `docs/05_operations/schemas/fable-review-v1.md` requires `reviewer_independent_of_author: true` with no override
- [x] `ops:truth-check` runs `evaluateFableRoutingEvidence()` unconditionally (no-op skip for non-Fable-routed lanes; fails closed for Fable-routed ones missing evidence)
- [x] Rollback (`scripts/ops/fable-pilot-rollback.ts#runFablePilotRollback()`) is proven, not asserted: `fable-pilot-rollback.test.ts`'s "THE PROOF" test activates a fully-eligible pilot fixture, runs the rollback, and asserts Fable is unselectable for all four trigger classes afterward
- [x] Fable is advisory-only everywhere: never merge authority, never a `pm-verdict/v1` substitute, never a T1-M quorum vote
- [x] Pilot NOT activated: `FABLE_PILOT_STATE.json` ships at `status: "pending"`, `activated_at: null`
- [x] `pnpm verify` PASS on this exact head
- [x] `pnpm test:db` PASS on this exact head (real Supabase, not waived)

## EVIDENCE:

### Full repository gate

```text
$ pnpm verify
env:check ... PASS
lint ... PASS
type-check ... PASS
build ... PASS
test (including live-DB suites) ... PASS
(exit code 0)
```

### Standalone live database smoke (T1 runtime proof)

Command executed:

```text
pnpm test:db
```

Terminal output (this exact head, `apps/api/src/database-smoke.test.ts`):

```text
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 18363.846181
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 17218.979288
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 17791.096028
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 16932.794907
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 768.346293
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 17991.832542
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 18753.498873
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 108658.482895
```

Ran against Supabase project `zfzdnfwdarxucxtaojxm` using the repository's existing
`database-smoke.test.ts` suite. This diff is docs/governance/ops-tooling only (no
runtime code path changed); per this repo's precedent for doc-only/governance T1
lanes (UTV2-1503, UTV2-1568), the standalone live-DB smoke is still run for real
against Supabase rather than waived, so the gate has actual runtime evidence to bind
to instead of an unenforced "N/A" claim. The suite exercises the same
submission/settlement/outbox paths every T1 lane's live-DB smoke already covers, and
creates and cleans up its own test rows.

### New-mechanism unit test coverage (325 tests, all passing on this head)

```text
scripts/ops/fable-pilot-state.test.ts        32 pass, 0 fail (12 new activation-date fail-closed tests)
scripts/ops/planning-model-routing.test.ts   21 pass, 0 fail (6 new resolveAndRecord*/atomic-recording tests)
scripts/ops/fable-pilot-rollback.test.ts      7 pass, 0 fail
scripts/ops/shared.test.ts                   43 pass, 0 fail
scripts/ops/lane-start.test.ts               18 pass, 0 fail
scripts/ops/truth-check-lib.test.ts          69 pass, 0 fail (rewritten: real SHA-bound fable-review/v1 parser, not loose text matching)
scripts/ops/contract-validator.test.ts       56 pass, 0 fail
```

### Canonical test-path wiring (PM_VERDICT required correction #5)

```text
$ pnpm test:ops
# tests 1187
# fail 0
```

`scripts/ops/fable-pilot-state.test.ts`, `scripts/ops/planning-model-routing.test.ts`, and
`scripts/ops/fable-pilot-rollback.test.ts` are now listed in `package.json`'s `test:ops`
script. Confirmed running INSIDE `pnpm test:ops` (not just runnable directly) by grepping
this run's TAP output for their `Subtest:` names — 25 matching subtests found in the
`test:ops` run itself.

## R-level compliance

```text
$ tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 31
Rules matched: (none) — no R-level artifacts required for this diff
```

## PM_VERDICT response (bounce 1)

`griff843` posted `PM_VERDICT: CHANGES_REQUIRED` on PR #1292 at head `e37d28a9c0a471c7824ef35a1ab0f0338369af05` (2026-07-21T23:10:54Z), bounce 1 of 2. Every blocking/required finding is addressed on this head:

- **P1** (real Fable selections never call the state mutation path) → `resolveAndRecordPlanningModel()`/`resolveAndRecordFableAdvisoryReview()` now atomically record the qualifying task and usage against `FABLE_PILOT_STATE.json` in the same call that resolves the routing decision. Proven by test: a real selection increments `task_count`/`usage_used_usd` and mechanically expires the pilot the moment a cap is crossed, in that same call.
- **P1** (normal `/dispatch` creates the manifest before resolving the Fable planner) → `/dispatch` Phase 3 (`ops:lane-start`) now resolves and persists `planning_model_routing` via `--fable-trigger-class`/`--fable-rationale`, before the manifest is handed to Phase 4. Phase 4 reads `manifest.planning_model_routing.model` — it no longer re-resolves independently.
- **P2** (malformed/missing activation dates can leave an active pilot eligible) → `validateActivationDates()` + new `PILOT_DATES_INVALID` code reject closed on: missing `activated_at`, empty `activated_at`, unparseable `activated_at`, missing `expires_at`, unparseable `expires_at`, `expires_at` at/before `activated_at`, and `expires_at` inconsistent with `activated_at + max_days`. `evaluatePilotCaps()` itself is separately hardened (defense in depth) against the same cases. Each case has its own explicit test.
- **P2** (new tests not wired into canonical `test:ops`/`pnpm verify`) → done; see above.
- **P2** (truth-check accepts loose text rather than parsing a `fable-review/v1` record) → `findLatestFableReview()` structurally parses the schema header, `Issue:`, `Trigger class:` (enum-checked), `Policy version:`, `Reviewed head SHA:`, and the three literal assertions, then F2 binds the record's `Reviewed head SHA` against the PR's actual head via `shaMatches()` — a stale or copy-pasted comment no longer satisfies the check.
- **Return Review Packet failing** → addressed by fixing the underlying scope-bleed (proof paths declared in `expected_proof_paths`) and test-wiring findings it was reporting.

## Known gaps (stated honestly, not omitted)

- `docs/05_operations/LANE_MANIFEST_SPEC.md`'s planned §17 documentation addition for `planning_model_routing` is still not in this diff — a separate, genuinely live lane (UTV2-1571) holds an active file-scope lease on that exact file. The field remains documented in the JSON schema and in `three-brain.md`/`OPERATING_MODEL_SONNET5.md` instead.
- `package.json` is also under an active file-scope lease held by a separate, genuinely live lane (UTV2-1570, same owner, building a Tier C authorization gate). This diff touches `package.json` anyway because the PM's own verdict explicitly required the test-wiring fix as core scope — but the concurrent-lease overlap is real; the two branches will need a routine merge-order coordination (a one-line conflict on `test:ops`) before both can land.
- The pilot itself has not been activated and has not run a single real qualifying task — the mechanism is proven correct by unit test, not by live pilot usage, since activation is out of this lane's scope by design.

## Owner boundary

T1 governance-critical, authority-touching change (executable model routing). Requires the `t1-approved` label and a Griff-authored `pm-verdict/v1` APPROVED comment bound to the reviewed head before merge. This proof supplies neither.
