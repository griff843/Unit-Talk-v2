# Unit Talk V2 — Issue Queue

> **Authority:** `docs/05_operations/QUEUE_ORCHESTRATION_DESIGN.md` defines the rules for this queue.
> **Conflict resolution:** `docs/06_status/PROGRAM_STATUS.md` wins on conflict with any field in this file.
> **Linear mirror:** Issues live at linear.app/unit-talk-v2 — Linear IDs UTV2-40–49 map to queue IDs UTV2-28–37 (Linear auto-assigned sequential IDs; queue IDs are canonical).
> **Last updated:** 2026-03-26

---

## Queue Health

| Lane | IN_PROGRESS | IN_REVIEW | READY | BLOCKED | DONE |
|---|---|---|---|---|---|
| `lane:codex` | 0 | 0 | 4 | 0 | 1 |
| `lane:claude` | 0 | 0 | 0 | 0 | 3 |
| `lane:augment` | 0 | 1 | 1 | 0 | 0 |

---

## Active Issues

---

### [UTV2-28] T1 Automated Grading — Results Schema & Grading Service

| Field | Value |
|---|---|
| **ID** | UTV2-28 |
| **Tier** | T1 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M4 |
| **Area** | `area:api` `area:db` |
| **Blocked by** | — |
| **Unlocks** | UTV2-30 ✅, UTV2-33 ✅, UTV2-35 ✅ |
| **Branch** | `codex/UTV2-28-automated-grading` |
| **PR** | — |

#### Acceptance Criteria

- [x] Migration 012: `game_results` table with `(event_id, participant_id, market_key, source)` UNIQUE constraint
- [x] Migration 013: `settlement_records_source_check` extended to include `'grading'`
- [x] `GradeResultRepository` interface in `packages/db/src/repositories.ts`
- [x] `InMemoryGradeResultRepository` + `DatabaseGradeResultRepository` in `runtime-repositories.ts`
- [x] `grading-service.ts` in `apps/api/src/`: `runGradingPass()`, `recordGradedSettlement()` internal path
- [x] `POST /api/grading/run` endpoint — bounded, not exposed to feed source
- [x] `settlementSources` in `schema.ts` extended with `'grading'`
- [x] `pnpm verify` exits 0; 11 net-new tests (740 total)

#### Proof

- **Date:** 2026-03-26
- **Migration 012:** Applied — `202603200012` confirmed in `supabase migration list --linked`
- **Migration 013:** Applied — `settlement_records_source_check` extended to include `'grading'`
- **Pick graded:** `41c8e72a` (NBA points, Over 27.5, Brandon Miller) — actual_value=30 → WIN
- **Settlement record:** `id=1c9d8581`, `pick_id=41c8e72a`, `result=win`, `source=grading`, `confidence=confirmed`, `evidence_ref=game_result:065b1b65`
- **Pick status:** `settled` at `2026-03-26T18:16:11.585+00:00`
- **Idempotency:** Second grading pass — attempted=4, graded=0 (settled pick excluded from query)
- **Deviations from contract:** `gradeOnePick()` not a separate named export (per-pick logic inlined in `runGradingPass`) — non-blocking

#### Contract Authority

`docs/05_operations/T1_AUTOMATED_GRADING_CONTRACT.md` (RATIFIED)

---

### [UTV2-29] Ratify T2 SGO Results Ingest — Live MLB API Call

| Field | Value |
|---|---|
| **ID** | UTV2-29 |
| **Tier** | DOCS |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M4 |
| **Area** | `area:governance` |
| **Blocked by** | — |
| **Unlocks** | UTV2-30 ✅ (promoted to READY) |
| **Branch** | — (DOCS-ONLY) |
| **PR** | — |

#### Acceptance Criteria

- [x] Live SGO API call against completed MLB events — `GET /v2/events?apiKey=...&leagueID=MLB&startsBefore=2026-03-26T23:59:59Z&startsAfter=2026-03-24T00:00:00Z`
- [x] Results field confirmed: `results[periodID][entityId][statField]` nested structure
- [x] Status detection confirmed: `status.completed && status.finalized` boolean flags (no statusId string)
- [x] Participant ID format confirmed: `PLAYER_NAME_N_LEAGUE` (e.g. `BRANDON_NIMMO_1_MLB`)
- [x] Stat field names confirmed: `batting_hits`, `batting_homeRuns`, `batting_RBI`, `pitching_strikeouts`, etc.
- [x] `sgo_results_api_research.md` updated with full live proof in §8
- [x] `T2_SGO_RESULTS_INGEST_CONTRACT.md` status → RATIFIED; §4.1 and §4.3 corrected
- [x] Prior design correction: `parseSGOResultKey()` flat-key approach INVALID — replaced with stat-field lookup

#### Proof

Live call 2026-03-26. Multiple completed MLB games found (e.g. Mets game, `status.displayLong: "Final"`).
Results field exists on completed events. Full findings in `sgo_results_api_research.md` §8.

---

### [UTV2-30] T2 SGO Results Ingest — Populate game_results from Feed

| Field | Value |
|---|---|
| **ID** | UTV2-30 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **READY** |
| **Milestone** | M4 |
| **Area** | `area:ingestor` `area:db` |
| **Blocked by** | — (UTV2-28 DONE ✅, UTV2-29 DONE ✅) |
| **Unlocks** | — |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

- [ ] `apps/ingestor/src/entity-resolver.ts`: `mapSGOStatus()` marks events `completed` for confirmed SGO terminal state strings
- [ ] `apps/ingestor/src/results-fetcher.ts` (NEW): `fetchSGOResults()` calls `v2/events` without `oddsAvailable=true`, returns `SGOEventResult[]`
- [ ] `apps/ingestor/src/results-resolver.ts` (NEW): `resolveAndInsertResults()` parses SGO result keys, derives market_key, inserts `game_results` rows
- [ ] Phase 3 added to ingest cycle in `apps/ingestor/src/index.ts`
- [ ] `UNIT_TALK_INGESTOR_SKIP_RESULTS=true` disables Phase 3 without breaking Phases 1 and 2
- [ ] UNIQUE constraint handles idempotency — duplicate insert is a no-op, not an error
- [ ] `pnpm verify` exits 0; ≥8 net-new tests

#### Proof Requirements

- [ ] `pnpm verify` exit 0
- [ ] Live ingest run shows `game_results` rows with `source: 'sgo'` and correct `market_key`
- [ ] Run ingest twice for the same completed event — row count does not increase
- [ ] `POST /api/grading/run` after ingest — pick auto-settled with `source: 'grading'`

#### Contract Authority

`docs/05_operations/T2_SGO_RESULTS_INGEST_CONTRACT.md` (RATIFIED ✅)

---

### [UTV2-31] T2 Discord `/stats` Command

| Field | Value |
|---|---|
| **ID** | UTV2-31 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **READY** |
| **Milestone** | M5 |
| **Area** | `area:discord-bot` `area:operator-web` |
| **Blocked by** | — (UTV2-28 DONE ✅, UTV2-32 DONE ✅) |
| **Unlocks** | — |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

- [ ] `GET /api/operator/stats?capper=&last=&sport=` endpoint in `apps/operator-web/src/server.ts`
- [ ] Response: `CapperStatsResponse` (wins, losses, pushes, winRate, roiPct, avgClvPct, beatsLine, lastFive)
- [ ] `apps/discord-bot/src/commands/stats.ts` (NEW): capper + window + sport options; calls operator stats endpoint
- [ ] Registered in `command-registry.ts`
- [ ] Embed: green/yellow/red/gray color coding; sample-size guard (<5 picks); CLV fields omitted if no CLV data
- [ ] No role gate (public within server)
- [ ] `pnpm verify` exits 0; ≥6 net-new tests

#### Contract Authority

`docs/05_operations/T2_DISCORD_STATS_CONTRACT.md` (RATIFIED ✅ — UTV2-32 DONE)

---

### [UTV2-32] Author T2 Discord `/stats` Contract

| Field | Value |
|---|---|
| **ID** | UTV2-32 |
| **Tier** | DOCS |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M5 |
| **Area** | `area:governance` |
| **Blocked by** | — |
| **Unlocks** | UTV2-31 ✅ (now READY — both unblock conditions met) |
| **Branch** | — (DOCS-ONLY) |
| **PR** | — |

#### Acceptance Criteria

- [x] Create `docs/05_operations/T2_DISCORD_STATS_CONTRACT.md`
- [x] Contract derives from `docs/03_product/DISCORD_STATS_COMMAND_SPEC.md`
- [x] Defines: API endpoint shape, capper identity resolution, embed format, sample size guards, file scope, AC list, proof requirements
- [x] Contract is T2 tier (confirmed: no migration, no settlement path change)
- [x] Status: RATIFIED — UTV2-31 implementation may now open

#### Proof

- Created `docs/05_operations/T2_DISCORD_STATS_CONTRACT.md` (RATIFIED, 2026-03-26)
- Endpoint: `GET /api/operator/stats?capper=&last=&sport=`
- Response: `CapperStatsResponse` — wins/losses/pushes/winRate/roiPct/avgClvPct/beatsLine/picksWithClv/lastFive
- AC: 10 items; proof: 4 items; 8 net-new tests required; total ≥ 748
- Capper identity: `submissions.submitted_by` case-insensitive match (no cappers table for V1)
- Color: green ≥0.55 / yellow 0.45–0.55 / red <0.45 / gray <10 picks

---

### [UTV2-33] T2 Market Key Normalization — `pick.market` → SGO Format

| Field | Value |
|---|---|
| **ID** | UTV2-33 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **READY** |
| **Milestone** | M5 |
| **Area** | `area:api` `area:domain` |
| **Blocked by** | — (UTV2-35 DONE ✅) |
| **Unlocks** | — (enables Discord picks to be graded by grading service) |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

- [ ] `packages/domain/src/market-key.ts`: `MARKET_KEY_MAP` (16 entries) + `normalizeMarketKey(market: string): string`
- [ ] `apps/api/src/submission-service.ts`: apply `normalizeMarketKey()` to `submission.market` before storing pick
- [ ] Unknown markets pass through unchanged (no rejection)
- [ ] `pnpm verify` exits 0; ≥6 net-new tests; total ≥ 746

#### Contract Authority

`docs/05_operations/T2_MARKET_KEY_NORMALIZATION_CONTRACT.md` (RATIFIED ✅ — UTV2-35 DONE)

---

### [UTV2-34] T3 Deploy Commands — Guild Deployment Verification

| Field | Value |
|---|---|
| **ID** | UTV2-34 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **IN_REVIEW** |
| **Milestone** | M4 |
| **Area** | `area:discord-bot` |
| **Blocked by** | `DISCORD_CLIENT_ID`, `DISCORD_CAPPER_ROLE_ID`, `UNIT_TALK_API_URL` missing from `local.env` |
| **Unlocks** | — |
| **Branch** | `augment/UTV2-34-deploy-commands-verify` |
| **PR** | — |

#### Acceptance Criteria

- [x] Verify `DISCORD_CAPPER_ROLE_ID` is populated in `local.env` — **MISSING** (see blocker finding below)
- [ ] Run `pnpm --filter @unit-talk/discord-bot deploy-commands` — blocked; not executed per AC item 4
- [x] Document result in `docs/06_status/PROGRAM_STATUS.md` — blocker finding recorded
- [x] If `DISCORD_CAPPER_ROLE_ID` is missing: document the missing env var as a blocker; do not proceed with deployment — **APPLIED**

#### Blocker Finding (2026-03-26)

`loadBotConfig()` requires 5 env vars. Verified against `local.env`:

| Var | Status |
|---|---|
| `DISCORD_BOT_TOKEN` | ✅ present |
| `DISCORD_GUILD_ID` | ✅ present |
| `DISCORD_CLIENT_ID` | ❌ **MISSING** |
| `DISCORD_CAPPER_ROLE_ID` | ❌ **MISSING** |
| `UNIT_TALK_API_URL` | ❌ **MISSING** |

Deployment cannot proceed. `deploy-commands` will throw on startup: `"Discord bot startup failed — missing required env vars: DISCORD_CLIENT_ID, DISCORD_CAPPER_ROLE_ID, UNIT_TALK_API_URL"`.

**Resolution required:** Add the three missing vars to `local.env` and re-run this issue.

#### Notes

This is T3 (config/deployment verify, no code change). If `deploy-commands` fails due to a code bug, that becomes a separate T2 issue. Do not fix code bugs in this issue.

---

### [UTV2-35] T3 Author Market Key Normalization Contract

| Field | Value |
|---|---|
| **ID** | UTV2-35 |
| **Tier** | DOCS |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M5 |
| **Area** | `area:governance` |
| **Blocked by** | — |
| **Unlocks** | UTV2-33 ✅ |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

- [x] Create `docs/05_operations/T2_MARKET_KEY_NORMALIZATION_CONTRACT.md`
- [x] Define: 16-entry translation table; normalization at submission time; pass-through for unmapped; AC and proof requirements
- [x] Contract tier: T2 (confirmed: no migration, no settlement path change)

#### Proof

- Created `docs/05_operations/T2_MARKET_KEY_NORMALIZATION_CONTRACT.md` (RATIFIED, 2026-03-26)
- 16 market key entries covering NBA and MLB player props
- Normalization at submission time via `normalizeMarketKey()` in `packages/domain/src/market-key.ts`
- Unknown markets pass through unchanged (no rejection)
- 6 net-new tests required; total ≥ 746

---

### [UTV2-36] T3 Queue Tooling Buildout

| Field | Value |
|---|---|
| **ID** | UTV2-36 |
| **Tier** | T3 |
| **Lane** | `lane:codex` |
| **Status** | **READY** |
| **Milestone** | M3 |
| **Area** | `area:tooling` |
| **Blocked by** | — |
| **Unlocks** | (enables persistent Codex loop) |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

- [ ] `docs/templates/issue-template.md` — canonical issue template with all required fields (per §3.2 of QUEUE_ORCHESTRATION_DESIGN.md)
- [ ] `.github/ISSUE_TEMPLATE/unit-talk-issue.md` — GitHub issue template version
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` — PR template with all required sections (per §7)
- [ ] `scripts/queue-status.mjs` — read-only queue reporter; parses `ISSUE_QUEUE.md`; prints: READY/IN_PROGRESS/IN_REVIEW by lane; exits 0
- [ ] `scripts/claim-issue.mjs` — validates issue READY + deps DONE; updates queue status + branch field; creates git branch; prints branch name
- [ ] `scripts/submit-issue.mjs` — updates queue status → IN_REVIEW; records PR number; prints next READY issue in lane
- [ ] All scripts: Node ESM, no external deps, same parse pattern as `scripts/generate-types.mjs`
- [ ] `pnpm verify` exits 0; test count non-decreasing

#### Implementation Authority

`docs/05_operations/QUEUE_ORCHESTRATION_DESIGN.md` §13–14

---

### [UTV2-37] T3 Augment — SGO Results Live Proof Seed

| Field | Value |
|---|---|
| **ID** | UTV2-37 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **READY** |
| **Milestone** | M4 |
| **Area** | `area:tooling` |
| **Blocked by** | — |
| **Unlocks** | — (UTV2-28 already DONE; this issue produces a standalone proof doc) |
| **Branch** | — |
| **PR** | — |

#### Acceptance Criteria

- [ ] `scripts/seed-game-result.ts` reviewed: type-check passes (already confirmed); verify `pnpm exec tsx scripts/seed-game-result.ts --help` prints usage cleanly
- [ ] Run seed script with a known NBA event from the live DB: pick any `events.external_id` from Supabase; use `--actual-value 25 --market-key points-all-game-ou`
- [ ] Confirm `game_results` row inserted (once migration 012 is applied by Codex on UTV2-28)
- [ ] Document the exact command used and row ID in a brief proof note at `docs/06_status/grading_seed_proof.md`
- [ ] If migration 012 is not yet applied: document the dependency and wait; this issue stays IN_PROGRESS until migration is available

#### Notes

This issue is the proof support issue for UTV2-28. Augment can work on it in parallel, preparing the seed command; the actual DB insert waits on migration 012.

---

## Queue State Reference

```
UTV2-28  T1  codex     DONE         ← CLOSED: live proof WIN. Migration 012+013 applied.
UTV2-29  DOC claude    DONE         ← CLOSED: MLB ratification complete; contract RATIFIED
UTV2-30  T2  codex     READY        ← READY: both blockers (UTV2-28, UTV2-29) DONE
UTV2-31  T2  codex     READY        ← READY: both blockers (UTV2-28, UTV2-32) DONE
UTV2-32  DOC claude    DONE         ← CLOSED: /stats contract RATIFIED
UTV2-33  T2  codex     READY        ← READY: UTV2-35 contract DONE
UTV2-34  T3  augment   IN_REVIEW    ← Augment: deploy-commands blocked (3 missing env vars)
UTV2-35  DOC claude    DONE         ← CLOSED: market key normalization contract RATIFIED
UTV2-36  T3  codex     READY        ← Codex: queue tooling — FIRST PERSISTENT LOOP CANDIDATE
UTV2-37  T3  augment   READY        ← Augment: seed proof support
```

---

## Promotion Rules

When an issue moves to `DONE`:

1. Update the issue's Status field in this file to `DONE`
2. Scan `Unlocks` field — check each listed issue; if all their `Blocked by` items are now `DONE`, promote them to `READY`
3. Update `docs/06_status/PROGRAM_STATUS.md` sprint log
4. Update Queue Health table at the top of this file

---

## References

- `docs/05_operations/QUEUE_ORCHESTRATION_DESIGN.md` — system rules
- `docs/06_status/PROGRAM_STATUS.md` — canonical status authority
- `docs/05_operations/SPRINT_MODEL_v2.md` — tier requirements
- `CLAUDE.md` — session start checklist
