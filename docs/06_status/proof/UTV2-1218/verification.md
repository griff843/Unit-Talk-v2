## Verification — UTV2-1218 R2 Determinism Artifacts

**Issue:** UTV2-1218  
**Tier:** T2  
**Verifier:** codex-cli/utv2-1218  
**Run at:** 2026-06-07T00:29:04.187Z  
**Source SHA:** 8169b8595cadb1414bda4fcf9d054991c8b22be2

---

### What was verified

R2 determinism property of the post-Wave-5 fully-wired `computeStatProjection` path in `@unit-talk/domain`.

All 5 feature modules are exercised:

1. `packages/domain/src/features/player-form.ts` — `PlayerFormFeatures` + `resolvePlayerFormSignal`
2. `packages/domain/src/features/opportunity.ts` — `OpportunityFeatures`
3. `packages/domain/src/features/efficiency.ts` — `EfficiencyFeatures`
4. `packages/domain/src/features/matchup-context.ts` — `MatchupContextFactors` (consumed via efficiency inputs)
5. `packages/domain/src/features/game-context.ts` — `GameContextFeatures` (home_away_factor applied in Step 1c)

Entry point: `packages/domain/src/models/stat-distribution.ts` — `computeStatProjection`

---

### Test methodology

For each sport (NBA, NFL, MLB, NHL):

1. Constructed a fixed, representative `ProjectionInput` with all 5 feature modules populated
2. Serialized input to canonical JSON and computed SHA-256 (`input_hash`)
3. Called `computeStatProjection(input)` — run 1
4. Called `computeStatProjection(input)` — run 2 (same object, same process)
5. SHA-256 hashed each result's JSON serialization
6. Asserted `hash_run1 === hash_run2`

All 4 sports passed. `deterministic=true` for each case and for the overall aggregated hash.

---

### Results

| Sport | ok  | Deterministic | Distribution | p_over |
|-------|-----|---------------|--------------|--------|
| NBA   | true | true         | normal       | 0.001  |
| NFL   | true | true         | normal       | 0.001  |
| MLB   | true | true         | normal       | 0.1213 |
| NHL   | true | true         | poisson      | 0.1337 |

Overall: `output_hash_run_1 === output_hash_run_2`

```
output_hash_run_1: 873351db6260f2f176690d0f4597a2114afd882542d733212caadb72ea56ec58
output_hash_run_2: 873351db6260f2f176690d0f4597a2114afd882542d733212caadb72ea56ec58
```

---

### Static checks

- `pnpm type-check`: PASS (clean, no errors)
- No source files modified
- No DB access, no HTTP, no env reads — domain package is pure

---

### Observations

- The function is deterministic because all math uses IEEE 754 floating-point with fixed rounding (`round4`), deterministic hash construction (`hashFeatureVector` sorts keys before hashing), and no random/date-dependent operations inside the compute path.
- The `feature_vector_hash` embedded in each output is a reproducibility fingerprint — it encodes the full input feature vector as a sorted key=value string before hashing.
- NHL goals stat_type triggers the Poisson distribution path; NBA/NFL/MLB use Normal. Both are deterministic.
- The `run_at` field in `r2-determinism.json` records when the test was executed but is not part of the output hash — it is metadata only.
