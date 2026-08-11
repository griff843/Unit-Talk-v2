# PROOF: UTV2-1638 triage the red scripts/* test baseline

MERGE_SHA: N/A

Issue: UTV2-1638
Tier: T2
Lane type: governance
Branch: claude/utv2-1638-triage-red-scripts-tests
Head SHA: 96964d33ca9d8733327b1848cea35e0ec49046bf
Generated at: 2026-08-11T18:30:00Z
result: pass

> The merge-SHA anchor above is the bindable placeholder `N/A`, rebound
> post-merge by `post-merge-lane-close.yml`. Explanatory prose is kept off the
> anchor line deliberately: a descriptive value is not a bindable token and
> makes the rebinder refuse the whole closeout.

## Summary

`pnpm test` reports 4629 pass / 0 fail / exit 0 across 97 files, but the repo's
own coverage tool measures **467 test files, 119 unwired**. The suite is not red;
it is narrow.

UTV2-1638 owns the `scripts/**` slice. Of its 13 baseline entries, 10 were green
but unwired and 3 were `failing-triage`. This lane triages the failing three, as
the issue requires — *"wiring a red test blocks `verify` for the whole program,
so each needs triage first: is the test stale, or is it reporting a real
defect?"*

Answers: one was a real defect (12 cases, one cause), one was a stale assertion,
and one is a genuine defect owned by its own issue and deliberately left alone.

## Verification

ASSERTIONS:

- [x] `policy-engine` is green — all 12 failing cases resolved by one root-cause fix
- [x] `fix-sync-yml` is green — stale assertion replaced with real invariants, not deleted
- [x] The policy loader still **hard-errors** on a file it cannot classify (no silent fail-open)
- [x] `runtime-verifier-gate` is left as `failing-triage` — a real defect, not a stale test
- [x] Baseline `max_entries` is unchanged and did **not** grow
- [x] `ops:automation-coverage-check` passes with 0 new unwired tests
- [x] `pnpm type-check`, `pnpm lint`, `pnpm test`, `r-level-check` all pass

## Runtime Verification

EVIDENCE:

### 1. `policy-engine` — 12 failures, one cause

Before, every case threw the same error:

```text
error: 'Policy file must export a JSON array: codex-model-routing.json'
# tests 21
# pass 9
# fail 12
```

`docs/05_operations/policies/` holds two kinds of document. Measured:

```text
codex-concurrency.json          ARRAY len 2
codex-model-routing.json        OBJECT keys=['policy_version', 'schema_version', ...]
codex-safety-routing.json       ARRAY len 2
post-merge-qa.json              ARRAY len 1
t1-merge-gate.json              ARRAY len 1
tier-c-paths.json               ARRAY len 1
```

`loadPolicies()` globbed `*.json` and demanded an array, so the one
schema-versioned config document broke every caller. After:

```text
# tests 21
# pass 21
# fail 0
```

The fix classifies by **shape, not filename**, so a future config document
cannot reintroduce the break — and anything that is neither a rule-set array nor
a schema-versioned document is still a hard error. That matters: this is the
merge path, and a policy directory that silently evaluated to "no rules" would
be a fail-open.

### 2. `fix-sync-yml` — a stale assertion, replaced rather than deleted

The test asserted:

```text
not ok 2 - worktree-setup is marked as deprecated
```

`scripts/ops/worktree-setup.ps1` is a live 61-line script whose last functional
change was UTV2-1062; no commit reachable from `main` shows it was ever a
deprecated stub. The assertion described an intention, not the repository.

Deleting it would have lost coverage of a real script, so it was replaced with
assertions on the invariants the script exists to enforce — refusal to run in
the main checkout, refusal of a junctioned/symlinked `node_modules`, and a real
frozen install:

```text
# tests 2
# pass 2
# fail 0
```

### 3. `runtime-verifier-gate` — deliberately untouched

Left at `failing-triage`. Its baseline note is accurate: the gate exits 0 when
the supplied merge SHA is absent from the proof file, violating the SHA-binding
invariant. That is a real defect with its own owning issue, and fixing it here
would cross issues.

### 4. Coverage ratchet — did not grow

```text
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=467 required-reachable=312 optional-reachable=36 unwired=119 (baselined=119 new=0)
[executable-wiring] capabilities total=152 wired=134 orphan=18 (baselined=18 new=0)
[executable-wiring] baseline tests=119/119 capabilities=18/18
```

`max_entries` stays at 119 because nothing is wired yet. Wiring edits
`package.json`, which is held by another lane's scope lock — recorded honestly in
each entry's note rather than silently deferred.

The run also surfaces a standing warning this lane does not claim to fix:

```text
[WARN] WIRING_GLOB_SHADOWED apps/qa-agent/src/**/*.test.ts - POSIX sh expands "**" as a
single path segment, so 1 file(s) under this pattern never run
```

### 5. Gate commands

```text
pnpm type-check   exit=0
pnpm lint         exit=0
pnpm test         exit=0
```

### 6. `r-level-check`

```text
Verdict: PASS
Changed files: 9
Rules matched: (none) — no R-level artifacts required for this diff
```

### 7. `pnpm verify` — live-DB stage refused locally by design

```text
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx.
```

The containment guard behaving correctly; that stage runs in CI under
`staging-ci`. This lane touches no database code, migration, or runtime path.

## Scope

- `scripts/ops/policy-engine.ts` — loader classifies rule sets vs config documents
- `scripts/ops/fix-sync-yml.test.ts` — stale assertion replaced with real invariants
- `docs/05_operations/executable-wiring-baseline.json` — two entries retriaged, `max_entries` unchanged

No production code, no schema, no workflow, no migration.
