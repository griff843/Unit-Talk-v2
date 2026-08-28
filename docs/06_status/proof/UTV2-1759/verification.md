# PROOF: UTV2-1759 — Verification
MERGE_SHA: c93bd8ffc77da340495c55f85c857beeeab68403

Issue: UTV2-1759 — Post-merge S1 scope evaluation rejects the lane's own
required lifecycle metadata, making truthful closeout structurally impossible.
Tier: T2. Lane type: governance. Proof profile: static.

## Verification

### What was actually wrong

`ops:lane-start` creates `docs/06_status/lanes/<ISSUE>.json` and
`.ops/sync/<ISSUE>.yml`. The dispatch procedure requires committing both to the
lane branch. Neither is normally declared in `file_scope_lock`, which is frozen
at lane-start and cannot be widened by the lane itself.

So both files were in the merged diff of essentially every lane, outside its
declared scope, and S1 (`evaluateScopeDiff`) rejected them.

The pre-merge file-scope guard did not have this problem: it has granted exactly
these paths unconditionally since UTV2-1518, via the private
`ownLaneControlPlanePatterns(manifest)`. The post-merge S1 check knew nothing
about that grant. Two gates over one invariant, carrying divergent definitions —
the same failure class UTV2-1640 fixed once already for glob semantics, in this
same pair of gates.

Verified against the real blocked lane rather than asserted. With UTV2-1758's
actual `files_changed` and `file_scope_lock`, S1's failure detail before this
change is exactly:

```text
files_changed outside file_scope_lock: docs/06_status/lanes/UTV2-1758.json
```

One file, and it is the lane's own manifest. That exact string is asserted in
regression 10, so the claim "the manifest was the sole blocker" is executable
rather than narrative.

### The fix

One shared definition, not a second copy:

- `scripts/ci/file-scope-guard.ts` exports `laneLifecycleScopePatterns(issueId)`.
- `ownLaneControlPlanePatterns(manifest)` (pre-merge) now delegates to it.
- `evaluateScopeDiff` (post-merge S1) appends it to the allowed patterns.

The two guards can no longer drift into disagreeing about what a lane's own
lifecycle metadata is, because there is only one place that says so.

It is exact-lane only. `laneLifecycleScopePatterns('UTV2-1759')` returns exactly:

```text
.ops/sync/UTV2-1759.yml
docs/06_status/lanes/UTV2-1759.json
docs/06_status/proof/UTV2-1759/**
```

There is no `docs/06_status/lanes/**` and no `.ops/sync/**`. A malformed or
absent issue ID fails `ISSUE_ID_PATTERN` (`^UTV2-\d+$`) and returns `[]`, so an
unidentifiable lane receives no grant rather than a grant it could shape.

### Checklist

ASSERTIONS:

- [x] The lane's own manifest passes S1 without being in `file_scope_lock`.
- [x] The lane's own sync file passes S1 without being in `file_scope_lock`.
- [x] Another issue's manifest still fails S1.
- [x] Another issue's sync file still fails S1.
- [x] An arbitrary file under `docs/06_status/lanes/` still fails S1.
- [x] An arbitrary file under `.ops/sync/` still fails S1.
- [x] A missing or malformed issue ID grants nothing.
- [x] The pre-existing proof exemptions are unchanged.
- [x] The real UTV2-1758 fixture passes, and its historical failure is
      reproduced exactly when the grant is withheld.
- [x] Pre-merge and post-merge guards share one function, not two lists.
- [x] Mutation control: removing the exemption, and replacing it with a broad
      prefix, each make specific named regressions fail.

## Runtime Verification

EVIDENCE:

### 1. Lane suite — `scripts/ops/truth-check-lib.test.ts`

108 pre-existing tests plus 11 new regressions.

```text
pnpm exec tsx --test scripts/ops/truth-check-lib.test.ts
# tests 119
# suites 0
# pass 119
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### 2. Pre-merge guard suite — `scripts/ci/file-scope-guard.test.ts`

Unchanged by this lane; run to prove the delegation refactor of
`ownLaneControlPlanePatterns` preserved pre-merge behaviour exactly.

```text
pnpm exec tsx --test scripts/ci/file-scope-guard.test.ts
# tests 46
# suites 0
# pass 46
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### 3. Mutation control — run against the REAL source, not only a harness

A green suite proves nothing about a guard. Both mutants were applied to
`scripts/ops/truth-check-lib.ts` itself and the suite re-run.

**Control A — the exact-lane exemption REMOVED** (`, ...laneLifecycleScopePatterns(issueId)` deleted):

```text
not ok 107 - S1/1759: the lane's own manifest passes even though file_scope_lock never declares it
not ok 108 - S1/1759: the lane's own sync file passes even though file_scope_lock never declares it
not ok 109 - S1/1759: both lifecycle files together pass, and the issue ID is matched case-insensitively
not ok 116 - S1/1759: the real UTV2-1758 lane now passes S1, and failed before only on its own manifest
not ok 118 - S1/1759 mutation: REMOVING the exact-lane exemption makes the UTV2-1758 fixture fail again
not ok 119 - S1/1759 mutation: a BROAD PREFIX implementation fails the cross-lane regressions
# tests 119
# pass 113
# fail 6
```

**Control B — a BROAD PREFIX implementation** (`'docs/06_status/lanes/**', '.ops/sync/**'`):

```text
not ok 110 - S1/1759: ANOTHER issue's manifest still fails — the grant is not a directory exemption
not ok 111 - S1/1759: ANOTHER issue's sync file still fails
not ok 112 - S1/1759: an arbitrary file under docs/06_status/lanes/ still fails
not ok 113 - S1/1759: an arbitrary file under .ops/sync/ still fails
not ok 114 - S1/1759: a missing or malformed issue ID grants nothing — the exemption fails closed
not ok 116 - S1/1759: the real UTV2-1758 lane now passes S1, and failed before only on its own manifest
not ok 118 - S1/1759 mutation: REMOVING the exact-lane exemption makes the UTV2-1758 fixture fail again
not ok 119 - S1/1759 mutation: a BROAD PREFIX implementation fails the cross-lane regressions
# tests 119
# pass 111
# fail 8
```

This is the point of the second control. Control B is the mutant a happy-path
suite cannot distinguish from the real fix: it passes every "own manifest is
accepted" test while silently admitting every other lane's lifecycle metadata.
It is caught only by regressions 4–8. The source was restored byte-for-byte
after each run (`git diff --stat` back to the committed shape).

The two controls are also encoded as executable tests (118, 119) so the suite
re-proves them on every run, rather than relying on this transcript.

### 4. Full suite

```text
pnpm verify
verify:static     PASS (env:check, lint, type-check, build all exit 0)
pnpm type-check   exit 0 (tsc -b tsconfig.json, project references)
pnpm lint         exit 0
pnpm test         97 suites, 0 failing (exit 0)
```

`test:live-db` refuses locally by design:

```text
[assert-staging] REFUSED: target identity could not be resolved from its URL
```

An environment gate, not a code failure, and unobtainable outside the staging-ci
environment. Required CI `verify` runs it with those credentials. This lane is
T2, touches no DB surface, and changes no runtime behaviour.

### 5. R-level

```text
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```

## Known gaps

- **The grant is derived from the manifest's own `issue_id`.** A manifest whose
  `issue_id` disagreed with its filename would grant against the field, not the
  path. That mismatch is already rejected upstream by `ops:truth-check` M3
  (`manifest.issue_id` must match the CLI argument) and by manifest schema
  validation, so it is not reachable through the close path — but this function
  does not independently re-derive the ID from the path.
- **`docs/06_status/proof/<issue>/**` is included in the shared patterns and is
  redundant inside S1**, which already exempts the whole `docs/06_status/proof/`
  prefix unconditionally. It is kept so the pre-merge and post-merge callers
  share one list rather than two subsets. The pre-existing broader S1 proof
  exemption is deliberately left unchanged by this lane.
- **The pre-merge guard's grant is now validated where it previously was not.**
  `ownLaneControlPlanePatterns` used `manifest.issue_id` verbatim; it now goes
  through `laneLifecycleScopePatterns`, which uppercases and requires
  `^UTV2-\d+$`. This is strictly safer — a malformed ID now grants nothing
  instead of granting a path built from it — but it is a real behaviour change on
  the pre-merge path, so it is stated rather than buried. It is a no-op on every
  manifest that exists: `lane_manifest_v1.schema.json` already constrains
  `issue_id` to `^UTV2-[0-9]+$`, and a sweep of all lane manifests in
  `docs/06_status/lanes/` found zero non-canonical IDs. All 46 pre-merge guard
  tests pass unchanged.
- **This lane changes S1 only.** It does not touch `file_scope_lock` freezing,
  `scope-override/v1` resolution, or the audited narrowing path
  (`ops:lane-manifest scope-release`, UTV2-1762). Widening still requires an
  external override.
- UTV2-1760, UTV2-1761, UTV2-1763 and UTV2-1764 remain recorded and unstaffed.
  None was folded into this lane.
