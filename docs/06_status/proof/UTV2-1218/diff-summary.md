## Diff Summary — UTV2-1218 R2 Determinism Artifacts

**Issue:** UTV2-1218  
**Branch:** codex/utv2-1218-r2-determinism-artifacts  
**Tier:** T2  
**Scope:** proof artifacts only — no source changes

---

### Files changed

| File | Change |
|------|--------|
| `docs/06_status/proof/UTV2-1218/r2-determinism.json` | New — R2 determinism result (4 sports, 2 runs each) |
| `docs/06_status/proof/UTV2-1218/evidence.json` | New — T2 evidence bundle with SHA binding |
| `docs/06_status/proof/UTV2-1218/verification.md` | New — verification log with test methodology and results |
| `docs/06_status/proof/UTV2-1218/diff-summary.md` | New — this file |

### Source files exercised (read-only, not modified)

- `packages/domain/src/models/stat-distribution.ts` — `computeStatProjection` (post-Wave-5 entry point)
- `packages/domain/src/features/player-form.ts` — `PlayerFormFeatures`, `resolvePlayerFormSignal`
- `packages/domain/src/features/opportunity.ts` — `OpportunityFeatures`
- `packages/domain/src/features/efficiency.ts` — `EfficiencyFeatures`
- `packages/domain/src/features/matchup-context.ts` — `MatchupContextFactors`
- `packages/domain/src/features/game-context.ts` — `GameContextFeatures`

### Summary of findings

The post-Wave-5 fully-wired `computeStatProjection` path is **deterministic**: identical inputs produce identical outputs on repeated invocations, confirmed via SHA-256 hash comparison across 4 sports (NBA, NFL, MLB, NHL) and 2 sequential runs per sport.

Determinism is guaranteed by:
1. All arithmetic uses IEEE 754 operations with fixed `round4()` rounding
2. `hashFeatureVector` sorts keys lexicographically before hashing — no map-insertion-order dependency
3. No random number generation, no `Date.now()` in compute path, no async I/O
4. Distribution type selection (`normal` vs `poisson`) is a pure function of `stat_type`

No regressions introduced. No source changes.
