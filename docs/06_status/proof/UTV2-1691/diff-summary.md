# UTV2-1691 — diff summary (increment 1: dry-run capability)

MERGE_SHA: 517ec85b93c8e55a3fe273793f0a7451be7e4bde

Verified implementation SHA: `517ec85b93c8e55a3fe273793f0a7451be7e4bde`

## Changed files

```
 scripts/ops/truth-check-lib.test.ts | 156 +++++++++++++++++++++++++++++++++-
 scripts/ops/truth-check-lib.ts      |  59 ++++++++++++-
 scripts/ops/truth-check.ts          |  19 +++++
 3 files changed, 231 insertions(+), 3 deletions(-)
```

All paths are inside the lane's declared `file_scope_lock`. The lane additionally
declares increment 2's paths (`scripts/ops/shared.ts`, `scripts/ci/file-scope-guard.ts`,
`docs/05_operations/LANE_MANIFEST_SPEC.md`) so scope is not re-frozen mid-lane;
**none of them is touched by this increment.**

## `scripts/ops/truth-check-lib.ts`

- `RunTruthCheckOptions.dryRun?: boolean` — documented as gating persistence only,
  and as a diagnosis that never certifies.
- `const dryRun = options.dryRun ?? false` read once in `runTruthCheck`, so every
  exit path carries the same value.
- `dryRun` threaded into all **five** `finalizeWithManifest` call sites.
- `finalizeWithManifest` exported, with `dryRun` and an injectable
  `writeManifestFn` on its input.
- The sole persistence site becomes:

```ts
if (!input.dryRun) {
  (input.writeManifestFn ?? writeManifest)(updated);
}
```

Nothing above that line changes. `updated` and the returned result are built
identically in both modes.

## `scripts/ops/truth-check.ts`

- `--dry-run` flag wired to `dryRun`.
- `--explain` annotated in code as presentation-only and explicitly **not** a safe
  mode.
- Human output gains a `=== DRY RUN — nothing was written; this diagnoses, it does
  not certify ===` banner and a closing line stating no `truth_check_history`
  entry was recorded and the lane is not closeable on that basis.

## `scripts/ops/truth-check-lib.test.ts`

Four regressions added (90 → 94 tests):

1. **A dry run never invokes persistence**, on the exit-code-4 reopen path.
2. **The live path still persists**, and carries the real mutation.
3. **Dry and live produce an identical verdict**, check list, failure set, exit
   code, merge SHA and PR URL — the mechanical proof of one shared path.
4. **Source-level audit guard** — fails if any future edit adds a filesystem write
   surface, a `PUT`/`PATCH`/`DELETE` verb, a `spawnSync`/`execSync`, or an ungated
   `writeManifest(...)` call.

## Not changed, deliberately

- No check logic, ordering or verdict semantics.
- Dry-run is **not** the default; the live gate stays the default so closing a
  lane still records history.
- No second evaluation path, no "quick" mode, no short-circuits.
- Increment 2's surfaces are untouched.
