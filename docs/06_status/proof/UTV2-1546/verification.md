# PROOF: UTV2-1546

Delegation kill switch: `docs/05_operations/DELEGATION_STATE.json` (default `suspended`)
plus a shared strict reader (`scripts/ops/delegation-state.ts`) consulted fail-closed by
every autonomous dispatch/execution entry point (`preflight.ts`, `lane-start.ts`,
`codex-exec.ts`, `claude-exec.ts`).

MERGE_SHA: e9cc7a0e

The SHA above is this lane's pre-merge implementation commit
(`claude/utv2-1546-delegation-kill-switch`), an ancestor of the eventual PR merge commit
— per this repo's accepted proof-binding convention, a commit cannot embed the hash of
the merge commit it will later become part of.

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
- [x] `STANDING_GUARDRAILS.md` was not touched (explicitly out of scope per the issue)

## EVIDENCE:

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
Changed files: 14
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
directly, only by the standalone `npx tsx --test` invocations above). `package.json` is
a declared singleton-only path, and at lane-start time it was already locked by another
active lane's `file_scope_lock` (UTV2-1554, PR already merged on GitHub but not yet
reconciled to `done` in its lane manifest — a ghost lane). Rather than touch a
contested shared file outside this lane's declared scope, this lane ships without that
one-line registration. Follow-up: once the ghost lane is reconciled, append
`scripts/ops/delegation-state.test.ts` to the `test:ops` script in `package.json` so
CI's `pnpm verify` executes it going forward.

The `STANDING_GUARDRAILS.md` note mentioned in the issue's broader "Delegation &
Accountability v1" effort is explicitly out of scope for this lane per the issue text
and was not touched.
