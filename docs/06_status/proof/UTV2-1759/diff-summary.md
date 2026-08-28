# UTV2-1759 — Diff Summary

MERGE_SHA: 09d5068a35074770171d8b40e2fcb8a95e3f5dc0

Post-merge S1 scope evaluation rejected the lane's own required lifecycle
metadata, making truthful closeout structurally impossible. T2, governance
tooling only.

**Anchor SHA:** `09d5068a35074770171d8b40e2fcb8a95e3f5dc0` (last non-proof commit)
**Substantive diff:** 3 files, 359 insertions(+), 7 deletions(-)

| File | Δ | What changed |
|---|---|---|
| `scripts/ci/file-scope-guard.ts` | +42/−5 | New exported `laneLifecycleScopePatterns(issueId)` — the single definition of a lane's own lifecycle bookkeeping paths, keyed to an exact issue ID. The pre-existing private `ownLaneControlPlanePatterns(manifest)` now delegates to it instead of carrying its own copy. New `ISSUE_ID_PATTERN` (`^UTV2-\d+$`) so a malformed ID yields no patterns. |
| `scripts/ops/truth-check-lib.ts` | +17/−2 | `evaluateScopeDiff` takes an optional `issueId` and appends `laneLifecycleScopePatterns(issueId)` to the allowed patterns; the S1 call site passes `manifest.issue_id`. |
| `scripts/ops/truth-check-lib.test.ts` | +300 | 11 regressions and 2 executable mutation controls. |

## The defect

`ops:lane-start` creates `docs/06_status/lanes/<ISSUE>.json` and
`.ops/sync/<ISSUE>.yml`, and the dispatch procedure requires committing both to
the branch. Neither is normally declared in `file_scope_lock`, which is frozen
at lane-start. So both landed in the merged diff of essentially every lane while
being outside its declared scope, and S1 rejected them.

The pre-merge file-scope guard already granted exactly these paths
unconditionally (`ownLaneControlPlanePatterns`, UTV2-1518). The post-merge S1
check knew nothing about them. Two gates over one invariant carrying divergent
definitions — the same failure class UTV2-1640 fixed once already for glob
semantics, in this same pair of gates. A lane could not pass the close gate by
doing exactly what the lane procedure told it to do.

## Why the fix is exact-lane only

Every pattern is keyed to a specific issue ID. There is deliberately no
`docs/06_status/lanes/**` and no `.ops/sync/**`: a directory exemption would let
any lane's merged diff carry any OTHER lane's lifecycle metadata, which is
precisely the cross-lane scope bleed both guards exist to catch. That mutant is
tested, not merely asserted — see the mutation control in `verification.md`.

## Not touched

- `evaluateScopeDiff`'s pre-existing exemptions (`docs/06_status/proof/` prefix,
  `deleted-file` markers, `expected_proof_paths`) are unchanged.
- `file_scope_lock` / `expected_proof_paths` / `scope-override/v1` resolution in
  the pre-merge guard — unchanged. Widening still requires an external override.
- `package.json`, the executable-wiring baseline, and any new test file. The
  regressions live in the already-wired `scripts/ops/truth-check-lib.test.ts`
  (UTV2-1764 remains recorded and unstaffed).
- No lane manifest other than this lane's own. No DB, migration, runtime,
  deployment, ingestion, delivery, or production surface.
