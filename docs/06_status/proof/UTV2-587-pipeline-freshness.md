# PROOF: UTV2-587
MERGE_SHA: 0668165

ASSERTIONS:
- [x] Offers stage FRESH — ingestor recovered after SGO key rotation; 10,307 rows in 60m window
- [x] Market Universe stage FRESH — materializer running; 399 rows in 120m window
- [x] Candidates stage FRESH — board scan running; 398 rows in 240m window
- [ ] Scoring stage PASS — BLOCKED: no champion models in model_registry for NBA pick_candidates; fail-closed design (UTV2-553) skips all candidates without champion
- [ ] Board stage PASS — BLOCKED: dependent on Scoring; no scored candidates to construct board from
- [ ] Picks stage PASS — BLOCKED: scanner intentionally quiesced (DEBT-003); last human pick 633m ago
- [ ] Outbox/Receipts stage PASS — BLOCKED: no new picks to distribute; 2 dead_letter rows pending resolution
- [ ] candidate→pick→outbox→receipt linkage at meaningful volume — BLOCKED: automated path requires scoring + scanner re-enablement

EVIDENCE:
```text
=== UTV2-587: Stage Freshness Report — 2026-04-22T15:59:12.370Z ===
Run SHA: 0668165  |  Supabase: zfzdnfwdarxucxtaojxm

[✓] Offers             FRESH  age=18m   10,307 rows in window (threshold 60m)
[✓] Market Universe    FRESH  age= 3m   399 rows in window   (threshold 120m)
[✓] Candidates         FRESH  age=13m   398 rows in window   (threshold 240m)
[✗] Scoring            EMPTY  — no scored candidates found
[✗] Board              EMPTY  — no board candidates found
[!] Picks              STALE  age=633m  0 rows in window     (threshold 240m)
[!] Outbox             STALE  age=644m  pending=0, completed-in-window=0
[!] Receipts           STALE  age=644m  0 rows in window     (threshold 240m)

Verdict: FAILED (3 FRESH, 3 STALE, 2 EMPTY)

=== Root Cause Analysis ===

RECOVERED THIS SESSION:
- SGO ingestor was stale 39h due to expired API key
- Key rotated by operator 2026-04-22T15:39Z
- Ingestor restarted 2026-04-22T15:40:43Z
- First fresh offer: 2026-04-22T15:41:59Z
- Market Universe materializer: fired within 5m, 399 rows produced
- Candidates (board scan): fired within 6m, 398 rows produced

REMAINING BLOCKERS:

1. Scoring EMPTY — candidate-scoring-service is fail-closed (UTV2-553 Phase 7E):
   no champion model in model_registry for NBA/current market families.
   All 398 candidates are NBA picks; scoring skips with noChampionSkipped++.
   Fix: register NBA champion model in model_registry.

2. Board EMPTY — board-construction-service requires scored candidates (model_score IS NOT NULL).
   Unblocks when Scoring is fixed.

3. Picks STALE — system-pick-scanner is intentionally quiesced (DEBT-003).
   DEBT-002 resolved (UTV2-539 Done). Brake proven (UTV2-494 Done).
   Status: awaiting PM decision to re-enable scanner.
   Human picks last submitted 633m ago; 4 qualified picks not yet in outbox.

4. Outbox/Receipts STALE — no new picks entering the pipeline.
   2 dead_letter rows: pick eb58dd50 (discord:best-bets), pick b2eb62c7 (discord:canary).
   Both have attempts=0, created 2026-04-22T05:02–05:05Z.

=== pipeline:health (same session) ===
Worker: HEALTHY — heartbeat fresh, no eligible distribution rows
Queue: 2 dead_letter rows
Provider: HEALTHY — offers now flowing after key rotation
Scheduler: scanner quiesced (DEBT-003)
```
