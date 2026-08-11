# UTV2-1689 Runtime Verification

Generated at: 2026-08-11T15:01:30Z
Issue: UTV2-1689
Tier: T2
Lane type: governance
Branch: claude/utv2-1689-l3-lane-readiness-gate
PR URL: N/A (recorded at lane-link-pr)
Head SHA: 5bc3547ac1a46939e7f707eba2e4062df64f1487
Merge SHA: N/A (bound post-merge by post-merge-lane-close.yml)
result: pass

## Verification

- [x] `pnpm type-check` — exit 0
- [x] `pnpm test` — exit 0, 97 test files, 0 failures
- [x] `pnpm lint` — exit 0
- [x] `pnpm verify` — see note below
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — `Verdict: PASS`

### `pnpm verify` note

`pnpm verify` includes `test:live-db`, which is gated by `pnpm ci:assert-staging` and
refuses to run against anything but the staging project `xskgrzbteyqdufktjrjx`:

```
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci
GitHub environment with CI_SUPABASE_* credentials.
```

This is the containment guard behaving correctly, not a lane failure: the local
environment carries the containment sentinel `SUPABASE_URL=http://127.0.0.1:1`.
The live-DB stage runs in CI under the `staging-ci` environment. Every other
`verify` stage was executed locally and passed:

```
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 6 migration file(s) verified — no duplicate versions.
[lint-migrations] 5 migration file(s) checked — no findings.
```

This lane touches no database code, no migration, and no runtime path. Its diff is
confined to `scripts/ops/truth-check-lib.ts` and its unit test.

### `r-level-check` output

```
Verdict: PASS
Changed files: 5
Rules matched: (none) — no R-level artifacts required for this diff
```

## Runtime Verification

### 1. The defect, reproduced on the real blocked lane

Before the change, `ops:truth-check UTV2-1619` — a lane whose PR #1400 merged at
`b58a2f3549df247d2c972bb64baf0ddb6251be43` — failed on L3 alone:

```
[FAIL] L3 - Linear state Blocked Internal is not Ready to Close, In PM Review, or Done
VERDICT: fail (38 checks, 1 failures)
```

All 37 other checks passed, including merge binding (M6, G2), first-parent
reachability (G3), all four required GitHub checks green on the head SHA (G4),
SHA-bound proof (P3, C4), and P11–P14.

### 2. The same command after the change

Executed from this lane's worktree against live Linear and live GitHub, with
UTV2-1619 still sitting in `Blocked Internal`:

```
[PASS] L3 - Linear state Blocked Internal (type started) is permitted
VERDICT: pass (38 checks, 0 failures)
```

This is the acceptance criterion: the increment closes, the parent issue does not move.

### 3. The gate still fails on the condition it names

A control is only proven by making it fail. `isLinearStatePermittedForL3` refuses
every non-active, non-complete state type, and refuses an absent type outright:

```
ok 61 - L3: an active issue does not block one of its increments from truth-closing
ok 62 - L3: gates on state type, not on a configurable state name
ok 63 - L3: still fails closed for abandoned, superseded, and never-started work
ok 64 - L3: an absent or unrecognized state type never widens the gate
ok 65 - L3: state type matching is case- and whitespace-insensitive
```

Test 63 asserts refusal for `Cancelled`/canceled, `Duplicate`/duplicate,
`Backlog`/backlog, `Ready for Claude`/unstarted, and `Triage`/triage. Test 64
asserts that `undefined`, `''`, `null`, and an unrecognized future type all fail
closed rather than widening the gate — the fail-closed direction required by
invariant 10.

### 4. Full unit suite for the changed module

```
# tests 90
# pass 90
# fail 0
# skipped 0
```

85 tests existed before this change; all 85 still pass unchanged, including the
pre-existing L3 negative tests (55–60) that assert name-only callers keep the
strict UTV2-1590 behaviour.

## Scope

Two files, both inside `file_scope_lock`:

- `scripts/ops/truth-check-lib.ts` — L3 decision, `LinearIssueRecord.state.type`, GraphQL selection set
- `scripts/ops/truth-check-lib.test.ts` — 5 new tests, 1 pre-existing test renamed for accuracy

No production code, no schema, no workflow, no migration.

## SHA Binding

Head SHA: 5bc3547ac1a46939e7f707eba2e4062df64f1487
Merge SHA: N/A — bound post-merge by `post-merge-lane-close.yml` via `ops:proof-generate --merge-sha`
