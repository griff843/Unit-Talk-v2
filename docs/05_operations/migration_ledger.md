# Migration Ledger

## Purpose

This file is the repo-native ledger for selective reuse from `C:\dev\unit-talk-production`.

Use it to answer:
- what legacy logic was selectively salvaged
- where it landed in V2
- whether it is accepted foundation, runtime wiring, or intentionally excluded
- what still remains reference-only in the legacy repo

This file exists so migration history is durable in V2 rather than scattered across chat summaries, issue comments, or ad hoc memory.

## Boundary Rule

- Legacy repo: `C:\dev\unit-talk-production`
- Role: reference-only by default
- Authority: V2 docs and V2 runtime proof always win

See also:
- `docs/05_operations/legacy_repo_reference_boundary.md`
- `docs/01_principles/rebuild_charter.md`

## Ledger

| Slice | Legacy Source Role | V2 Destination | Status | Notes |
|---|---|---|---|---|
| Probability / devig math | selective pure-compute salvage from legacy probability modules | `packages/domain/src/probability/` | Accepted and closed | Week 15 complete; independently verified |
| Settlement downstream truth | selective pure-compute salvage from legacy outcomes analysis plus V2-native settlement summary logic | `packages/domain/src/outcomes/` and runtime wiring in `apps/api` / `apps/operator-web` | Accepted foundation; Week 16 still open | Core runtime wiring complete; closeout still pending |
| Batch 1 salvage | selective pure-compute salvage from legacy intelligence / evaluation families | `packages/domain/src/market`, `features`, `models`, `signals` | Accepted foundation | No I/O, no DB, no side effects |
| Batch 2 salvage | selective pure-compute salvage and V2 adaptation | `packages/domain/src/bands`, `calibration`, `scoring` | Accepted foundation | `calibration` intentionally not top-level re-exported |
| Batch 3 salvage | selective pure-compute salvage and V2 adaptation | `packages/domain/src/outcomes`, `evaluation`, `edge-validation`, `market/market-reaction.ts` | Accepted foundation | `evaluation` intentionally not top-level re-exported |
| Batch 4 salvage | selective pure-compute salvage and V2 adaptation | `packages/domain/src/rollups`, `system-health`, `outcomes/baseline-roi.ts` | Accepted foundation | Top-level domain index exports `rollups` and `system-health` |
| Batch 5 salvage | selective pure-compute salvage and V2 adaptation | `packages/domain/src/risk`, `strategy` | Accepted foundation | `strategy` remains commented out from top-level export until naming collision is resolved |

## Explicit Non-Salvage Rule

The following legacy areas remain reference-only unless future V2 docs ratify them:

- recap agents and recap surfaces
- accounting rebuild surfaces
- broad analytics dashboards tied to old runtime assumptions
- BaseAgent-coupled orchestration
- old environment / runtime configuration conventions
- deprecated control-plane and archived operating models from the legacy repo

## Required Handling For Future Reuse

If a future slice uses `unit-talk-production` as a source:
1. record the legacy source family here
2. record the V2 destination module here
3. state whether the result is accepted foundation, accepted runtime, deferred, or rejected
4. update the relevant week contract and status docs

## Current Recommendation

Keep `C:\dev\unit-talk-production` connected in V2 only as a bounded reference source.

Do not let it become a second documentation authority.
