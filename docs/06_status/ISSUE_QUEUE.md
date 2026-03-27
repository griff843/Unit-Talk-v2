# Unit Talk V2 — Issue Queue

> **Queue is source of truth for state.** Linear mirrors it. Git branches are named `{lane}/{LINEAR_ID}-{slug}`.
> One issue = one branch = one PR. No stacking.

## Queue Health

| Lane | IN_PROGRESS | IN_REVIEW | READY | BLOCKED | DONE |
|---|---|---|---|---|---|
| `lane:codex` | 2 | 1 | 1 | 2 | 3 |
| `lane:claude` | 0 | 0 | 0 | 0 | 5 |
| `lane:augment` | 1 | 0 | 0 | 0 | 2 |

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
| **Status** | **DONE** |
| **Milestone** | M5 |
| **Area** | `area:ingestor` `area:db` |
| **Blocked by** | — |
| **Unlocks** | — |
| **Branch** | `codex/UTV2-42-sgo-results-ingest` |
| **PR** | #3 — **MERGED** ✅ (2026-03-26) |

#### Acceptance Criteria

- [x] `pnpm verify` exits 0 — verified in clean worktree: 534 tests, 0 fail
- [x] `FakePickRepository.listByLifecycleState` implemented (worker-runtime.test.ts passes)
- [x] Ingestor runs against SGO, writes `game_results` rows with `source='sgo'`
- [x] Idempotency: second run produces no new rows
- [x] `POST /api/grading/run` proof: pick graded, settlement persisted
- [x] Contract: `T2_SGO_RESULTS_INGEST_CONTRACT.md` present

#### Claude Review Note (2026-03-26) — APPROVED

Branch clean (3 commits, all UTV2-42 scoped). `pnpm verify` exit 0 in isolated worktree (534/534 pass). Live proof complete and credible. One non-blocking warning (76ers team match) noted.

**Merged:** PR #3 merged to main 2026-03-26. Merge commit resolved conflicts in repositories.ts, runtime-repositories.ts, types.ts.

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
When Codex marks PR #7 ready, Claude review will check: `pnpm verify` exit 0, ≥8 net-new tests wired into `pnpm test` (≥6 operator-web stats tests + discord-bot tests wired into `test:apps`), total ≥590.

#### ⚠️ Branch Warning (2026-03-26) — STALE BASE

`codex/UTV2-43-discord-stats` is based on old main and deletes production code: `apps/api/src/clv-service.ts`, `apps/api/src/grading-service.ts`, `apps/ingestor/`, all contracts. **Do not submit PR #7 until the branch is rebuilt from clean main.**

**Fix (exact commands):**
```bash
# Save the good implementation files first — reference them from the old branch
git fetch origin
git checkout codex/UTV2-43-discord-stats
# Copy stats.ts to a safe location or note the implementation
git checkout -b codex/UTV2-31-discord-stats-v2 origin/main
# Implement /stats from scratch on clean main — add only these files:
#   apps/discord-bot/src/commands/stats.ts  (from old branch reference)
#   apps/operator-web/src/server.ts         (add GET /api/operator/stats only)
#   apps/operator-web/src/server.test.ts    (add ≥6 new tests)
#   apps/discord-bot/src/discord-bot-foundation.test.ts  (add ≥2 new tests)
#   package.json: add discord-bot tests to test:apps (do NOT remove clv-service or grading-service)
pnpm verify
git push -u origin codex/UTV2-31-discord-stats-v2
```
Do NOT delete `clv-service.test.ts`, `grading-service.test.ts`, or anything in `apps/ingestor/`. Create a new PR from the v2 branch; close PR #7.

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
When Codex marks PR #5 ready, Claude review will check: `pnpm verify` exit 0, ≥6 net-new tests, total ≥557.

#### ⚠️ Branch Warning (2026-03-26) — STALE BASE

`codex/UTV2-45-market-key-normalization` is based on old main and deletes production code: `apps/api/src/clv-service.ts`, `apps/api/src/grading-service.ts`, `apps/ingestor/`, all contracts. **Do not submit PR #5 until the branch is rebuilt from clean main.**

**Fix (exact commands):**
```bash
git fetch origin
git checkout codex/UTV2-45-market-key-normalization
# Reference the implementation files before switching
git checkout -b codex/UTV2-33-market-keys-v2 origin/main
# Implement market key normalization from scratch on clean main — add only these files:
#   packages/domain/src/market-key.ts       (new file with MARKET_KEY_MAP + normalizeMarketKey)
#   packages/domain/src/market-key.test.ts  (≥4 tests)
#   apps/api/src/submission-service.ts      (wire normalizeMarketKey into processSubmission)
#   apps/api/src/submission-service.test.ts (add ≥2 tests)
pnpm verify
git push -u origin codex/UTV2-33-market-keys-v2
```
Do NOT delete any existing files. Create a new PR from the v2 branch; close PR #5.

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
| **PR** | #8 — **MERGED** ✅ (2026-03-26) |

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

**DISCORD_CLIENT_ID verified and updated (2026-03-27).** Deploy-commands confirmed operational end-to-end.

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
| **Status** | **IN_REVIEW** |
| **Milestone** | M5 |
| **Area** | `area:tooling` |
| **Blocked by** | — (PR #3 + PR #8 now merged) |
| **Unlocks** | persistent loop automation |
| **Branch** | `codex/UTV2-36-queue-tooling` |
| **PR** | #9 — **READY TO REBASE** (PR #3 + #8 merged 2026-03-26) |

#### Acceptance Criteria

- [x] `scripts/claim-issue.mjs <issue-id>` — creates branch from main, updates queue status to IN_PROGRESS
- [x] `scripts/submit-issue.mjs <issue-id>` — opens PR, updates queue status to IN_REVIEW
- [x] Branch naming enforced: `{lane}/{linear-id}-{slug}`
- [x] Cannot claim from a stacked branch (guard: base must be main)
- [ ] `pnpm verify` exits 0 on clean branch after reset+cherry-pick

#### Claude Review Note (2026-03-27) — REJECTED (×1)

Branch was NOT rebased. Codex added 2 commits on top of old base `f3457b2` (pre-merge). Diff vs current main shows 14 out-of-scope files (DB layer, contracts, settlement-service, ISSUE_QUEUE.md). Also: commit `9d80365` modifies ISSUE_QUEUE.md on the feature branch — queue files are Claude lane only.

CI passes, tooling code (`5da8df7`) looks correct. Only hygiene issue.

**Fix (exact commands):**
```bash
git fetch origin
git checkout codex/UTV2-36-queue-tooling
git reset --hard origin/main
git cherry-pick 5da8df7
pnpm verify
git push --force-with-lease origin codex/UTV2-36-queue-tooling
```
Do NOT cherry-pick `9d80365` (ISSUE_QUEUE.md commit). Then re-submit PR #9.

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
| **Branch** | `augment/UTV2-37-v3` (clean — pushed 2026-03-27) |
| **PR** | #10 — **CLOSED** (stale); new PR needed from `augment/UTV2-37-v3` |

#### Acceptance Criteria

- [x] Branch clean — only `053379a` (seed script + proof) beyond main
- [ ] `pnpm verify` exits 0 — CI pending
- [x] `--help` prints usage and exits 0 (in commit message)
- [x] Seed run inserts `game_results` row, ID documented (`398d34b4`)
- [x] Proof doc at `docs/06_status/grading_seed_proof.md`
- [x] No ISSUE_QUEUE.md or PROGRAM_STATUS.md changes on feature branch

#### Claude Review Note (2026-03-27) — BRANCH CLEAN, AWAITING PR

`augment/UTV2-37-v3` is now correct: 1 commit (`053379a`) ahead of main, touching only `scripts/seed-game-result.ts` and `docs/06_status/grading_seed_proof.md`. No queue files.

**Next action (Augment):** Rebase onto current main first (lockfile fix landed in `3d2a685` — branch may have old lockfile), then open new PR → main. Claude will review when ready.

```bash
git fetch origin
git checkout augment/UTV2-37-v3
git rebase origin/main
git push --force-with-lease origin augment/UTV2-37-v3
# Then open new PR from augment/UTV2-37-v3 → main
```

---

---

### UTV2-38 — T3 Board Cap Lifecycle Filter

| Field | Value |
|---|---|
| **ID** | UTV2-38 |
| **Tier** | T3 |
| **Lane** | `lane:codex` |
| **Status** | **READY** |
| **Milestone** | M6 |
| **Area** | `area:api` `area:db` |
| **Blocked by** | — |
| **Unlocks** | Promotion qualification for picks after board saturates with settled history |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

- [ ] `getPromotionBoardState` in `packages/db/src/runtime-repositories.ts` filters board count to picks with `status NOT IN ('settled', 'voided')` — only active picks (queued/posted) count toward board cap
- [ ] Same filter applied to `sameGameCount`, `sameSportCount`, and `duplicateCount` queries
- [ ] `pnpm verify` exits 0; test count does not decrease
- [ ] New test: board state returns 0 for a pick whose board slot is fully settled

#### Notes

Known open risk (PROGRAM_STATUS.md): after 5+ test runs, boards saturate because `getPromotionBoardState` counts ALL picks with `promotion_status IN ('qualified', 'promoted')` including settled/historical. Fix: filter to `lifecycle_state NOT IN ('settled', 'voided')` (or equivalently `status NOT IN ('settled', 'voided')` per schema — `picks.status` = lifecycle state). This is a pure query fix — no migration.

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
| **Unlocks** | UTV2-40 |
| **Branch** | — |
| **PR** | — |

#### Notes

`docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md` was prematurely marked CLOSED — `capperConviction` field is NOT implemented in `apps/smart-form`. Contract corrected to RATIFIED. Implementation issue UTV2-40 now READY.

---

### UTV2-40 — T1 Smart Form V1 Conviction Field

| Field | Value |
|---|---|
| **ID** | UTV2-40 |
| **Tier** | T1 |
| **Lane** | `lane:codex` |
| **Status** | **BLOCKED** |
| **Milestone** | M6 |
| **Area** | `area:smart-form` |
| **Blocked by** | UTV2-39 (DONE ✅) |
| **Unlocks** | Smart Form picks become promotion-eligible (currently all score 61.5 < 70) |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

See `docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md` for full AC. Summary:
- [ ] `capperConviction` (1–10) added to `betFormSchema` in `apps/smart-form/lib/form-schema.ts`
- [ ] `buildSubmissionPayload` maps `capperConviction * 10` → `metadata.promotionScores.trust`
- [ ] Conviction input rendered in `BetForm.tsx` (Stake section) with inline help text
- [ ] `BetSlipPanel` and `SuccessReceipt` display conviction rating
- [ ] ≥6 new tests (schema validation + payload mapping + E2E assertion)
- [ ] `pnpm verify` exits 0; test count does not decrease

#### Notes

Contract: `docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md` — RATIFIED (corrected 2026-03-26).
T1 tier: requires proof bundle after merge (submit a pick via Smart Form, confirm `promotionScores.trust` populated in DB).

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
| **Unlocks** | UTV2-42 |
| **Branch** | — |
| **PR** | — |

#### Notes

`docs/05_operations/T2_OPERATOR_ENTITY_INGEST_HEALTH_CONTRACT.md` was prematurely marked CLOSED — `entityHealth`, participant route, and HTML sections are NOT implemented in `apps/operator-web`. Contract corrected to RATIFIED. Implementation issue UTV2-42 now READY.

---

### UTV2-42 — T2 Operator Entity Ingest Health

| Field | Value |
|---|---|
| **ID** | UTV2-42 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **BLOCKED** |
| **Milestone** | M6 |
| **Area** | `area:operator-web` |
| **Blocked by** | UTV2-41 (DONE ✅) |
| **Unlocks** | Entity data operator-visible; unblocks Smart Form participant autocomplete |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

See `docs/05_operations/T2_OPERATOR_ENTITY_INGEST_HEALTH_CONTRACT.md` for full AC. Summary:
- [ ] `GET /api/operator/snapshot` includes `entityHealth` (resolved events, players, teams counts)
- [ ] HTML dashboard: "Upcoming Events" mini-table, "Entity Catalog" health card, "Last Ingest Cycle" section
- [ ] `GET /api/operator/participants` route (type/sport/q/limit filters)
- [ ] ≥6 new tests; `pnpm verify` exits 0; test count does not decrease

#### Notes

Contract: `docs/05_operations/T2_OPERATOR_ENTITY_INGEST_HEALTH_CONTRACT.md` — RATIFIED (corrected 2026-03-26).
File scope: `apps/operator-web/src/server.ts` + `apps/operator-web/src/server.test.ts` only.
When Codex marks PR ready, Claude review checks: `pnpm verify` exit 0, ≥6 net-new tests, `entityHealth` in snapshot response, participant route returns 200.

---

## Queue State Reference

```
UTV2-28  T1  codex     DONE         ← CLOSED: live proof WIN. Migrations 012+013 committed to main.
UTV2-29  DOC claude    DONE         ← CLOSED: MLB ratification complete; contract RATIFIED
UTV2-30  T2  codex     DONE         ← MERGED: PR #3 merged to main 2026-03-26
UTV2-31  T2  codex     IN_PROGRESS  ← ⚠️ STALE BRANCH (codex/UTV2-43): deletes production code. Rebuild from main as codex/UTV2-31-discord-stats-v2.
UTV2-32  DOC claude    DONE         ← CLOSED: /stats contract RATIFIED
UTV2-33  T2  codex     IN_PROGRESS  ← ⚠️ STALE BRANCH (codex/UTV2-45): deletes production code. Rebuild from main as codex/UTV2-33-market-keys-v2.
UTV2-34  T3  augment   DONE         ← MERGED: PR #8 merged to main 2026-03-26
UTV2-35  DOC claude    DONE         ← CLOSED: market key normalization contract RATIFIED
UTV2-36  T3  codex     IN_REVIEW    ← REJECTED (×1): branch not rebased, ISSUE_QUEUE.md on branch. reset --hard origin/main && cherry-pick 5da8df7
UTV2-37  T3  augment   IN_PROGRESS  ← BRANCH CLEAN (augment/UTV2-37-v3, 1 commit). Rebase onto main (lockfile fix 3d2a685), open new PR → main.
UTV2-38  T3  codex     READY        ← Board cap lifecycle filter. No contract needed. Start immediately.
UTV2-39  DOC claude    DONE         ← CLOSED: Smart Form V1 contract corrected to RATIFIED.
UTV2-40  T1  codex     BLOCKED      ← Blocked by UTV2-39 (DONE). Now READY. Implement Smart Form conviction field.
UTV2-41  DOC claude    DONE         ← CLOSED: Operator Entity Ingest Health contract corrected to RATIFIED.
UTV2-42  T2  codex     BLOCKED      ← Blocked by UTV2-41 (DONE). Now READY. Implement operator entity health.
```
