# UTV2-1682 Diff Summary

- Issue: `UTV2-1682`
- Tier: `T2`
- Branch: `codex/utv2-1682-parked-lane-capacity-semantics`

## Summary

- Parked lanes now consume zero executor, total, and lane-type capacity.
- Parked lanes remain in the canonical governance population and retain their file-scope locks.
- Capacity classification is derived exclusively from lifecycle status and reports the source population, classification, and per-cap dimensions.
- Local discovery recursively includes `docs/06_status/lanes/parked/**`; PR-head discovery checks the root location and then the parked location after confirmed absence.
- Unreadable local or PR-head manifest populations fail closed instead of being treated as an empty board.

## Files changed

- `scripts/ops/shared.ts` — defines status-only capacity classification, recursive manifest discovery, location-aware root/parked lookups, and fail-closed population reads.
- `scripts/ops/concurrency-rules.test.ts` — proves parked lanes do not consume any configured capacity dimension.
- `scripts/ops/shared.test.ts` — covers recursive discovery, root-to-parked fallback, relocation invariance, governance visibility, retained locks, and fail-closed reads.
- `docs/06_status/proof/UTV2-1682/verification.md` — records verification and the required writable-database deferral.
- `docs/06_status/proof/UTV2-1682/model-routing.json` — records the selected execution model and routing policy.

## Capacity semantics

| Lane state | Governance visibility | Executor capacity | Total capacity | Lane-type capacity | File-scope lock |
|---|---:|---:|---:|---:|---:|
| `parked` | retained | 0 | 0 | 0 | retained |

Manifest location is reporting metadata only. Moving the same parked manifest between `docs/06_status/lanes/` and `docs/06_status/lanes/parked/` cannot change its capacity arithmetic.

## Scope notes

No configured cap values, admission thresholds, runtime application code, contracts, migrations, or database state were changed.
