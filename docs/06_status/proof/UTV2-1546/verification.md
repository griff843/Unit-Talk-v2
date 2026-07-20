# PROOF: UTV2-1546

Delegation kill switch: `docs/05_operations/DELEGATION_STATE.json` (default `suspended`)
plus a shared strict reader (`scripts/ops/delegation-state.ts`) consulted fail-closed by
every autonomous dispatch/execution entry point (`preflight.ts`, `lane-start.ts`,
`codex-exec.ts`, `claude-exec.ts`).

MERGE_SHA: e9cc7a0e94164c139ae91170965b3bccdcdeb568

The SHA above is this lane's pre-merge implementation commit
(`claude/utv2-1546-delegation-kill-switch`), an ancestor of the eventual PR merge commit
— per this repo's accepted proof-binding convention, a commit cannot embed the hash of
the merge commit it will later become part of.

## Verification

T2 verification record for UTV2-1546 (delegation kill switch). Assertions and command
evidence follow below.

## ASSERTIONS:

- [x] `docs/05_operations/DELEGATION_STATE.json` exists, defaults to `{"delegation": "suspended", ...}`
- [x] `scripts/ops/delegation-state.ts` exports `readDelegationState()` and `requireDelegationActive(context)`, strictly parsing the state file
- [x] Missing file, unparseable JSON, non-object JSON, and any `delegation` value other than exactly `"active"` or `"suspended"` all resolve to the fail-closed (blocked) path — never a default-open fallback
- [x] `preflight.ts` calls `requireDelegationActive('preflight')` before every other check (before `validatePreflightSchemaDependencies()`, before any Linear call, before any baseline verify/test run, before any token write) and returns exit code 1 (FAIL verdict) when blocked
- [x] `lane-start.ts` calls `requireDelegationActive('lane-start')` as the first statement inside `main()`'s try block — before argument validation, before the substrate guard, before `reserveLease`, `createBranchAndWorktree`, and `createManifest` — and exits 1 when blocked
- [x] `codex-exec.ts` calls `requireDelegationActive('codex-exec')` immediately before the `spawnSync('codex', codexArgs, ...)` call (after the `--dry-run` early return, so dry-run preview stays available) and exits with code 2 when blocked
- [x] `claude-exec.ts` calls `requireDelegationActive('claude-exec')` immediately before the `runner('claude', claudeArgs, ...)` spawn call (after the `--dry-run` early return) and returns exit code 2 when blocked
- [x] With `delegation: "active"`, all four entry points behave exactly as they did before this change (no behavior change) — verified by the full existing `preflight.test.ts` / `lane-start.test.ts` / `codex-exec.test.ts` / `claude-exec.test.ts` suites staying green
- [x] Unit tests cover missing file, malformed file (unparseable JSON, non-object JSON, missing `delegation` field, invalid `delegation` values including wrong case/type), suspended, and active states in `scripts/ops/delegation-state.test.ts`
- [x] Tests cover the "stale-token" scenario: the delegation check runs before preflight-token validation/writes in both `lane-start.ts` and `preflight.ts`, so a fresh-or-stale token can never bypass a suspended delegation state
- [x] Tests cover the "existing-lane-execution" scenario: `codex-exec.ts`/`claude-exec.ts` load the manifest of an already-started lane and still gate the spawn on delegation, strictly before the process spawn
- [x] `pnpm verify:parallel` is green on this branch
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` returns PASS with no additional required artifacts
- [x] `pnpm test:db` run for real against live Supabase (this repo's proof-auditor-gate requires it for any changed proof directory regardless of tier; this lane touches no DB code, so the run is a smoke-test confirmation, not issue-specific evidence)
- [x] `STANDING_GUARDRAILS.md` was not touched (explicitly out of scope per the issue)
- [x] `scripts/ops/delegation-state.test.ts` is wired into `package.json`'s `test:ops`; `pnpm test:ops` runs it directly (1092 tests passing) — see Known Gaps for the unresolved cross-lane scope conflict this required touching `package.json` into

## Evidence / EVIDENCE:

### pnpm test:db (T2 lane, no DB code touched — run for real against live Supabase to satisfy this repo's mechanical proof-auditor-gate requirement, not because this change touches the database layer)

```
$ pnpm test:db
> @unit-talk/v2@0.1.0 test:db
> tsx --test apps/api/src/database-smoke.test.ts

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
# duration_ms 102741.768473
```

### delegation-state.test.ts (all states: missing / malformed / suspended / active / stale-token / existing-lane-execution)

```
$ npx tsx --test scripts/ops/delegation-state.test.ts
...
1..21
# tests 21
# suites 0
# pass 21
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 440.567005
```

### Entry-point wiring tests (preflight / lane-start / codex-exec / claude-exec) stay green alongside the new delegation coverage

```
$ npx tsx --test scripts/ops/delegation-state.test.ts scripts/ops/preflight.test.ts scripts/ops/lane-start.test.ts scripts/ops/codex-exec.test.ts scripts/ops/claude-exec.test.ts
...
1..68
# tests 68
# suites 0
# pass 68
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 768.42483
```

### Type-check

```
$ pnpm type-check
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json
```

(no output = clean build; exit code 0)

### Lint

```
$ pnpm lint
> @unit-talk/v2@0.1.0 lint
> eslint . --cache --cache-location .cache/eslint/
```

(no output = clean; exit code 0)

### R-level check

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 16
Rules matched: (none) — no R-level artifacts required for this diff
```

### pnpm verify:parallel (full green run on this branch)

```
$ pnpm verify:parallel
> @unit-talk/v2@0.1.0 verify:parallel
> node scripts/verify-parallel.mjs

...
[verify:parallel] all checks passed
```

## Known Gaps

`scripts/ops/delegation-state.test.ts` IS wired into `package.json`'s `test:ops`
aggregate list (`pnpm test:ops` / `pnpm test` / `pnpm verify` now all execute it
directly, confirmed by the full `pnpm test:ops` run below — 1092 tests passing,
including the 21 delegation-state cases).

This required touching `package.json`, which sits in an unresolved cross-lane
conflict, tracked here for transparency:

1. `package.json` was originally locked by another lane's `file_scope_lock` — that
   lane's PR (#1250) had already merged on GitHub, but its closeout/reconciliation PR
   (#1262) was stale/dirty against current `main` and never landed, leaving the ghost
   lane's manifest still counted as active.
2. `scripts/ci/file-scope-guard.ts` (the CI check that mechanically enforces file scope
   on every PR) pins a lane's allowed scope to whichever `file_scope_lock` array was
   present in the **first commit** on the branch that added the lane manifest — a
   deliberate anti-self-widening protection. A later commit editing `file_scope_lock`
   to add `package.json` has no effect on what that specific guard allows.
3. A fresh replacement reconciliation PR (#1270) has since been opened and the stale
   #1262 closed, but #1270 is itself T1 and requires human review before it merges, so
   the ghost lane's `file_scope_lock` conflict on `main` has not cleared yet at the time
   of this push.

Net effect: this lane's own manifest (`docs/06_status/lanes/UTV2-1546.json`) now
honestly declares `package.json` in its `file_scope_lock`, and `package.json` itself is
correctly wired — but the **advisory, non-required** "File scope lock" and "Return
review packet" checks may still show red on this PR until #1270 merges and the ghost
lane's conflicting manifest clears from `main`. Per this repo's branch protection
(`required_status_checks`: `verify`, `Executor Result Validation`, `Merge Gate`,
`P0 Protocol`), neither of those two checks blocks merge, and this is expected to
self-resolve without any further action on this branch once #1270 lands.

The `STANDING_GUARDRAILS.md` note mentioned in the issue's broader "Delegation &
Accountability v1" effort is explicitly out of scope for this lane per the issue text
and was not touched.

### pnpm test:ops (full aggregate, confirming delegation-state.test.ts now runs as part of it)

```
$ pnpm test:ops
...
1..1080
# tests 1092
# suites 6
# pass 1092
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Addendum: human ratification of activation (2026-07-20)

Addendum parent SHA (ancestor of this addendum's own commit, per this repo's
proof-binding convention -- a commit cannot embed its own hash):
f0c3bda609399d3e323b128db0c08ce4f0b86cce (merge commit of #1269, the PR that
shipped the kill switch this addendum activates).

`docs/05_operations/DELEGATION_STATE.json`'s `delegation` field was flipped from
`suspended` to `active` per griff843's explicit direction, after confirming (via this
PR's own CI) that the kill switch is wired fail-closed at all four dispatch/exec entry
points (`preflight.ts`, `lane-start.ts`, `codex-exec.ts`, `claude-exec.ts`) and that
suspension correctly halted new dispatch as designed. This is the human-ratification
event `docs/05_operations/DELEGATION_STATE.json`'s own `reason` field anticipates.

The one self-consistency test that hard-coded the shipped file's value
(`the real shipped DELEGATION_STATE.json parses and defaults to suspended`) was
rewritten to assert only that the file exists and parses as a well-formed state
(`active` or `suspended`), not a specific value — the whole point of this file is that
its value legitimately changes over time as delegation is ratified or suspended.

### Addendum evidence

```
$ npx tsx --test scripts/ops/delegation-state.test.ts scripts/ops/preflight.test.ts scripts/ops/lane-start.test.ts scripts/ops/codex-exec.test.ts scripts/ops/claude-exec.test.ts
...
1..68
# tests 68
# suites 0
# pass 68
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
