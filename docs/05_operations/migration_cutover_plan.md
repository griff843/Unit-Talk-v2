# Migration and Cutover Plan

**Status:** RATIFIED 2026-03-28
**Issue:** UTV2-26
**Authority:** This document defines incident ownership, rollback expectations, and minimum safe cutover signals for Unit Talk V2. Referenced by: `risk_register.md`, `PROGRAM_STATUS.md`.
**Milestone:** UTV2-M8 Cutover Ready

---

## 1. What "Cutover" Means

Cutover is the point at which Unit Talk V2 is the sole operational platform for pick submission, promotion, delivery, grading, and Discord distribution. The legacy repo (`C:\dev\unit-talk-production`) is frozen as a read-only reference and no longer receives changes.

Cutover is not a single deployment event. It is a gate that is either open or closed based on the minimum signal set in §4.

---

## 2. Incident Ownership

| Surface | Owner | Escalation |
|---------|-------|------------|
| API submission failures | Platform ops | Check `submission_events`, operator snapshot |
| Worker delivery failures | Platform ops | Check `distribution_outbox` dead-letter count; operator snapshot `distributionHealth` |
| Discord delivery outage | Platform ops | Check `distribution_receipts`; verify bot token + guild deploy |
| Grading / settlement errors | Platform ops | Check `settlement_records`, `audit_log`; grading-service logs |
| RecapAgent failures | Platform ops | Check scheduler logs; `RECAP_DRY_RUN=true` as kill switch |
| AlertAgent failures (post-UTV2-59) | Platform ops | DB-backed cooldown; `ALERT_AGENT_ENABLED=false` as kill switch |
| Schema / migration failures | Data platform | Check Supabase migration history; never hand-edit `database.types.ts` |
| Operator surface unavailable | Platform ops | `GET /health` on operator-web; check env vars |

**Single-writer rule:** only `apps/api` writes to the database. If a write fails, the write path is in `apps/api/src/`. No other app writes picks, outbox rows, or settlement records.

---

## 3. Rollback Expectations

### 3.1 Rollback Is Not a Revert

"Rollback" means disabling or isolating a surface, not reverting commits. The goal is to stop user-facing impact while preserving DB state for diagnosis.

### 3.2 Kill Switches (no deploy required)

| Surface | Kill Switch | Effect |
|---------|-------------|--------|
| Discord delivery | Remove `DISCORD_BOT_TOKEN` from env; restart worker | Worker exits gracefully; outbox rows accumulate, nothing delivered |
| RecapAgent | `RECAP_DRY_RUN=true`; restart | Computes summaries, skips all Discord posts |
| AlertAgent | `ALERT_AGENT_ENABLED=false`; restart | Detection pass skipped entirely |
| Grading cron | `GRADING_CRON_ENABLED=false`; restart | `POST /api/grading/run` still available manually |
| Smart Form | Shut down `apps/smart-form` | `apps/api` continues accepting submissions directly |

### 3.3 Rollback Triggers

Initiate rollback if any of the following are observed:

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Dead-letter outbox rows accumulating | > 3 consecutive `dead_letter` picks | Disable Discord delivery; investigate worker logs |
| Duplicate picks in Discord channel | Any | Disable worker delivery immediately; audit `distribution_receipts` for idempotency failure |
| Grading producing wrong results | Any incorrect `win`/`loss`/`push` on a verified game | `GRADING_CRON_ENABLED=false`; halt manual grading runs until diagnosed |
| Recap posting to wrong channel | Any | `RECAP_DRY_RUN=true`; verify `UNIT_TALK_DISCORD_TARGET_MAP` |
| API submission returning 5xx on valid input | > 1 minute sustained | Check Supabase connectivity; fall back to in-memory mode for diagnosis |
| Settlement record mutation detected | Any | Escalate immediately; `settlement_records` are append-only by design |

### 3.4 Rollback Does Not Mean Legacy Re-activation

Do not route picks back through the legacy system. The legacy system is frozen and may be in an unknown DB state. If V2 is unstable, the correct posture is pause-and-diagnose, not legacy re-activation.

---

## 4. Minimum Signals for Safe Cutover

All of the following must be true before cutover is considered open:

### 4.1 Gates

| Gate | Requirement | Current Status |
|------|-------------|----------------|
| G1 — Test suite | `pnpm verify` exits 0; ≥ 692 tests passing | **PASS** — 1072 tests, lint 0 errors. Verified post-Sprint A. |
| G2 — Submission path live | `POST /api/submissions` accepts and persists picks | **PASS** — live |
| G3 — Promotion + delivery live | Qualified picks reach `discord:best-bets` | **PASS** — live |
| G4 — Grading live | `POST /api/grading/run` grades against `game_results` | **PASS** — live (UTV2-69) |
| G5 — Settlement live | Settlement write path, correction chain, CLV | **PASS** — live |
| G6 — Operator surface live | `/api/operator/snapshot` reflects real system state | **PASS** — live |
| G7 — Bot commands live | `/stats`, `/leaderboard`, `/pick`, `/help`, `/recap` | **PASS** — 5 commands registered |
| G8 — Recap routing correct | Scheduled recaps posting to `discord:recaps` (not best-bets) | **PASS** — UTV2-90 DONE (PR #53). DB-backed idempotency (UTV2-170). |
| G9 — AlertAgent live | Line movement detection + notification layer | **PASS** — detection (UTV2-59 PR #48) + notification (UTV2-114 PR #55) both live. Post-cutover hardening only. |
| G10 — Dead-letter health | No `dead_letter` rows in `distribution_outbox` | Monitor — acceptable if < 3 |
| G11 — Rollback plan ratified | This document exists and is current | **PASS** — this document |

### 4.2 Cutover Decision Rule

Cutover gate is **OPEN** when G1–G8, G11, and G12 are PASS, and G10 is acceptable.

G9 (AlertAgent) is not a hard cutover gate — it is post-cutover hardening. Cutover can proceed without AlertAgent live.

### 4.3 Production Readiness Canary (G12)

Before declaring cutover open, complete a production readiness canary period as defined in `docs/05_operations/PRODUCTION_READINESS_CANARY_PLAN.md`.

The canary period runs V2 as the sole active system for >= 7 calendar days with real picks, real game results, and heightened monitoring. It replaces the original shadow validation plan (which was invalidated when the V1 data extraction audit revealed V1 contains only synthetic test data — cross-system parity comparison against synthetic data does not prove production correctness).

| Gate | Requirement | Current Status |
|------|-------------|----------------|
| G12 — Production readiness canary | Canary sign-off record exists: >= 30 graded picks, >= 2 sports, 100% grading accuracy on spot-checks, 0 dead-letter, 0 duplicates, evidence bundle complete, PM approval | **OPEN** — plan ratified, canary period not started |

The canary validates:
- Grading accuracy against real box scores (100% on spot-checks)
- CLV computation on real closing lines
- Delivery health (0 dead-letter for 7 days)
- No duplicate Discord posts
- Operator snapshot truth (counts match DB)
- Stats/leaderboard accuracy

See `PRODUCTION_READINESS_CANARY_PLAN.md` for full criteria, failure handling, and evidence requirements.

---

## 5. Cutover Sequence

When the gate is open:

1. **Notify team** — cutover date announced ≥ 48h in advance
2. **Final `pnpm verify`** — run and record result at cutover commit
3. **Legacy freeze** — tag legacy repo at final pre-cutover state
4. **DNS / env cutover** — point any shared env vars / webhooks to V2 endpoints
5. **Monitor for 24h** — watch operator snapshot health every 30 min; watch Discord channels for routing drift
6. **Declare cutover closed** — update `PROGRAM_STATUS.md`; Linear milestone UTV2-M8 → Done

---

## 6. Legacy Reference Rules

The legacy repo is inspected, not trusted by default.

- No implicit truth import from legacy behavior
- Any reused logic must be re-ratified via a V2 contract or runtime proof
- Legacy parity claims require a bounded V2 reference artifact, not memory

---

## 7. Authority References

| Purpose | File |
|---------|------|
| Open risks | `docs/05_operations/risk_register.md` |
| Program status | `docs/06_status/PROGRAM_STATUS.md` |
| Work queue | `docs/06_status/ISSUE_QUEUE.md` |
| Discord routing | `docs/05_operations/discord_routing.md` |
| AlertAgent contract | `docs/05_operations/T1_ALERTAGENT_LINE_MOVEMENT_CONTRACT.md` |
| Recaps contract | `docs/05_operations/T1_DISCORDRECAPS_ACTIVATION_CONTRACT.md` |

---

## 8. Update Rule

Update this document when:
- A gate status changes (OPEN → PASS)
- The rollback trigger thresholds are tuned based on observed production behavior
- New surfaces are added that require incident ownership entries
- The cutover sequence changes

Do not update this document to reflect sprint-level task progress. That belongs in `ISSUE_QUEUE.md`.
