# Unit Talk V2 — Issue Queue

> **Queue is source of truth for state.** Linear mirrors it. Git branches are named `{lane}/{LINEAR_ID}-{slug}`.
> One issue = one branch = one PR. No stacking.

## Queue Health

| Lane | IN_PROGRESS | IN_REVIEW | READY | BLOCKED | DONE |
|---|---|---|---|---|---|
| `lane:codex` | 0 | 0 | 0 | 0 | 11 |
| `lane:claude` | 0 | 0 | 1 | 0 | 6 |
| `lane:augment` | 0 | 1 | 1 | 0 | 4 |

---

## Active Issues

---

### UTV2-49 — T2 Smart Form Confidence Field

| Field | Value |
|---|---|
| **ID** | UTV2-49 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M8 |
| **Area** | `area:smart-form` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-49-smart-form-confidence-field` |
| **PR** | #25 — **MERGED** ✅ (2026-03-27) |

#### Scope

`buildSubmissionPayload()` omits the top-level `confidence` field (0–1 float). Domain analysis uses `pick.confidence` for edge computation. Without it, all Smart Form picks score ~61.5 composite — below best-bets threshold of 70. No Smart Form pick has ever reached `discord:best-bets`.

Fix: add `confidence?: number` to `SubmitPickPayload` in `api-client.ts`; add `confidence: values.capperConviction / 10` to `buildSubmissionPayload()` in `form-utils.ts`.

#### Acceptance Criteria

- [ ] AC-1: `SubmitPickPayload.confidence?: number` added to `api-client.ts`
- [ ] AC-2: `buildSubmissionPayload()` sets `confidence = capperConviction / 10`
- [ ] AC-3: conviction=1 → 0.1; conviction=8 → 0.8; conviction=10 → 1.0
- [ ] AC-4: `metadata.promotionScores.trust` unchanged (`capperConviction * 10`)
- [ ] AC-5: `pnpm verify` exits 0; test count ≥ 624
- [ ] AC-6: `tsx --test apps/smart-form/test/form-utils.test.ts` exits 0

#### Contract Authority

`docs/05_operations/T2_SMART_FORM_CONFIDENCE_CONTRACT.md` (status: RATIFIED)

---

### UTV2-48 — T1 CLV Wiring Live Proof

| Field | Value |
|---|---|
| **ID** | UTV2-48 |
| **Tier** | T1 (verify) |
| **Lane** | `lane:claude` |
| **Status** | **READY** |
| **Milestone** | M8 |
| **Area** | `area:api` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

#### Scope

UTV2-46 (merged 2026-03-27) wired `computeAndAttachCLV()` into `recordGradedSettlement()`. All 3 existing settlements predate the merge — no live proof exists. Trigger a grading run against a posted pick with a matching `provider_offers` row. Verify `settlement_records.payload` contains top-level `clvRaw`, `clvPercent`, `beatsClosingLine` keys.

#### Acceptance Criteria

- [ ] AC-1: Submit and post a pick with finite odds and a selection containing "over" or "under"
- [ ] AC-2: Confirm participant has a matching `provider_offers` row
- [ ] AC-3: Run `POST /api/grading/run` — confirm pick is graded
- [ ] AC-4: Query resulting `settlement_records.payload` — confirm `clvRaw`, `clvPercent`, `beatsClosingLine` as top-level keys
- [ ] AC-5: If no matching offer: confirm payload omits CLV keys (not null); document which path fired

#### Contract Authority

`docs/05_operations/T2_SMART_FORM_CONFIDENCE_CONTRACT.md §8`

---

### UTV2-51 — T3 Operator Web CLV Settlement Display

| Field | Value |
|---|---|
| **ID** | UTV2-51 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **READY** |
| **Milestone** | M8 |
| **Area** | `area:operator-web` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

#### Scope

UTV2-46 wired CLV data into `settlement_records.payload` as top-level keys (`clvRaw`, `clvPercent`, `beatsClosingLine`). The operator HTML dashboard settlement table does not display these fields. Add `CLV%` and `Beats Line` columns to the `recentSettlements` table in the operator HTML response. Display `—` when keys are absent. Read-only display change only — no new routes, no DB queries, no write surfaces.

#### Acceptance Criteria

- [ ] AC-1: `recentSettlements` HTML table gains `CLV%` and `Beats Line` columns
- [ ] AC-2: When `clvPercent` present: display as `3.2%` (one decimal). When absent: `—`
- [ ] AC-3: When `beatsClosingLine` present: display as `✓` (true) or `✗` (false). When absent: `—`
- [ ] AC-4: `pnpm verify` exits 0; test count does not decrease
- [ ] AC-5: At least 1 new test covering the CLV column rendering path

#### Constraints

- Only modify `apps/operator-web/src/server.ts` and `server.test.ts`
- Do not add new routes or DB queries
- Do not touch `apps/smart-form/**` (active Codex scope — UTV2-49 in review)
- Parallel-safe: no overlap with UTV2-49 or UTV2-48

---

### UTV2-47 — T3 Discord APPLICATION_ID Fix

| Field | Value |
|---|---|
| **ID** | UTV2-47 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **IN_REVIEW** |
| **Milestone** | M8 |
| **Area** | `area:discord-bot` |
| **Blocked by** | — |
| **Branch** | `augment/UTV2-47-discord-application-id` |
| **PR** | #23 |

#### Scope

`deploy-commands` fails with `DiscordAPIError[20012]`. The `DISCORD_CLIENT_ID=1045344984280346674` in `local.env` does not match the application that owns the bot token. The script and the bot token are both correct — the credential value is wrong.

#### Acceptance Criteria

- [ ] AC-1: Identify the correct APPLICATION_ID from the Discord Developer Portal (Applications → the application owning the bot token → copy Application ID)
- [ ] AC-2: Update `DISCORD_CLIENT_ID` in `local.env` to the correct value
- [ ] AC-3: Run `pnpm --filter @unit-talk/discord-bot deploy-commands` — confirm exit 0, no `DiscordAPIError[20012]`
- [ ] AC-4: If `.env.example` `DISCORD_CLIENT_ID` comment or placeholder is incorrect, update it to reflect the correct application

#### Constraints

- `local.env` is gitignored — the credential fix is local only; nothing sensitive lands in git
- Do not touch runtime code (`apps/discord-bot/src/**`)
- Do not modify the deploy-commands script
- Only permitted git-tracked change: `.env.example` comment update if needed

#### Proof

- [ ] `deploy-commands` stdout confirms command registration with no `DiscordAPIError[20012]`

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
| **Status** | **DONE** |
| **Milestone** | M7 |
| **Area** | `area:discord-bot` `area:operator-web` |
| **Branch** | `codex/UTV2-44-discord-leaderboard` |
| **PR** | #21 — **MERGED** ✅ (2026-03-27) |

#### Review Verdict (2026-03-27) — APPROVED ✅

All 10 ACs satisfied. 617/617 tests (606 baseline → +11 net-new; contract requires ≥8).

- SOFT BLOCK issued: router used `deferReply({ ephemeral: true })` globally
- Fix applied: `CommandHandler.responseVisibility?: 'private' | 'public'`; router fails closed; leaderboard opts in with `'public'`
- Verified: router test confirms `deferReply({ ephemeral: false })` for leaderboard; all other commands unchanged
- `pnpm verify` exit 0 on clean main after merge

---

### UTV2-45 — T3 Smart Form Participant Autocomplete

| Field | Value |
|---|---|
| **ID** | UTV2-45 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **DONE** |
| **Milestone** | M7 |
| **Area** | `area:smart-form` |
| **Blocked by** | — |
| **Branch** | committed to `main` (2026-03-27) |
| **PR** | — |

#### Delivered

- `ParticipantAutocompleteField` in `BetForm.tsx` — debounced 250ms typeahead for playerName and team fields
- Fires when input ≥2 chars; AbortController per keystroke; shows loading/error/empty/suggestion states
- Helpers extracted to `lib/participant-search.ts` (pure, no UI deps — testable)
- 4 new unit tests in `test/api-client.test.ts` (12 total); smart-form local tests pass

---

### UTV2-50 — T3 Discord /help Command

| Field | Value |
|---|---|
| **ID** | UTV2-50 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **DONE** |
| **Milestone** | M8 |
| **Area** | `area:discord-bot` |
| **Branch** | `augment/UTV2-50-discord-help` |
| **PR** | — (committed to `main` 2026-03-27) |

#### Delivered

- `createHelpCommand()` + `createDefaultCommand()` in `apps/discord-bot/src/commands/help.ts`
- Ephemeral embed listing /pick, /stats, /leaderboard, /help with descriptions
- Auto-discovered by `loadCommandRegistry()` — no wiring changes required
- 3 new tests (ok 156–158); 624/624 total; `pnpm type-check` exit 0

---

### UTV2-46 — T2 CLV Settlement Wiring

| Field | Value |
|---|---|
| **ID** | UTV2-46 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M7 |
| **Area** | `area:api` |
| **Branch** | `codex/UTV2-46-clv-settlement-wiring` |
| **PR** | #22 — **MERGED** ✅ (2026-03-27) |

#### Delivered

- `resolveClvPayload()` removed; `computeAndAttachCLV()` called in `recordGradedSettlement()`
- `payload.clvRaw`, `payload.clvPercent`, `payload.beatsClosingLine` written as top-level keys
- Keys omitted (not null) when no matching `provider_offers` row
- 4 new tests in `grading-service.test.ts`; 621/621 total; 0 failures
- `avgClvPct` in `/stats` and `/leaderboard` will now populate for picks with closing lines

---

