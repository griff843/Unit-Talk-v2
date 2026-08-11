# PROOF: UTV2-1689

MERGE_SHA: 86bb64ceabd7ce9d185b44b2c1378291b607b6a8

> Branch head at authoring time. Rebound to the authoritative merge SHA
> post-merge by `post-merge-lane-close.yml` via `ops:proof-generate --merge-sha`.

Issue: UTV2-1689
Tier: T2
Lane type: governance
Branch: claude/utv2-1689-l3-lane-readiness-gate
PR: https://github.com/griff843/Unit-Talk-v2/pull/1402
Generated at: 2026-08-11T15:01:30Z
result: pass

## Verification

ASSERTIONS:

- [x] `ops:truth-check` reaches `VERDICT: pass` with zero failures on a lane whose parent issue is in a non-terminal state
- [x] The parent issue is NOT transitioned toward Done by this change
- [x] A cancelled, duplicate, backlog, unstarted, or triage parent issue still fails L3 — proven by making the gate fail on the condition it names, not by a green run
- [x] An absent or unrecognized state type fails closed and never widens the gate
- [x] All 85 pre-existing tests in the changed module still pass unchanged
- [x] `pnpm type-check`, `pnpm test`, `pnpm lint`, and `r-level-check` all pass

## Runtime Verification

EVIDENCE:

### 1. The defect, reproduced on a real merged-but-unclosable lane

A lane whose PR merged at `b58a2f3549df247d2c972bb64baf0ddb6251be43`, before the change:

```text
[FAIL] L3 - Linear state Blocked Internal is not Ready to Close, In PM Review, or Done
VERDICT: fail (38 checks, 1 failures)
```

All 37 other checks passed — merge binding (M6, G2), first-parent reachability (G3),
all four required GitHub checks green on the head SHA (G4), SHA-bound proof (P3, C4),
and P11 through P14.

### 2. The same command after the change

Executed from this lane's worktree against live Linear and live GitHub, with the
parent issue still sitting in `Blocked Internal`:

```text
[PASS] L3 - Linear state Blocked Internal (type started) is permitted
VERDICT: pass (38 checks, 0 failures)
```

The increment closes. The parent issue does not move.

### 3. The gate still fails on the conditions it names

```text
ok 61 - L3: an active issue does not block one of its increments from truth-closing
ok 62 - L3: gates on state type, not on a configurable state name
ok 63 - L3: still fails closed for abandoned, superseded, and never-started work
ok 64 - L3: an absent or unrecognized state type never widens the gate
ok 65 - L3: state type matching is case- and whitespace-insensitive
```

Test 63 asserts refusal for `Cancelled`/canceled, `Duplicate`/duplicate,
`Backlog`/backlog, `Ready for Claude`/unstarted, and `Triage`/triage.
Test 64 asserts that `undefined`, `''`, `null`, and an unrecognized future type
all fail closed — the fail-closed direction required by invariant 10.

### 4. Full unit suite for the changed module

```text
# tests 90
# pass 90
# fail 0
# skipped 0
```

85 tests existed before this change; all 85 still pass, including the pre-existing
L3 negative tests (55 through 60) asserting that name-only callers keep the strict
prior behaviour.

### 5. `pnpm type-check`

```text
> pnpm exec tsc -b tsconfig.json
exit=0
```

### 6. `pnpm test`

```text
exit=0
97 test files reporting "# fail 0"
```

### 7. `pnpm lint`

```text
> eslint . --cache --cache-location .cache/eslint/
exit=0
```

### 8. `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

```text
Verdict: PASS
Changed files: 5
Rules matched: (none) — no R-level artifacts required for this diff
```

### 9. `pnpm verify` — live-DB stage refused locally by design

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci
GitHub environment with CI_SUPABASE_* credentials.
```

This is the containment guard behaving correctly, not a lane failure: the local
environment carries the containment sentinel `SUPABASE_URL=http://127.0.0.1:1`.
The live-DB stage runs in CI under the `staging-ci` environment. Every other
`verify` stage was executed locally and passed:

```text
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 6 migration file(s) verified — no duplicate versions.
[lint-migrations] 5 migration file(s) checked — no findings.
```

This lane touches no database code, no migration, and no runtime path.

## Scope

Two source files, both inside `file_scope_lock`:

- `scripts/ops/truth-check-lib.ts` — L3 decision, `state.type` on the Linear record and in the GraphQL selection set
- `scripts/ops/truth-check-lib.test.ts` — 5 new tests; 1 pre-existing test renamed for accuracy, behaviour unchanged

No production code, no schema, no workflow, no migration.
