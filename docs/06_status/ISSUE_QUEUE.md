# Unit Talk V2 — Issue Queue

> **Queue is source of truth for state.** Linear mirrors it. Git branches are named `{lane}/{LINEAR_ID}-{slug}`.
> One issue = one branch = one PR. No stacking.

## Queue Health

| Lane | IN_PROGRESS | IN_REVIEW | READY | BLOCKED | DONE |
|---|---|---|---|---|---|
| `lane:codex` | 1 | 1 | 2 | 0 | 2 |
| `lane:claude` | 0 | 0 | 0 | 0 | 3 |
| `lane:augment` | 2 | 0 | 0 | 0 | 0 |

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
| **Unlocks** | UTV2-30 (grading endpoint required for ingest proof) |
| **Branch** | committed directly to `main` |
| **PR** | — (committed to main: migrations 012+013, grading-service.ts) |

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
| **Unlocks** | — |
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
| **Status** | **IN_REVIEW** |
| **Milestone** | M5 |
| **Area** | `area:ingestor` `area:db` |
| **Blocked by** | — |
| **Unlocks** | — |
| **Branch** | `codex/UTV2-42-sgo-results-ingest` |
| **PR** | #3 — **APPROVED** ✅ (ready to merge) |

#### Acceptance Criteria

- [x] `pnpm verify` exits 0 — verified in clean worktree: 534 tests, 0 fail
- [x] `FakePickRepository.listByLifecycleState` implemented (worker-runtime.test.ts passes)
- [x] Ingestor runs against SGO, writes `game_results` rows with `source='sgo'`
- [x] Idempotency: second run produces no new rows
- [x] `POST /api/grading/run` proof: pick graded, settlement persisted
- [x] Contract: `T2_SGO_RESULTS_INGEST_CONTRACT.md` present

#### Claude Review Note (2026-03-26) — APPROVED

Branch clean (3 commits, all UTV2-42 scoped). `pnpm verify` exit 0 in isolated worktree (534/534 pass). Live proof complete and credible. One non-blocking warning (76ers team match) noted.

**Next action:** Human merge PR #3 into main.

---

### UTV2-31 — T2 Discord /stats Command

| Field | Value |
|---|---|
| **ID** | UTV2-31 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **IN_PROGRESS** |
| **Milestone** | M5 |
| **Area** | `area:discord-bot` `area:operator-web` |
| **Blocked by** | — (UTV2-28 DONE ✅, UTV2-32 DONE ✅) |
| **Unlocks** | — |
| **Branch** | `codex/UTV2-43-discord-stats` |
| **PR** | #7 (DRAFT — not yet in review) |

#### Notes

Contract: `docs/05_operations/T2_DISCORD_STATS_CONTRACT.md` — RATIFIED.
When Codex marks PR #7 ready, Claude review will check: `pnpm verify` exit 0, ≥6 net-new tests, total ≥748.

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
| **Unlocks** | UTV2-31 |
| **Branch** | — |
| **PR** | — |

#### Notes

Contract RATIFIED: `docs/05_operations/T2_DISCORD_STATS_CONTRACT.md`.

---

### UTV2-33 — T2 Market Key Normalization

| Field | Value |
|---|---|
| **ID** | UTV2-33 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **IN_PROGRESS** |
| **Milestone** | M5 |
| **Area** | `area:api` `area:domain` |
| **Blocked by** | — (UTV2-35 DONE ✅) |
| **Unlocks** | — |
| **Branch** | `codex/UTV2-45-market-key-normalization` |
| **PR** | #5 (DRAFT — not yet in review) |

#### Notes

Contract: `docs/05_operations/T2_MARKET_KEY_NORMALIZATION_CONTRACT.md` — RATIFIED.
When Codex marks PR #5 ready, Claude review will check: `pnpm verify` exit 0, ≥6 net-new tests, total ≥746.

---

### UTV2-34 — T3 Deploy Commands Verify

| Field | Value |
|---|---|
| **ID** | UTV2-34 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **IN_PROGRESS** |
| **Milestone** | M4 |
| **Area** | `area:discord-bot` |
| **Blocked by** | — |
| **Unlocks** | — |
| **Branch** | `augment/UTV2-34-deploy-commands-verify` |
| **PR** | #2 — **REJECTED** (branch stacked: contains 2 foreign commits) |

#### Acceptance Criteria

- [ ] Branch clean — only UTV2-34 commits beyond main
- [ ] `pnpm verify` exits 0 on clean branch
- [ ] `pnpm --filter @unit-talk/discord-bot deploy-commands` runs and output documented
- [ ] Result documented in `docs/06_status/PROGRAM_STATUS.md`

#### Claude Review Note (2026-03-26) — REJECTED (third)

Branch still contains 2 foreign commits:
- `7ef7e8c` — stale draft blocker note (superseded, should not be in final branch)
- `3e115d0` — linear smoke test (F-7 unqueued work, was in closed PR #1)

The implementation in commit `5e28eb6` is good. Fix: cherry-pick `5e28eb6` onto a fresh branch from main.

**Secondary note:** The config/env.ts changes in `5e28eb6` (restoring 10 missing env vars) may exceed T3 scope. Raise with queue owner — may need a separate T2 issue for the config drift fix.

**Fix:** `git checkout main && git checkout -b augment/UTV2-34-v2 && git cherry-pick 5e28eb6 && pnpm verify && git push`

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
| **Unlocks** | UTV2-33 |
| **Branch** | — |
| **PR** | — |

#### Notes

Contract RATIFIED: `docs/05_operations/T2_MARKET_KEY_NORMALIZATION_CONTRACT.md`.

---

### UTV2-36 — T3 Queue Tooling (claim/submit scripts)

| Field | Value |
|---|---|
| **ID** | UTV2-36 |
| **Tier** | T3 |
| **Lane** | `lane:codex` |
| **Status** | **READY** |
| **Milestone** | M5 |
| **Area** | `area:tooling` |
| **Blocked by** | — |
| **Unlocks** | persistent loop automation |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

- [ ] `scripts/claim-issue.mjs <issue-id>` — creates branch from main, updates queue status to IN_PROGRESS
- [ ] `scripts/submit-issue.mjs <issue-id>` — opens PR, updates queue status to IN_REVIEW
- [ ] Branch naming enforced: `{lane}/{linear-id}-{slug}`
- [ ] Cannot claim from a stacked branch (guard: base must be main)
- [ ] `pnpm verify` exits 0

---

### UTV2-37 — T3 SGO Results Seed Proof

| Field | Value |
|---|---|
| **ID** | UTV2-37 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **IN_PROGRESS** |
| **Milestone** | M5 |
| **Area** | `area:tooling` `area:db` |
| **Blocked by** | — (UTV2-28 DONE ✅) |
| **Unlocks** | — |
| **Branch** | `augment/UTV2-37-sgo-results-seed-proof` |
| **PR** | #6 — **REJECTED** (branch stacked: 3 foreign commits) |

#### Acceptance Criteria

- [ ] Branch clean — only commit `11f7793` beyond main
- [ ] `pnpm verify` exits 0 on clean branch
- [ ] `--help` prints usage and exits 0
- [ ] Seed run inserts `game_results` row, ID documented
- [ ] Proof doc at `docs/06_status/grading_seed_proof.md`

#### Claude Review Note (2026-03-26) — REJECTED (third)

Branch still stacked on 3 foreign commits:
- `2f574e2` — UTV2-42 ingestor (UTV2-30 work)
- `7ef7e8c` — UTV2-34 stale doc
- `3e115d0` — linear smoke test

Commit `11f7793` contains the correct UTV2-37 work. Cherry-pick it onto a fresh branch from main.

**Fix:** `git checkout main && git checkout -b augment/UTV2-37-v2 && git cherry-pick 11f7793 && pnpm verify && git push`

---

## Queue State Reference

```
UTV2-28  T1  codex     DONE         ← CLOSED: live proof WIN. Migrations 012+013 committed to main.
UTV2-29  DOC claude    DONE         ← CLOSED: MLB ratification complete; contract RATIFIED
UTV2-30  T2  codex     IN_REVIEW    ← APPROVED: pnpm verify ✅, live proof ✅; awaiting human merge of PR #3
UTV2-31  T2  codex     IN_PROGRESS  ← Draft PR #7 opened; not yet in review
UTV2-32  DOC claude    DONE         ← CLOSED: /stats contract RATIFIED
UTV2-33  T2  codex     IN_PROGRESS  ← Draft PR #5 opened; not yet in review
UTV2-34  T3  augment   IN_PROGRESS  ← REJECTED (×3): branch stacked; cherry-pick 5e28eb6 onto clean branch
UTV2-35  DOC claude    DONE         ← CLOSED: market key normalization contract RATIFIED
UTV2-36  T3  codex     READY        ← Queue tooling scripts — no branch yet
UTV2-37  T3  augment   IN_PROGRESS  ← REJECTED (×3): branch stacked; cherry-pick 11f7793 onto clean branch
```
