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

`scripts/ops/delegation-state.test.ts` is not wired into `package.json`'s `test:ops`
aggregate list (and therefore is not exercised by `pnpm test`/`pnpm verify`'s test step
directly, only by the standalone `npx tsx --test` invocations above, which this proof
bundle embeds real output from). This is a hard mechanical block, not a soft choice:

1. `package.json` is a declared singleton-only path, and at lane-start time it was
   already locked by another lane's `file_scope_lock` — that lane's PR (#1250) had
   already merged on GitHub, but its lane manifest had not been reconciled to `done`
   (a ghost lane), so it was still counted as active.
2. Even independent of (1), `scripts/ci/file-scope-guard.ts` (the CI check that
   mechanically enforces file scope on every PR) pins a lane's allowed scope to
   whichever `file_scope_lock` array was present in the **first commit** on the branch
   that added the lane manifest — a deliberate anti-self-widening protection (see the
   `outside_scope`/ghost-lane handling added under prior scope-guard hardening work).
   A later commit editing `file_scope_lock` to add `package.json` has no effect on what
   the guard allows. Widening scope for an already-started lane requires either an
   authorized scope-override PR comment (`docs/05_operations/schemas/scope-override-v1.md`)
   from a human/CODEOWNERS reviewer, tied to one specific head SHA, or starting a fresh
   lane — neither of which this lane can self-grant.

This PR therefore deliberately does not touch `package.json` at all. Follow-up: once the
ghost lane is reconciled, a small follow-up PR (or an authorized scope-override comment
on a future push to this branch) can append `scripts/ops/delegation-state.test.ts` to
`test:ops` so `pnpm verify` executes it going forward.

The `STANDING_GUARDRAILS.md` note mentioned in the issue's broader "Delegation &
Accountability v1" effort is explicitly out of scope for this lane per the issue text
and was not touched.
