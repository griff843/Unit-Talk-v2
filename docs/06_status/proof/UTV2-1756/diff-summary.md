# Diff summary — UTV2-1756
MERGE_SHA: dafb1f252ff4ac2c7329161f6b6d3533935c2028

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
| `writeManifest(manifest)` | now delegates to `writeManifestAtPath(manifest, issueToManifestPath(manifest.issue_id))`. Path resolution is unchanged. Behaviour is unchanged for every caller **except** `ops:lane-manifest record-merge` against a lane that settled as `failed`/`superseded`/`cancelled`, which is now refused rather than written silently — see "Deliberate behaviour change" in `verification.md`. |
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

## PM review round 2

| Symbol | Change |
| -- | -- |
| `ManifestWritePolicyError` (new, `shared.ts`) | Exported error class thrown by `assertManifestWriteIsSafe` and by nothing else, so a caller can tell a deliberate policy refusal from an operational write failure. |
| `assertManifestWriteIsSafe` | Both refusals now throw `ManifestWritePolicyError` instead of a bare `Error`. Adds one bounded exception: `done -> started`, the replacement `ops:lane-start` performs when an issue is worked a second time. The identity arm still applies to it. |
| `applyManifestWrite` (`reconcile.ts`) | Catches only `ManifestWritePolicyError`. Every other failure propagates, escapes `main()`'s bare loop, and exits nonzero — a scheduled run can no longer report success having written nothing. |
| `shared.test.ts` | Two restart tests: the sanctioned `done -> started` write lands; no other settled status reanimates to `started`, `done` opens only for `started`, refused writes leave the file byte-identical, and the identity arm still bites. |
| `reconcile.test.ts` | Two write-failure tests: a policy refusal is recorded while an injected operational failure propagates; and a real OS ENOTDIR failure exits the command nonzero, with a control arm run first to catch a broken harness. |

All five arms are mutation-tested in both directions; see `verification.md`.
