# Diff summary — UTV2-1756

Substantive diff (excludes lane apparatus and the proof bundle itself):

```text
scripts/ops/reconcile.test.ts | 174 ++++++++++++++++++++++++++++-
scripts/ops/reconcile.ts      | 132 +++++++++++++++++-----
scripts/ops/shared.test.ts    | 253 ++++++++++++++++++++++++++++++++++++++++++
scripts/ops/shared.ts         | 171 ++++++++++++++++++++++++++--
4 files changed, 696 insertions(+), 34 deletions(-)
```

## `scripts/ops/shared.ts`

| Symbol | Change |
|---|---|
| `LaneManifestEntry` | **new** — `{ path, manifest }`; a manifest paired with the file it was read from. |
| `readAllManifestEntries(dir)` | **new** — the same recursive walk as `readAllManifestPaths`, returning path/manifest pairs. |
| `readAllManifests(dir)` | re-expressed as `readAllManifestEntries(dir).map(e => e.manifest)`. Identical output and ordering; no caller changed. |
| `TERMINAL_WRITE_PROTECTED_STATUSES` | **new** — `merged`, `done`, `failed`, `superseded`, `cancelled`. The statuses whose on-disk record vetoes an incoming write. |
| `assertManifestWriteIsSafe` | **new**, private — the clobber guard. Refuses on issue-id disagreement; refuses an illegal move out of a settled on-disk status; abstains for an absent, unparseable, or non-settled target. |
| `WriteManifestOptions` | **new** — `{ validate?: boolean }`, default `true`. |
| `writeManifestAtPath(manifest, path, options?)` | **new** — the single write chokepoint. Guard always runs; schema validation is opt-out. |
| `writeManifest(manifest)` | now delegates to `writeManifestAtPath(manifest, issueToManifestPath(manifest.issue_id))`. Behaviour for a single-manifest lane is unchanged. |
| `issueToManifestPath` | **unchanged.** Still correct, and still the right default, for a lane with exactly one manifest. |
| `classifyLaneCapacity` | **unchanged.** |

## `scripts/ops/reconcile.ts`

| Symbol | Change |
|---|---|
| `selectReconcilableManifestEntries` | **new** — delegates its policy to `selectReconcilableManifests` and preserves each entry's path. Policy is not duplicated. |
| `selectReconcilableManifests` | **unchanged.** UTV2-1619's fail-closed allowlist is intact. |
| `ReconcileEntry` | **+2 optional fields** — `manifest_path`, `refused`/`refusal_reason`. `action_taken`'s existing strings are byte-identical; no assertion in the pre-existing suite changed. |
| `ReconcileManifestOptions` | **+1 field** `manifestPath`; `writeManifest` now receives the destination path. |
| `manifestPath(issueId)` | **deleted** — a second, local copy of `issueToManifestPath`. Its existence was the duplicated-authority half of this defect. |
| `writeManifestJson(manifest, filePath)` | now routes to `writeManifestAtPath(..., { validate: false })` instead of raw `fs.writeFileSync`. |
| `applyManifestWrite` | **new**, private — turns a fail-closed refusal into a recorded outcome instead of an exception that would abort the sweep. |
| `reconcileManifest` | resolves `targetPath` from `options.manifestPath`; both write sites record refusals. |
| `main()` | iterates `readAllManifestEntries()` and threads each entry's real path; refused entries are excluded from the mutation count. |
| imports | `fs` and `path` dropped (now unused). |

## Test files

`scripts/ops/shared.test.ts` — +13 tests. `scripts/ops/reconcile.test.ts` — +4 tests, including the ARM A/B/C mutation triple. No pre-existing test was modified or deleted.

## Not touched

`.github/workflows/reconcile-stale-lanes.yml`, `docs/06_status/lanes/UTV2-1512.json`, `docs/06_status/lanes/parked/UTV2-1512.json`, `docs/06_status/lanes/UTV2-1157*.json`, `scripts/ops/lane-close.ts`.
