# Unit Talk V2 — Issue Queue

> **Queue is source of truth for state.** Linear mirrors it. Git branches are named `{lane}/{LINEAR_ID}-{slug}`.
> One issue = one branch = one PR. No stacking.

## Queue Health

| Lane | IN_PROGRESS | IN_REVIEW | READY | BLOCKED | DONE |
|---|---|---|---|---|---|
| `lane:codex` | 0 | 0 | 2 | 0 | 8 |
| `lane:claude` | 0 | 0 | 0 | 0 | 6 |
| `lane:augment` | 0 | 0 | 1 | 0 | 2 |

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
| **Branch** | committed directly to `main` |
| **PR** | — |

Live proof: `POST /api/grading/run` → `attempted=4, graded=1, skipped=3, errors=0`. Settlement `1c9d8581`. Idempotent.

---

### UTV2-29 — MLB Provider Ratification (DOC)

| Field | Value |
|---|---|
| **ID** | UTV2-29 |
| **Tier** | DOC |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M4 |
| **Branch** | — |
| **PR** | — |

---

### UTV2-30 — T2 SGO Results Ingest

| Field | Value |
|---|---|
| **ID** | UTV2-30 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M5 |
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
| **Branch** | `codex/UTV2-31-discord-stats-v2` |
| **PR** | #13 — **MERGED** ✅ (2026-03-27) |

---

### UTV2-32 — DOC Discord /stats Contract

| Field | Value |
|---|---|
| **ID** | UTV2-32 |
| **Tier** | DOC |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M5 |

---

### UTV2-33 — T2 Market Key Normalization

| Field | Value |
|---|---|
| **ID** | UTV2-33 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M5 |
| **Branch** | `codex/UTV2-33-market-keys-v3` |
| **PR** | #18 — **MERGED** ✅ (2026-03-27) |

#### Live Proof (2026-03-27) — VERIFIED ✅

- `market: 'NBA points'` submitted → stored as `'points-all-game-ou'` (pick `d00954ec`)
- `market: 'MLB batting hits'` submitted → stored as `'batting-hits-all-game-ou'` (pick `306deff8`)
- `market: 'exotic custom market'` submitted → stored unchanged (pick `3b5d9e84`)
- All 3 proof assertions pass against live Supabase DB

---

### UTV2-34 — T3 Deploy Commands Verify

| Field | Value |
|---|---|
| **ID** | UTV2-34 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **DONE** |
| **Milestone** | M4 |
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

---

### UTV2-36 — T3 Queue Tooling (claim/submit scripts)

| Field | Value |
|---|---|
| **ID** | UTV2-36 |
| **Tier** | T3 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M5 |
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
| **Branch** | `augment/UTV2-37-v3` |
| **PR** | #11 — **MERGED** ✅ (2026-03-27) |

---

### UTV2-38 — T3 Board Cap Lifecycle Filter

| Field | Value |
|---|---|
| **ID** | UTV2-38 |
| **Tier** | T3 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M6 |
| **Branch** | `codex/UTV2-38-board-cap-filter` |
| **PR** | #12 — **MERGED** ✅ (2026-03-27) |

---

### UTV2-39 — DOC Smart Form V1 Contract Reactivation

| Field | Value |
|---|---|
| **ID** | UTV2-39 |
| **Tier** | DOC |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M6 |

---

### UTV2-40 — T1 Smart Form V1 Conviction Field

| Field | Value |
|---|---|
| **ID** | UTV2-40 |
| **Tier** | T1 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M6 |
| **Branch** | `codex/UTV2-40-smart-form-conviction-v2` |
| **PR** | #17 — **MERGED** ✅ (2026-03-27) |

#### Live Proof (2026-03-27) — VERIFIED ✅

- conviction=8 → `metadata.promotionScores.trust = 80` stored in `picks` (pick `b902dcb6`, source=`smart-form`)
- conviction=10 → trust=100 (pick `d77a35b3`)
- conviction=4 → trust=40, `promotionStatus = 'not_eligible'` (composite < 70) (pick `a3494404`)
- conviction=9 → trust=90 stored; meets Trader Insights `minimumTrust: 85` threshold (pick `9d1265e4`)
- All 4 proof assertions pass against live Supabase DB

---

### UTV2-41 — DOC Operator Entity Ingest Health Contract Reactivation

| Field | Value |
|---|---|
| **ID** | UTV2-41 |
| **Tier** | DOC |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M6 |

---

### UTV2-42 — T2 Operator Entity Ingest Health

| Field | Value |
|---|---|
| **ID** | UTV2-42 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M6 |
| **Branch** | `codex/UTV2-42-operator-entity-health-v2` |
| **PR** | #19 — **MERGED** ✅ (2026-03-27) |

#### Live Proof (2026-03-27) — VERIFIED ✅ (DB counts)

- `events WHERE external_id IS NOT NULL`: **46** rows
- `participants WHERE participant_type = 'player'`: **535** rows
- `participants WHERE participant_type = 'team'`: **124** rows
- Upcoming events (±7 days): Chicago Bulls vs OKC Thunder (2026-03-28), Jazz vs Nuggets (2026-03-28), Clippers vs Pacers (2026-03-27), and others
- `entityHealth` and `/api/operator/participants` route live in `apps/operator-web` (600/600 tests)

---

### UTV2-43 — DOC Discord /leaderboard Contract

| Field | Value |
|---|---|
| **ID** | UTV2-43 |
| **Tier** | DOC |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M7 |
| **Area** | `area:contracts` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

#### Notes

Contract RATIFIED: `docs/05_operations/T2_DISCORD_LEADERBOARD_CONTRACT.md` (2026-03-27). Unlocks UTV2-44 implementation.

---

### UTV2-44 — T2 Discord /leaderboard Command

| Field | Value |
|---|---|
| **ID** | UTV2-44 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **READY** |
| **Milestone** | M7 |
| **Area** | `area:discord-bot` `area:operator-web` |
| **Blocked by** | — (UTV2-43 DONE ✅) |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

See `docs/05_operations/T2_DISCORD_LEADERBOARD_CONTRACT.md`. Summary:
- [ ] `GET /api/operator/leaderboard` returns ranked `LeaderboardResponse` with winRate/roiPct/streak
- [ ] Ranking: winRate DESC, roiPct DESC tiebreaker; filtered by `minPicks` (default 3)
- [ ] `?last=99` → HTTP 400
- [ ] `/leaderboard [window] [sport] [limit]` registered in Discord
- [ ] Embed renders ranked entries with streak icons
- [ ] ≥8 net-new tests; `pnpm verify` exits 0; total ≥ 606

---

### UTV2-45 — T3 Smart Form Participant Autocomplete

| Field | Value |
|---|---|
| **ID** | UTV2-45 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **READY** |
| **Milestone** | M7 |
| **Area** | `area:smart-form` |
| **Blocked by** | UTV2-42 DONE ✅ (`GET /api/operator/participants` live) |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

- [ ] `BetForm.tsx` typeahead calls `GET /api/operator/participants?q=<name>&type=player` on player field input
- [ ] Suggestions appear after ≥2 characters; debounced (300ms); max 10 results
- [ ] Selecting a suggestion fills `participant_id` and `participantName` fields
- [ ] No change to submission payload schema — `participant_id` already exists
- [ ] `pnpm verify` exits 0

---

### UTV2-46 — T2 CLV Settlement Wiring

| Field | Value |
|---|---|
| **ID** | UTV2-46 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **READY** |
| **Milestone** | M7 |
| **Area** | `area:api` |
| **Blocked by** | UTV2-28 DONE ✅, UTV2-30 DONE ✅ |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

See `docs/05_operations/T2_CLV_SETTLEMENT_WIRING_CONTRACT.md`. Summary:
- [ ] `recordGradedSettlement()` calls `computeAndAttachCLV` (replaces `resolveClvPayload`)
- [ ] `payload.clvRaw` (number) written when closing line exists
- [ ] `payload.beatsClosingLine` (boolean) written when closing line exists
- [ ] `payload.clvPercent` (number) written when closing line exists
- [ ] No CLV keys written when no matching closing line found
- [ ] ≥4 net-new tests; `pnpm verify` exits 0; total ≥ 602

---

## Queue State Reference

```
UTV2-28  T1  codex     DONE         ← CLOSED: live proof WIN
UTV2-29  DOC claude    DONE         ← CLOSED: MLB ratification RATIFIED
UTV2-30  T2  codex     DONE         ← MERGED: PR #3 (2026-03-26)
UTV2-31  T2  codex     DONE         ← MERGED: PR #13 (2026-03-27). 591/591.
UTV2-32  DOC claude    DONE         ← CLOSED: /stats contract RATIFIED
UTV2-33  T2  codex     DONE         ← MERGED: PR #18 (2026-03-27). 598/598. Live proof verified.
UTV2-34  T3  augment   DONE         ← MERGED: PR #8 (2026-03-26)
UTV2-35  DOC claude    DONE         ← CLOSED: market key normalization contract RATIFIED
UTV2-36  T3  codex     DONE         ← MERGED: PR #9 (2026-03-27)
UTV2-37  T3  augment   DONE         ← MERGED: PR #11 (2026-03-27)
UTV2-38  T3  codex     DONE         ← MERGED: PR #12 (2026-03-27). 552/552.
UTV2-39  DOC claude    DONE         ← CLOSED: Smart Form V1 contract RATIFIED
UTV2-40  T1  codex     DONE         ← MERGED: PR #17 (2026-03-27). Live proof: trust scores verified.
UTV2-41  DOC claude    DONE         ← CLOSED: Operator Entity Ingest Health contract RATIFIED
UTV2-42  T2  codex     DONE         ← MERGED: PR #19 (2026-03-27). Live proof: 46 events, 535 players.
UTV2-43  DOC claude    DONE         ← CLOSED: /leaderboard contract RATIFIED (2026-03-27)
UTV2-44  T2  codex     READY        ← Contract live. Implement /leaderboard. Baseline: 598. Target: ≥606.
UTV2-45  T3  augment   READY        ← UTV2-42 DONE. Smart form participant autocomplete.
UTV2-46  T2  codex     READY        ← CLV wiring contract RATIFIED. Wire computeAndAttachCLV. Baseline: 598. Target: ≥602.
```
