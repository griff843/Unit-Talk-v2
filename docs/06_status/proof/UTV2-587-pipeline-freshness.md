# PROOF: UTV2-587
MERGE_SHA: 10ccd95

ASSERTIONS:
- [x] Offers stage FRESH — 7,950 rows in window, age=1m (ingestor healthy post restart 2026-04-24)
- [x] Market Universe stage FRESH — 1,233 rows in window, age=1m (materializer running)
- [x] Candidates stage FRESH — 2,305 rows in window, age=74m (board scan running)
- [x] Scoring stage FRESH — 55 scored candidates in window, age=104m
- [x] Board stage FRESH — 55 board candidates in window, age=104m
- [ ] Picks stage PASS — STALE (1664m): scanner intentionally quiesced (DEBT-003); PM decision required to re-enable
- [ ] Outbox stage PASS — STALE (765m): downstream of picks; no new picks = no outbox rows (DEBT-003)
- [ ] Receipts stage PASS — STALE (765m): downstream of outbox (DEBT-003)

EVIDENCE:
```text
=== UTV2-587: Stage Freshness Report — 2026-04-24T04:45:05Z ===
Run SHA: 10ccd95  |  Supabase: zfzdnfwdarxucxtaojxm

[✓] Offers             FRESH  age= 1m   7,950 rows in window (threshold 60m)
[✓] Market Universe    FRESH  age= 1m   1,233 rows in window (threshold 120m)
[✓] Candidates         FRESH  age=74m   2,305 rows in window (threshold 240m)
[✓] Scoring            FRESH  age=104m  55 scored candidates  (threshold 240m)
[✓] Board              FRESH  age=104m  55 board candidates   (threshold 240m)
[!] Picks              STALE  age=1664m 0 rows in window      (threshold 240m) — DEBT-003
[!] Outbox             STALE  age=765m  pending=0             — downstream of DEBT-003
[!] Receipts           STALE  age=765m  0 rows in window      — downstream of DEBT-003

Verdict: DEGRADED (5 FRESH, 3 STALE — all 3 stale from same root cause: DEBT-003)
```

INGESTOR RECOVERY (2026-04-24):
- Supervisor child process had stale env (startup-cached, key missing in child env)
- Restarted supervisor 2026-04-24T04:43Z
- 2,000+ offers confirmed in DB within 10 minutes of restart
- Ingestor confirmed HEALTHY post-restart

REMAINING BLOCKER:
Picks/Outbox/Receipts STALE — system-pick-scanner intentionally quiesced (DEBT-003).
Preconditions for re-enablement are met:
  - DEBT-002 resolved (UTV2-539 Done 2026-04-12)
  - Brake proven (UTV2-494 Done 2026-04-11)
Action required: PM decision to re-enable scanner.
Once scanner re-enabled, full HEALTHY verdict achievable with no code changes.
