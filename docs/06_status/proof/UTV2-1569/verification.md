# PROOF: UTV2-1569

MERGE_SHA: 734be3bd20bd45f12e4a31ea16e6732c457e529c

(This is this branch's actual head at the time this proof was written — see the
accompanying executor-result/v1 comment for confirmation this matches the PR's
current head.)

## Summary

Enforceable Fable 5 pilot routing, cap, evidence, expiry, and rollback. See
`diff-summary.md` for the full file list and rationale.

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
  duration_ms: 17367.608779
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 16979.496818
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 16337.517773
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 15288.704961
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 816.694676
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 16407.463785
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 16155.643244
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
# duration_ms 99920.143595
```

Ran against Supabase project `zfzdnfwdarxucxtaojxm` using the repository's existing
`database-smoke.test.ts` suite. This diff is docs/governance/ops-tooling only (no
runtime code path changed); per this repo's precedent for doc-only/governance T1
lanes (UTV2-1503, UTV2-1568), the standalone live-DB smoke is still run for real
against Supabase rather than waived, so the gate has actual runtime evidence to bind
to instead of an unenforced "N/A" claim. The suite exercises the same
submission/settlement/outbox paths every T1 lane's live-DB smoke already covers, and
creates and cleans up its own test rows.

### New-mechanism unit test coverage (218 tests, all passing on this head)

```text
scripts/ops/fable-pilot-state.test.ts        20 pass, 0 fail
scripts/ops/planning-model-routing.test.ts   15 pass, 0 fail
scripts/ops/fable-pilot-rollback.test.ts      7 pass, 0 fail
scripts/ops/shared.test.ts                   43 pass, 0 fail (7 new planning_model_routing tests)
scripts/ops/lane-start.test.ts               17 pass, 0 fail (5 new fable-routing wiring tests)
scripts/ops/truth-check-lib.test.ts          59 pass, 0 fail (6 new Fable evidence tests)
scripts/ops/contract-validator.test.ts       53 pass, 0 fail (claude-fable-5 model-ID validation)
```

## R-level compliance

```text
$ tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 29
Rules matched: (none) — no R-level artifacts required for this diff
```

## Known gaps (stated honestly, not omitted)

- `docs/05_operations/LANE_MANIFEST_SPEC.md`'s planned §17 documentation addition for `planning_model_routing` was dropped from this diff — a live, concurrently-running lane (UTV2-1571) held an active file-scope lease on that exact file at implementation time. The field is documented in the JSON schema and in `three-brain.md`/`OPERATING_MODEL_SONNET5.md` instead. Recommended follow-up once UTV2-1571 closes.
- Mechanical enforcement of `lane-start.ts`'s new `--fable-trigger-class`/`--fable-rationale` flags is covered by source-text assertion tests (matching this file's existing testing convention for CLI wiring), not a full end-to-end CLI invocation test — `shared.test.ts`'s `createManifest`/`validateManifest` tests cover the manifest-level behavior those flags produce directly.
- The pilot itself has not been activated and has not run a single real qualifying task — the mechanism is proven correct by unit test, not by live pilot usage, since activation is out of this lane's scope by design.

## Owner boundary

T1 governance-critical, authority-touching change (executable model routing). Requires the `t1-approved` label and a Griff-authored `pm-verdict/v1` APPROVED comment bound to the reviewed head before merge. This proof supplies neither.
