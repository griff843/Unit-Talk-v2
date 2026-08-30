# PROOF: UTV2-1757 — Diff Summary

MERGE_SHA: 325ee096c91a70130d3b15f5185a613ebcecd5f1

## Functional diff

| File | Change |
|---|---|
| `docs/06_status/lanes/UTV2-1512.json` | `status: blocked → superseded`; `superseded.reason` corrected; `superseded.tombstone` added |
| `docs/06_status/lanes/parked/UTV2-1512.json` | identical change, applied independently to the parked copy |
| `.ops/sync/UTV2-1512.yml` | deleted — stale per-issue sync state for a terminal record |

`git diff --stat` against the lane's base commit:

```
 .ops/sync/UTV2-1512.yml                    | 12 ----------
 docs/06_status/lanes/UTV2-1512.json        | 37 +++++++++++++++++++++++++++---
 docs/06_status/lanes/parked/UTV2-1512.json | 37 +++++++++++++++++++++++++++---
 3 files changed, 68 insertions(+), 18 deletions(-)
```

## Lane apparatus (not functional)

- `.ops/sync/UTV2-1757.yml`
- `docs/06_status/lanes/UTV2-1757.json`
- `docs/06_status/proof/UTV2-1757/`

## Not touched

- `scripts/ops/reconcile.ts`, `scripts/ops/shared.ts`, `scripts/ops/lane-close.ts` — no reconciler or lifecycle implementation change
- `.github/workflows/**` — no workflow change
- `apps/command-center/**` — none of the 54 product paths named in the historical `file_scope_lock` are touched
- Any other lane manifest, proof bundle, or sync file
- Linear: the deleted historical issue is not recreated

## Field-level delta (both copies, verified key-by-key against the base blob)

Changed: `status`, `superseded.reason`, `superseded.tombstone` (added).

Verified byte-identical: `truth_check_history` (12 entries root / 2 parked, every
`ops:reconcile` failure receipt preserved), `closed_at`, `file_scope_lock` (54
paths), `override`, `parked`, `branch`, `commit_sha`, `pr_url`, `started_at`,
`heartbeat_at`, `executor`, `tier`, `lane_type`, `expected_proof_paths`,
`reopen_history`, `schema_version`, `superseded.at`, `superseded.by`,
`superseded.superseded_by`, and every other key.

`heartbeat_at` is deliberately unchanged at the historical `2026-07-09T05:15:00.000Z`.

## Merge SHA Binding

`MERGE_SHA:` above carries `cbe7069295f435652c3fa68c0243fd4dd7d1ae5a`, the last
non-proof commit on this branch and the commit that carries the entire
functional change. It is a real commit, not a placeholder token. Post-merge
rebinding replaces it with the recorded merge SHA.
