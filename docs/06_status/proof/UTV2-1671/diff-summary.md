# UTV2-1671 Diff Summary

Generated at: 2026-08-30T21:38:43.325Z
Issue: UTV2-1671
Tier: T1
Lane type: governance
Branch: claude/utv2-1671-admit-contract-paths
PR URL: N/A
Head SHA: 66d7fa65dfff6bb6ec727165a1c206060238157c
Merge SHA: N/A
Diff base: 249da64b1108815f1bde07e82414535e64fe4382
Diff target: 66d7fa65dfff6bb6ec727165a1c206060238157c

## Git Diff Stat
```
.lane/lanes/runtime.yml                 |  10 ++
 .ops/sync/UTV2-1671.yml                 | 245 ++++++++++++++++++++++++++++++++
 docs/06_status/lanes/UTV2-1671.json     |  37 +++++
 docs/06_status/proof/UTV2-1671/.gitkeep |   0
 4 files changed, 292 insertions(+)
```

## Git Name Status
```
M	.lane/lanes/runtime.yml
A	.ops/sync/UTV2-1671.yml
A	docs/06_status/lanes/UTV2-1671.json
A	docs/06_status/proof/UTV2-1671/.gitkeep
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 66d7fa65dfff6bb6ec727165a1c206060238157c
Merge SHA: N/A

## What changed and why

`.lane/lanes/runtime.yml` gains exactly two entries in `allowed_path_globs`:

- `packages/contracts/src/smart-form.ts`
- `packages/contracts/src/index.ts`

Nothing else in the file changes. No entry was removed, no
`forbidden_path_globs` entry was touched, `required_proof_artifacts` and
`merge_policy` are unchanged, and no other lane definition was edited.

### The defect this corrects

The Track Only contract module and the contracts barrel that re-exports it are
consumed by `apps/api` runtime code, but neither path appeared in the
`allowed_path_globs` of any lane type. The required `Lane authority` check
therefore refused the runtime change with `outside_allowed_paths`, and no lane
type could legally carry it. This is an admission gap in the lane taxonomy,
not a policy question: the work is ordinary runtime work whose contract module
had simply never been admitted.

`packages/contracts/src/promotion.ts` is the existing precedent for this exact
shape -- a single contract module admitted to the runtime lane by name. The
two entries added here follow that form deliberately.

### Why this is not a glob

`packages/contracts/src/**` would have been a one-line change and is
explicitly **not** what was done. A directory glob would admit every contract
module in the package -- `submission.ts`, `distribution.ts`, `picks.ts`,
`settlement.ts`, and the rest -- to the runtime lane, which is a taxonomy
change, not an admission correction. The exhaustive control in
`verification.md` confirms that after this change exactly two on-disk contract
modules are admitted (`index.ts` from this change and the pre-existing
`promotion.ts`), and sixteen remain refused.

### Scope boundaries observed

- No taxonomy change: no lane type gained or lost a category of path.
- No executor-policy change: nothing here alters who may execute what tier.
- No `forbidden_path_globs` weakening: `packages/domain/src/**`,
  `supabase/migrations/**`, and `packages/**/database.types.ts` remain
  forbidden to the runtime lane, and the negative controls prove it.
- No source code, workflow, or schema change. The diff is one YAML allowlist
  plus this lane's own manifest, sync record, and proof bundle.

## Observation recorded, not acted on

`.lane/lanes/**` is itself inside the runtime lane's `allowed_path_globs`,
which means a runtime lane can amend its own path authority. That predates
this change and is untouched by it. It is noted here as a governance
observation for separate triage; widening or narrowing it is outside this
lane's authorized scope.
