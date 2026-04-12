# Lane Manager — RETIRED

**Status:** Retired. Superseded by `LANE_MANIFEST_SPEC.md`.

This document previously described the legacy `.claude/lanes.json` lane registry and the `scripts/lane.ts` workflow manager. Both are retired as of the canonical-lane migration wave (PRs #246–#251).

## Canonical replacements

| Legacy surface | Canonical replacement |
|---|---|
| `.claude/lanes.json` | `docs/06_status/lanes/*.json` (canonical manifests) |
| `scripts/lane.ts` (`lane:spawn`, `lane:list`, etc.) | `scripts/ops/lane-start.ts`, `scripts/ops/lane-close.ts`, `scripts/ops/lane-manifest.ts` |
| `lane-manager.md` (this file) | `docs/05_operations/LANE_MANIFEST_SPEC.md` |

## Authority

All lane lifecycle rules now live in:

- `docs/05_operations/LANE_MANIFEST_SPEC.md` — manifest schema, lifecycle states, heartbeat expectations, file-scope locking
- `docs/05_operations/EXECUTION_TRUTH_MODEL.md` — truth hierarchy, done-state law
- `docs/05_operations/PREFLIGHT_SPEC.md` — lane-start gating
- `docs/05_operations/TRUTH_CHECK_SPEC.md` — lane-close gating
