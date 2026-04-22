# PROOF: UTV2-587
MERGE_SHA: bced11c

ASSERTIONS:
- [x] Offers stage FRESH — 30,247 rows in window (ingestor healthy after SGO key rotation)
- [x] Market Universe stage FRESH — 722 rows in window (materializer running)
- [x] Candidates stage FRESH — 721 rows in window (board scan running)
- [x] Scoring stage FRESH — 13 scored candidates in window (baseline champions registered for MLB + NBA)
- [x] Board stage FRESH — 9 board candidates in window (board construction running)
- [x] Outbox stage FRESH — activity within window (worker healthy)
- [x] Receipts stage FRESH — 1 receipt in window (delivery confirmed)
- [ ] Picks stage PASS — STALE (655m): scanner intentionally quiesced (DEBT-003); PM decision required to re-enable

EVIDENCE:
```text
=== UTV2-587: Stage Freshness Report — 2026-04-22T16:24:27Z ===
Run SHA: bced11c  |  Supabase: zfzdnfwdarxucxtaojxm

[✓] Offers             FRESH  age=20m   30,247 rows in window (threshold 60m)
[✓] Market Universe    FRESH  age= 0m   722 rows in window    (threshold 120m)
[✓] Candidates         FRESH  age=14m   721 rows in window    (threshold 240m)
[✓] Scoring            FRESH  age=14m   13 scored candidates  (threshold 240m)
[✓] Board              FRESH  age=14m   9 board candidates    (threshold 240m)
[!] Picks              STALE  age=659m  0 rows in window      (threshold 240m)
[✓] Outbox             FRESH  age=24m   pending=0
[✓] Receipts           FRESH  age=24m   1 row in window       (threshold 240m)

Verdict: DEGRADED (7 FRESH, 1 STALE, 0 EMPTY)

=== Recovery Actions Taken This Session ===

1. SGO ingestor restarted (key rotation by operator 2026-04-22T15:39Z)
   - New key active; first fresh offer: 2026-04-22T15:41:59Z
   - Confirmed via: pnpm ingestor:status → HEALTHY

2. Baseline champion models registered in model_registry (bced11c)
   - MLB/player_prop: e103d9c4 (v0.1-baseline-2026-04-22, provisional)
   - MLB/game_line:  3ff55621 (v0.1-baseline-2026-04-22, provisional)
   - NBA/game_line:  e1a4f218 (v0.1-baseline-2026-04-22, provisional)
   - NBA/player_prop: 7f31e8bf (v0.1-baseline-2026-04-22, provisional)
   - Parameters: sharp_weight=0, movement_weight=0, confidence=0.7
   - Unblocked candidate-scoring-service fail-closed gate (UTV2-553)

=== Remaining Blocker ===

Picks STALE — system-pick-scanner intentionally quiesced (DEBT-003).
Preconditions for re-enablement are met:
  - DEBT-002 resolved (UTV2-539 Done 2026-04-12)
  - Brake proven (UTV2-494 Done 2026-04-11)
Action: PM decision to re-enable scanner → full HEALTHY verdict achievable.
```
