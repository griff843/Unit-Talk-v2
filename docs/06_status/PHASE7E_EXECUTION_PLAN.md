# Phase 7E Execution Plan — Calibration + Schema Cleanup

> Defined per UTV2-508 after Phase 7D proof closure.
> Phase 7E is intentionally light. Three bounded slices, no new infrastructure.

---

## 1. Per-Band Calibration / Reliability Slices

### Current state (post-7D)

Band assignment uses static thresholds (`packages/domain/src/bands/thresholds.ts` v1.0.0):
- Edge thresholds: A+ ≥ 0.08, A ≥ 0.05, B ≥ 0.03, C ≥ 0.015
- Uncertainty caps: A+ ≤ 0.10, A ≤ 0.15, B ≤ 0.25, C ≤ 0.35
- CLV suppress below -0.15, downgrade below -0.05
- Calibration infrastructure exists (`packages/domain/src/probability/calibration.ts`) but is not wired into runtime.

### What 7E should do

**Slice 7E-CAL: Wire calibration metrics into scoring telemetry.**

- After each scoring run, compute per-band calibration metrics (Brier score, log loss) from recent settled picks using the existing `computeBrierScore()` and `computeLogLoss()` in `packages/domain/src/probability/calibration.ts`.
- Record metrics as part of the model health snapshot (`ModelHealthSnapshotRepository.create()`).
- Do NOT adjust thresholds automatically — this is observability, not auto-tuning.
- Do NOT change band assignment logic.

**Files:** `apps/api/src/candidate-scoring-service.ts` (add post-run calibration metric computation), `packages/domain/src/probability/calibration.ts` (existing — no changes expected).

**Tier:** T2 — bounded observability addition.

**Acceptance criteria:**
1. Per-band calibration metrics are computed after each scoring run.
2. Metrics are recorded through the existing model health snapshot path.
3. No threshold or band assignment logic is changed.
4. Missing settlement data produces empty/null metrics, not errors.

---

## 2. Candidate-to-Pick Linkage Cleanup Direction

### Current state (post-7D)

- `board-pick-writer.ts` calls `processSubmission()` per board candidate, then links `pick_candidates.pick_id` via `updatePickIdBatch()`.
- `pick_candidates.pick_id` is set to the created pick's ID and `shadow_mode` is set to `false` on successful link.
- This is the only path that links candidates to picks — no side-channel writes.
- `pick_candidates` rows without `pick_id` are candidates that were never promoted to the board or never written as picks.

### What 7E should do

**Slice 7E-LINK: No cleanup needed. The current linkage is correct and governed.**

The candidate-to-pick linkage is already clean:
- Exactly one write path (`board-pick-writer.ts:updatePickIdBatch`)
- `pick_id` is NULL until board construction promotes a candidate
- `shadow_mode` flips to `false` only at the moment of pick creation
- No orphaned linkages, no dual-write paths, no hidden side-channels

**Direction confirmed: the current pattern is the target state.** No implementation work required.

---

## 3. Deprecated Source Cleanup Conditions

### Current state (post-7B)

Two direct-submission sources were retired in Phase 7B:
- `system-pick-scanner` — now writes to `market_universe` (PR #261, `bcb05f1`)
- `alert-agent` — now writes to `market_universe` (PR #262, `16bae9e`)

### Remaining deprecated artifacts

| Artifact | Location | Condition to Remove |
|----------|----------|-------------------|
| `SYSTEM_PICK_SCANNER_ENABLED` env flag | `apps/api/src/system-pick-scanner.ts:45`, `apps/api/src/index.ts:57` | Safe to rename to `MARKET_SCANNER_ENABLED` or equivalent. The flag still gates the scanner, but the scanner now writes to market_universe, not submissions. Rename is cosmetic — not blocking. |
| `SYSTEM_PICKS_ENABLED` env flag | `apps/alert-agent/src/main.ts:15` | Same — gates the governed adapter now. Rename is cosmetic. |
| `source: 'system-pick-scanner'` in historical DB rows | `picks` table | Read-only historical data. Do NOT delete. Query filters should handle this source as legacy. |
| `source: 'alert-agent'` in historical DB rows | `picks` table | Same — read-only historical. |
| Legacy `0.2` uncertainty fallback | `candidate-scoring-service.ts:164` | Remove once all production scoring has champion model registry entries. Condition: `findChampion()` returns non-null for all active sport/family pairs. Track via model health snapshots. |

### What 7E should do

**Slice 7E-CLEANUP: Remove the legacy uncertainty fallback.**

- In `candidate-scoring-service.ts`, when no champion model exists for a sport/family, the current code falls back to `uncertainty = 0.2`. This was marked "will be removed in Phase 7E".
- Replace with: skip the candidate (fail-closed). If no champion is registered, the candidate cannot be scored — it should not silently use a placeholder.
- This is the last fake placeholder in the scoring path.

**Files:** `apps/api/src/candidate-scoring-service.ts` (remove legacy fallback, add skip for missing champion).

**Tier:** T2 — bounded behavior change, test-covered.

**Acceptance criteria:**
1. Missing champion model → candidate is skipped with explicit log entry.
2. No hardcoded `0.2` or `0.8` remains anywhere in the scoring path.
3. Existing tests updated to cover the skip behavior.
4. Flag renames (SYSTEM_PICK_SCANNER_ENABLED, SYSTEM_PICKS_ENABLED) are deferred — cosmetic, not blocking.

---

## Summary: Phase 7E Implementation Issues

| Slice | Title | Tier | New Issue? | Parallel-safe? |
|-------|-------|------|-----------|----------------|
| 7E-CAL | Wire calibration metrics into scoring telemetry | T2 | Yes — create | Yes (different code path from CLEANUP) |
| 7E-LINK | Candidate-to-pick linkage cleanup | — | No — confirmed clean, no work needed | N/A |
| 7E-CLEANUP | Remove legacy uncertainty fallback, fail closed | T2 | Yes — create | Yes (different line from CAL) |

**Total: 2 implementation issues + this planning issue. Phase 7E is light as designed.**

Both slices are parallel-safe (CAL adds post-run metrics, CLEANUP changes a single conditional in scoring). Combined into one PR is also viable.

---

## Phase 7E Gate

After both slices merge:
- Per-band calibration metrics are recorded
- No fake placeholders remain in scoring
- Candidate linkage is confirmed governed
- Phase 7 (Governed Syndicate Machine) can be declared complete
