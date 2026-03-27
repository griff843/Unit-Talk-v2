# Unit Talk V2 — Issue Queue

> **Queue is source of truth for state.** Linear mirrors it. Git branches are named `{lane}/{LINEAR_ID}-{slug}`.
> One issue = one branch = one PR. No stacking.

## Queue Health

| Lane | IN_PROGRESS | IN_REVIEW | READY | BLOCKED | DONE |
|---|---|---|---|---|---|
| `lane:codex` | 0 | 3 | 0 | 0 | 5 |
| `lane:claude` | 0 | 0 | 0 | 0 | 5 |
| `lane:augment` | 0 | 0 | 0 | 0 | 2 |

---

## Active Issues

---

### UTV2-28 — T1 Automated Grading Service

| Field | Value |
|---|---|
| **ID** | UTV2-28 |
| **Tier** | T1 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M4 |
| **Area** | `area:api` `area:db` |
| **Blocked by** | — |
| **Branch** | committed directly to `main` |
| **PR** | — |

#### Live Proof

- `POST /api/grading/run`: `attempted=4, graded=1, skipped=3, errors=0`
- Settlement `1c9d8581` written with `source='grading'`
- Migration 013 applied: `settlement_records_source_check` extended to include `'grading'`
- Idempotent: second run `graded=0`

---

### UTV2-29 — MLB Provider Ratification (DOC)

| Field | Value |
|---|---|
| **ID** | UTV2-29 |
| **Tier** | DOC |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M4 |
| **Area** | `area:contracts` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

#### Notes

MLB ratification complete. Contract RATIFIED in `docs/05_operations/`.

---

### UTV2-30 — T2 SGO Results Ingest

| Field | Value |
|---|---|
| **ID** | UTV2-30 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M5 |
| **Area** | `area:ingestor` `area:db` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-42-sgo-results-ingest` |
| **PR** | #3 — **MERGED** ✅ (2026-03-26) |

---

### UTV2-31 — T2 Discord /stats Command

| Field | Value |
|---|---|
| **ID** | UTV2-31 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M5 |
| **Area** | `area:discord-bot` `area:operator-web` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-31-discord-stats-v2` |
| **PR** | #13 — **MERGED** ✅ (2026-03-27) |

#### Notes

1 commit (`9614698`) vs origin/main. Files: `apps/operator-web/src/server.ts`, `apps/operator-web/src/server.test.ts`, `apps/discord-bot/src/commands/stats.ts`, `apps/discord-bot/src/discord-bot-foundation.test.ts`, `package.json`. `pnpm verify` exits 0: **591/591**. Meets ≥590 target.

---

### UTV2-32 — DOC Discord /stats Contract

| Field | Value |
|---|---|
| **ID** | UTV2-32 |
| **Tier** | DOC |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M5 |
| **Area** | `area:contracts` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

---

### UTV2-33 — T2 Market Key Normalization

| Field | Value |
|---|---|
| **ID** | UTV2-33 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **IN_REVIEW** |
| **Milestone** | M5 |
| **Area** | `area:api` `area:domain` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-33-market-keys-v3` |
| **PR** | #18 — **OPEN** |

#### Claude Review Note (2026-03-27) — APPROVED ✅

2 commits vs origin/main. Files: `packages/domain/src/market-key.ts`, `packages/domain/src/market-key.test.ts`, `packages/domain/src/index.ts`, `apps/api/src/submission-service.ts`, `apps/api/src/submission-service.test.ts`, `package.json`. `pnpm verify` exits 0: **598/598** (592 baseline + 4 domain + 2 submission). All 16 mapping entries present. Board-cap test updated to use canonical key (correct — normalization applied at submission time). Meets ≥597 target.

---

### UTV2-34 — T3 Deploy Commands Verify

| Field | Value |
|---|---|
| **ID** | UTV2-34 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **DONE** |
| **Milestone** | M4 |
| **Area** | `area:discord-bot` |
| **Blocked by** | — |
| **Branch** | `augment/UTV2-34-v4` |
| **PR** | #8 — **MERGED** ✅ (2026-03-26) |

---

### UTV2-35 — DOC Market Key Normalization Contract

| Field | Value |
|---|---|
| **ID** | UTV2-35 |
| **Tier** | DOC |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M5 |
| **Area** | `area:contracts` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

---

### UTV2-36 — T3 Queue Tooling (claim/submit scripts)

| Field | Value |
|---|---|
| **ID** | UTV2-36 |
| **Tier** | T3 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M5 |
| **Area** | `area:tooling` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-36-queue-tooling` |
| **PR** | #9 — **MERGED** ✅ (2026-03-27) |

---

### UTV2-37 — T3 SGO Results Seed Proof

| Field | Value |
|---|---|
| **ID** | UTV2-37 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **DONE** |
| **Milestone** | M5 |
| **Area** | `area:tooling` `area:db` |
| **Blocked by** | — |
| **Branch** | `augment/UTV2-37-v3` |
| **PR** | #11 — **MERGED** ✅ (2026-03-27) |

#### Notes

1 commit (`43f0751`), 2 files: `scripts/seed-game-result.ts` + `docs/06_status/grading_seed_proof.md`. `--help` implemented. Proof doc documents row ID `398d34b4`.

---

### UTV2-38 — T3 Board Cap Lifecycle Filter

| Field | Value |
|---|---|
| **ID** | UTV2-38 |
| **Tier** | T3 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M6 |
| **Area** | `area:api` `area:db` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-38-board-cap-filter` |
| **PR** | #12 — **MERGED** ✅ (2026-03-27) |

#### Notes

1 commit (`c43e298`), 2 files: `packages/db/src/runtime-repositories.ts` + `apps/api/src/submission-service.test.ts`. Filter applied to all 4 count functions. `pnpm verify` exits 0: **552/552**.

---

### UTV2-39 — DOC Smart Form V1 Contract Reactivation

| Field | Value |
|---|---|
| **ID** | UTV2-39 |
| **Tier** | DOC |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M6 |
| **Area** | `area:contracts` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

#### Notes

`docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md` corrected to RATIFIED (2026-03-26).

---

### UTV2-40 — T1 Smart Form V1 Conviction Field

| Field | Value |
|---|---|
| **ID** | UTV2-40 |
| **Tier** | T1 |
| **Lane** | `lane:codex` |
| **Status** | **IN_REVIEW** |
| **Milestone** | M6 |
| **Area** | `area:smart-form` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-40-smart-form-conviction-v2` |
| **PR** | #17 — **OPEN** |

#### Claude Review Note (2026-03-27) — APPROVED ✅

1 commit (`3152196`) vs origin/main. Files: 7 `apps/smart-form/` files only. No queue/status files. `pnpm verify` exits 0: **592/592** root. `pnpm --filter @unit-talk/smart-form test` exits 0: **111/111**. All contract ACs met (conviction field, schema validation, trust mapping, UI integration). Replaces rejected PR #14.

**Post-merge:** T1 proof bundle required. Submit a Smart Form pick with conviction=8, confirm `metadata.promotionScores.trust = 80` in DB via Supabase MCP or `GET /api/operator/picks/:id`.

---

### UTV2-41 — DOC Operator Entity Ingest Health Contract Reactivation

| Field | Value |
|---|---|
| **ID** | UTV2-41 |
| **Tier** | DOC |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M6 |
| **Area** | `area:contracts` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

#### Notes

`docs/05_operations/T2_OPERATOR_ENTITY_INGEST_HEALTH_CONTRACT.md` corrected to RATIFIED (2026-03-26).

---

### UTV2-42 — T2 Operator Entity Ingest Health

| Field | Value |
|---|---|
| **ID** | UTV2-42 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **IN_REVIEW** |
| **Milestone** | M6 |
| **Area** | `area:operator-web` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-42-operator-entity-health-v2` |
| **PR** | #19 — **OPEN** |

#### Claude Review Note (2026-03-27) — APPROVED ✅

1 commit (`60bfe72`) vs origin/main. Files: `apps/operator-web/src/server.ts` + `apps/operator-web/src/server.test.ts` only. `pnpm verify` exits 0: **600/600** (192+8 test:apps). Conflict with PR #13 (stats route) resolved cleanly — both routes co-exist. All 3 HTML sections present, `entityHealth` in snapshot, participants route wired. Meets ≥557 target. Replaces rejected PR #15.

---

## Queue State Reference

```
UTV2-28  T1  codex     DONE         ← CLOSED: live proof WIN. Migrations 012+013 committed to main.
UTV2-29  DOC claude    DONE         ← CLOSED: MLB ratification complete; contract RATIFIED
UTV2-30  T2  codex     DONE         ← MERGED: PR #3 merged to main 2026-03-26
UTV2-31  T2  codex     DONE         ← MERGED: PR #13 merged to main 2026-03-27. 591/591.
UTV2-32  DOC claude    DONE         ← CLOSED: /stats contract RATIFIED
UTV2-33  T2  codex     IN_REVIEW    ← APPROVED ✅ PR #18. 598/598. Merge to origin/main.
UTV2-34  T3  augment   DONE         ← MERGED: PR #8 merged to main 2026-03-26
UTV2-35  DOC claude    DONE         ← CLOSED: market key normalization contract RATIFIED
UTV2-36  T3  codex     DONE         ← MERGED: PR #9 merged to main 2026-03-27
UTV2-37  T3  augment   DONE         ← MERGED: PR #11 merged to main 2026-03-27
UTV2-38  T3  codex     DONE         ← MERGED: PR #12 merged to main 2026-03-27. 552/552.
UTV2-39  DOC claude    DONE         ← CLOSED: Smart Form V1 contract corrected to RATIFIED.
UTV2-40  T1  codex     IN_REVIEW    ← APPROVED ✅ PR #17. 592/592 root + 111/111 sf. Merge to origin/main.
UTV2-41  DOC claude    DONE         ← CLOSED: Operator Entity Ingest Health contract corrected to RATIFIED.
UTV2-42  T2  codex     IN_REVIEW    ← APPROVED ✅ PR #19. 600/600. Merge to origin/main.
```
