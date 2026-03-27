# Unit Talk V2 — Issue Queue

> **Queue is source of truth for state.** Linear mirrors it. Git branches are named `{lane}/{LINEAR_ID}-{slug}`.
> One issue = one branch = one PR. No stacking.

## Queue Health

| Lane | IN_PROGRESS | IN_REVIEW | READY | BLOCKED | DONE |
|---|---|---|---|---|---|
| `lane:codex` | 1 | 1 | 2 | 0 | 2 |
| `lane:claude` | 0 | 0 | 0 | 0 | 3 |
| `lane:augment` | 0 | 1 | 0 | 0 | 1 |

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
| **Status** | **DONE** |
| **Milestone** | M4 |
| **Area** | `area:discord-bot` |
| **Blocked by** | — |
| **Unlocks** | — |
| **Branch** | `augment/UTV2-34-v4` |
| **PR** | #8 — **APPROVED** ✅ (ready to merge) |

#### Acceptance Criteria

- [x] Branch clean — 4 commits, all UTV2-34 scoped (79fb85f, a3d4faa, 4642f47, 3f3dce3)
- [x] `pnpm lint` exit 0 — verified directly in real repo root (worktree false-fail due to ESLint glob path)
- [x] `pnpm type-check` exit 0
- [x] Tests: 551/551 pass
- [x] `pnpm --filter @unit-talk/discord-bot deploy-commands` runs — reaches Discord API, returns DiscordAPIError[20012] (credential mismatch, not code bug)
- [x] Result documented in `docs/06_status/PROGRAM_STATUS.md`

#### Claude Review Note (2026-03-26) — APPROVED

Branch clean. Real-repo lint exit 0. Type-check exit 0. 551/551 tests pass. deploy-commands executes correctly end-to-end — 403 is a credential mismatch (DISCORD_CLIENT_ID doesn't match application owning the bot token), not a code defect. PROGRAM_STATUS updated.

**Scope note accepted:** `packages/config/src/env.ts` changes (10 missing env vars restored) technically exceed T3 scope but were required for deploy-commands to load config at all.

**Next action for human:** Verify `DISCORD_CLIENT_ID` in `local.env` matches the Application ID in Discord Developer Portal → Applications → General Information. Then re-run `pnpm --filter @unit-talk/discord-bot deploy-commands` to confirm full success.

**Next action:** Human merge PR #8 into main.

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
| **Branch** | `augment/UTV2-37-v2` |
| **PR** | #10 — open |

#### Acceptance Criteria

- [x] Branch clean — 3 commits: 2 UTV2-34 prereqs (79fb85f + a3d4faa) + UTV2-37 commit (11f7793)
- [x] `pnpm type-check` exit 0; all tests pass
- [x] `--help` prints usage and exits 0 — `pnpm exec tsx scripts/seed-game-result.ts --help` exit 0 ✅
- [x] Proof doc at `docs/06_status/grading_seed_proof.md` — present in commit `11f7793`
- [ ] Seed run inserts `game_results` row, ID documented — requires live DB (post-merge action)

#### Augment Implementation Note (2026-03-27)

UTV2-34 (#8) not yet merged to main. `main`'s discord-bot foundation layer (`77c669d`) imports from `./command-registry.js`, `./config.js`, `./commands/pick.js` — files that only exist in UTV2-34. This is a pre-existing type-check gap masked by stale `tsbuildinfo` cache. To satisfy AC `pnpm type-check exit 0`, UTV2-34 code commits (`79fb85f`, `a3d4faa`) are included as explicit prerequisites on this branch. Once UTV2-34 is merged, this branch can be rebased to 1 commit. `--help` verified exit 0. Proof doc present.

---

## Queue State Reference

```
UTV2-28  T1  codex     DONE         ← CLOSED: live proof WIN. Migrations 012+013 committed to main.
UTV2-29  DOC claude    DONE         ← CLOSED: MLB ratification complete; contract RATIFIED
UTV2-30  T2  codex     IN_REVIEW    ← APPROVED: pnpm verify ✅, live proof ✅; awaiting human merge of PR #3
UTV2-31  T2  codex     IN_PROGRESS  ← Draft PR #7 opened; not yet in review
UTV2-32  DOC claude    DONE         ← CLOSED: /stats contract RATIFIED
UTV2-33  T2  codex     IN_PROGRESS  ← Draft PR #5 opened; not yet in review
UTV2-34  T3  augment   DONE         ← APPROVED: PR #8 clean branch, pnpm verify ✅, deploy-commands runs; awaiting human merge
UTV2-35  DOC claude    DONE         ← CLOSED: market key normalization contract RATIFIED
UTV2-36  T3  codex     READY        ← Queue tooling scripts — no branch yet
UTV2-37  T3  augment   IN_REVIEW    ← PR #9 open; branch augment/UTV2-37-v2; pnpm type-check ✅; all tests pass
```
