## Verification

**Issue:** UTV2-1212 — Wave 5: player-form wiring into computeStatProjection
**Tier:** T1
**Executor:** Claude (completing Codex scaffold)
**Branch HEAD SHA (pre-merge):** 4903c104c593ce3598f5827d04b648d56885dadf

### pnpm verify

```
PASS — exit code 0
ops:sync-check, env:check, lint, type-check, build, test all green
```

### pnpm test:db

```
# tests 7
# pass 7
# fail 0
duration_ms 107141
```

### R-level check

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required
```

### New tests added

- p_over shifts with hot form and non-zero weight
- p_over shifts with cold form and non-zero weight
- zero weight produces no adjustment (backward-compatible)
- player_form_score present in output
- 72h stale-guard covered in player-form.test.ts

### Constitutional constraints verified

- SGO not activated
- P3 remains ACTIVE_NOT_CERTIFIED
- P5 remains FROZEN_NOT_CERTIFIED
- Deterministic scoring preserved (playerForm_weight=0 default)
- No DB migrations
