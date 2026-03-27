# Unit Talk V2 — Issue Queue

> **Queue is source of truth for state.** Linear mirrors it. Git branches are named `{lane}/{LINEAR_ID}-{slug}`.
> One issue = one branch = one PR. No stacking.

## Queue Health

| Lane | IN_PROGRESS | IN_REVIEW | READY | BLOCKED | DONE |
|---|---|---|---|---|---|
| `lane:codex` | 0 | 0 | 0 | 0 | 21 |
| `lane:claude` | 0 | 0 | 0 | 0 | 11 |
| `lane:augment` | 0 | 0 | 0 | 0 | 11 |

---

## Active Issues

---

### UTV2-65 — T1 M10 Closure Verification

| Field | Value |
|---|---|
| **ID** | UTV2-65 |
| **Tier** | T1 (verify) |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M11 |
| **Area** | `area:docs` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

Independent verification of M10 deliverables. Produce proof artifact. Update `PROGRAM_STATUS.md` M10 CLOSED, M11 placeholder. Contract: `docs/05_operations/UTV2-65_M10_CLOSURE_VERIFICATION_CONTRACT.md`. Proof: `docs/06_status/UTV2-65_proof.md`.

---

### UTV2-67 — T2 Kelly Sizing at Submission

| Field | Value |
|---|---|
| **ID** | UTV2-67 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M11 |
| **Area** | `area:api` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-67-kelly-submission-wiring` |
| **PR** | [#40](https://github.com/griff843/Unit-Talk-v2/pull/40) — **MERGED** ✅ (2026-03-27) |

Fix `findLatestMatchingOffer` sort order (snapshot_at DESC). Wire `computeKellySize(overFair, americanToDecimal(odds), DEFAULT_BANKROLL_CONFIG)` after devig result — writes to `pick.metadata.kellySizing`. Fail-closed. Operator-visible only. Contract: `docs/05_operations/UTV2-67_KELLY_SUBMISSION_WIRING_CONTRACT.md`

---

### UTV2-66 — T2 Discord Bot Startup Entry Point

| Field | Value |
|---|---|
| **ID** | UTV2-66 |
| **Tier** | T2 |
| **Lane** | `lane:augment` |
| **Status** | **DONE** |
| **Milestone** | M11 |
| **Area** | `area:discord-bot` |
| **Blocked by** | — |
| **Branch** | `augment/UTV2-66-bot-startup` |
| **PR** | [#38](https://github.com/griff843/Unit-Talk-v2/pull/38) — **MERGED** ✅ (2026-03-27) |

Create `apps/discord-bot/src/main.ts` — wires `createDiscordClient`, `loadCommandRegistry`, `createInteractionHandler`, `client.login`. Update `dev` script. Contract: `docs/05_operations/UTV2-66_BOT_STARTUP_CONTRACT.md`

---

### UTV2-64 — T2 DeviggingService Submission Wiring

| Field | Value |
|---|---|
| **ID** | UTV2-64 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M11 |
| **Area** | `area:api` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-64-devig-submission-wiring` |
| **PR** | [#36](https://github.com/griff843/Unit-Talk-v2/pull/36) — **MERGED** ✅ (2026-03-27) |

At submission time, look up `provider_offers` for the pick's market key, call `devig()` from `@unit-talk/domain`, write result to `pick.metadata.deviggingResult`. Fail-closed. Contract: `docs/05_operations/UTV2-64_DEVIG_SUBMISSION_WIRING_CONTRACT.md`

---

### UTV2-63 — T3 Dead-Letter Operator Surface

| Field | Value |
|---|---|
| **ID** | UTV2-63 |
| **Tier** | T3 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M11 |
| **Area** | `area:operator-web` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-63-dead-letter-surface` |
| **PR** | [#39](https://github.com/griff843/Unit-Talk-v2/pull/39) — **MERGED** ✅ (2026-03-27) |

Add `deadLetterOutbox` to `OperatorSnapshot.counts`, distribution health degrades on dead-letter rows, HTML dashboard card rendered. Contract: `docs/05_operations/UTV2-63_DEAD_LETTER_OPERATOR_SURFACE_CONTRACT.md`

---

### UTV2-62 — T2 Dead-Letter Promotion for Failed Outbox Rows

| Field | Value |
|---|---|
| **ID** | UTV2-62 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M11 |
| **Area** | `area:worker` `area:db` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-62-dead-letter-promotion` |
| **PR** | [#35](https://github.com/griff843/Unit-Talk-v2/pull/35) — **MERGED** ✅ (2026-03-27) |

Add `markDeadLetter()` to `OutboxRepository`. Worker promotes to `dead_letter` after 3 consecutive failures. Contract: `docs/05_operations/UTV2-62_DEAD_LETTER_PROMOTION_CONTRACT.md`

---

### UTV2-61 — T3 Recap CLV and Stake Enrichment

| Field | Value |
|---|---|
| **ID** | UTV2-61 |
| **Tier** | T3 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M11 |
| **Area** | `area:operator-web` `area:discord-bot` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-61-recap-clv-enrichment` |
| **PR** | [#37](https://github.com/griff843/Unit-Talk-v2/pull/37) — **MERGED** ✅ (2026-03-27) |

Add `clvPercent` and `stakeUnits` to `CapperRecapPick`; populate from existing settlement payload and picks row; surface in `/recap` embed. Contract: `docs/05_operations/UTV2-61_RECAP_CLV_ENRICHMENT_CONTRACT.md`

---

### UTV2-60 — T1 Worker Delivery Proof (AC-3/AC-4 from UTV2-56) — T1 Worker Delivery Proof (AC-3/AC-4 from UTV2-56)

| Field | Value |
|---|---|
| **ID** | UTV2-60 |
| **Tier** | T1 (verify) |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M10 |
| **Area** | `area:worker` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

**Absorbed into UTV2-56 proof (2026-03-27).** AC-3 and AC-4 confirmed in the same worker run session. See `docs/06_status/UTV2-56_proof.md`.

---

### UTV2-59 — T3 /pick Guild Deployment Verification

| Field | Value |
|---|---|
| **ID** | UTV2-59 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **DONE** |
| **Milestone** | M10 |
| **Area** | `area:discord-bot` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

#### Scope

UTV2-53 added the `/pick` command to the codebase but `deploy-commands` has not been re-run to register it with the Discord guild. Verify the command is live in the guild. No runtime code changes — ops verification task only.

#### Acceptance Criteria

- [ ] AC-1: `pnpm --filter @unit-talk/discord-bot deploy-commands` exits 0
- [ ] AC-2: No `DiscordAPIError[20012]` or similar
- [ ] AC-3: `/pick` command visible in Discord guild slash command list (screenshot or bot response confirms)
- [ ] AC-4: `/stats`, `/leaderboard`, `/help` also confirmed still registered

#### Constraints

- No changes to any `src/` files
- Only permitted git-tracked change: `.env.example` comment update if needed

#### Contract Authority

`docs/05_operations/UTV2-59_PICK_GUILD_DEPLOY_CONTRACT.md` (status: RATIFIED)

---

### UTV2-58 — T2 Discord /recap Slash Command (Capper Self-Service)

| Field | Value |
|---|---|
| **ID** | UTV2-58 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M10 |
| **Area** | `area:discord-bot` `area:operator-web` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-58-recap-command` |
| **PR** | [#33](https://github.com/griff843/Unit-Talk-v2/pull/33) — **MERGED** ✅ (2026-03-27) |

#### Scope

Add a `/recap` slash command to the Discord bot. Capper runs `/recap [limit]` to see their last N settled picks (default 10, max 20) with results. Calls `GET /api/operator/capper-recap?submittedBy=X&limit=N`. Response is ephemeral.

#### Acceptance Criteria

- [ ] AC-1: `/recap` command registered with optional `limit` option (default 10, max 20)
- [ ] AC-2: Returns ephemeral embed with capper's last N settled picks (market, selection, result, P&L)
- [ ] AC-3: Returns ephemeral `"No settled picks found."` when capper has no settled picks
- [ ] AC-4: `submittedBy` resolved from Discord interaction user (displayName preferred, username fallback)
- [ ] AC-5: `pnpm verify` exits 0; test count >= baseline + 2
- [ ] AC-6: At least 2 new tests: success with results, empty state

#### Constraints

- Response must be ephemeral (`responseVisibility: 'private'`)
- Permitted files: `apps/discord-bot/src/commands/recap.ts` (new), `apps/discord-bot/src/discord-bot-foundation.test.ts`, `apps/api/src/server.ts` (new route), `apps/api/src/server.test.ts`
- Do NOT touch: `apps/operator-web`, `apps/smart-form`, `apps/ingestor`, `apps/worker`

#### Contract Authority

`docs/05_operations/UTV2-58_RECAP_COMMAND_CONTRACT.md` (status: RATIFIED)

---

### UTV2-57 — T2 Settlement-Triggered Discord Recap Embed

| Field | Value |
|---|---|
| **ID** | UTV2-57 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M10 |
| **Area** | `area:api` `area:discord-bot` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-57-kickoff` |
| **PR** | [#31](https://github.com/griff843/Unit-Talk-v2/pull/31) — **MERGED** ✅ (2026-03-27) |

#### Scope

After a pick is settled (grading run writes to `settlement_records`), automatically post a recap embed to the same Discord channel the pick was originally delivered to. Event-driven — triggered at the end of `runGradingPass()` in `grading-service.ts`.

#### Acceptance Criteria

- [ ] AC-1: After grading run, each newly settled pick triggers a Discord embed post to the pick's original delivery channel
- [ ] AC-2: Embed shows: market, selection, result (Win/Loss/Push), profit/loss units, CLV% (or `—` if absent), capper username
- [ ] AC-3: If pick has no delivery receipt/target: skip silently, log reason, do not throw
- [ ] AC-4: `pnpm verify` exits 0; test count >= baseline + 2
- [ ] AC-5: At least 2 new tests: embed built correctly for win with CLV, embed skipped when no receipt

#### Constraints

- Do not change `settlement_records` schema
- Permitted files: `apps/api/src/grading-service.ts`, `apps/api/src/server.ts` (if new route needed), new `apps/discord-bot/src/embeds/recap-embed.ts`, `apps/api/src/server.test.ts` or `apps/api/src/grading-service.test.ts`
- Do NOT touch: `apps/worker`, `apps/operator-web`, `apps/smart-form`, `apps/ingestor`

#### Contract Authority

`docs/05_operations/UTV2-57_SETTLEMENT_RECAP_CONTRACT.md` (status: RATIFIED)

---

### UTV2-56 — T1 M9 Closure Verification

| Field | Value |
|---|---|
| **ID** | UTV2-56 |
| **Tier** | T1 (verify) |
| **Lane** | `lane:claude` |
| **Status** | **DONE** |
| **Milestone** | M9 |
| **Area** | `area:api` `area:worker` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

#### Scope

Independent verification of M9 deliverables: requeue endpoint (UTV2-55), worker guard, orphan recovery, and UTV2-53/54 delivery confirmation. Closes M9.

#### Acceptance Criteria

- [ ] AC-1: All 6 orphaned picks have `distribution_outbox` rows — confirm via live DB query (pick IDs: `d77a35b3`, `3b5d9e84`, `306deff8`, `d00954ec`, `4701f767`, `3ec17a5e`)
- [ ] AC-2: `POST /api/picks/:id/requeue` returns 409 `ALREADY_QUEUED` on second call for any of the 6 (idempotency confirmed)
- [ ] AC-3: Stale outbox entry for settled pick `2783c8e2` — confirm worker guard fires: outbox row marked sent, `distribution.skipped` audit entry exists, no Discord delivery attempted
- [ ] AC-4: Worker processes at least one of the 6 requeued picks — confirm `distribution_receipts` row exists and pick `status` transitions to `queued` or `posted`
- [ ] AC-5: `pnpm verify` exits 0 on current main
- [ ] AC-6: `PROGRAM_STATUS.md` updated — M9 CLOSED, M10 placeholder added

#### Constraints

- Do not change any runtime code — verification only
- If AC-3 cannot be confirmed (worker not running), document as deferred with reason
- If AC-4 cannot be confirmed (worker not running), document as deferred with reason

---

### UTV2-53 — T2 Discord /pick Submission Command

| Field | Value |
|---|---|
| **ID** | UTV2-53 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M9 |
| **Area** | `area:discord-bot` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-53-discord-pick-command` |
| **PR** | [#29](https://github.com/griff843/Unit-Talk-v2/pull/29) — **MERGED** ✅ (2026-03-27) |

#### Scope

Add a `/pick` slash command to the Discord bot that allows a capper to submit a pick directly from Discord. The command calls `POST /api/submissions` via the existing `ApiClient` and returns an ephemeral confirmation embed with the submission ID and pick ID.

Fields (all required unless noted):
- `market` — string (e.g. "NBA - Player Prop")
- `selection` — string (e.g. "Jalen Brunson Points O 24.5")
- `odds` — integer (American odds, e.g. -110)
- `stake_units` — number (e.g. 1.5)
- `event_name` — string (optional)

Source is hardcoded to `'discord-bot'`. `submittedBy` is the Discord username of the interaction user.

#### Acceptance Criteria

- [ ] AC-1: `/pick` slash command registered in `CommandHandler` with 4 required + 1 optional option
- [ ] AC-2: Command calls `POST /api/submissions` with correct payload; source=`'discord-bot'`
- [ ] AC-3: On success: ephemeral embed shows submission ID, pick ID, market, selection
- [ ] AC-4: On API error: ephemeral error message shown; command does not throw
- [ ] AC-5: `pnpm verify` exits 0; test count ≥ 645 + 1
- [ ] AC-6: At least 2 new tests (success path + error path)

#### Constraints

- `responseVisibility` must be `'private'` (ephemeral) — submission confirmation is capper-only
- Do not add a new route to `apps/api` — use existing `POST /api/submissions`
- Do not touch `apps/smart-form`, `apps/operator-web`, `apps/api/src`
- `ApiClient` in `apps/discord-bot` must call the API, not import from `apps/api` directly

---

### UTV2-55 — T2 Qualified Pick Re-queue Endpoint

| Field | Value |
|---|---|
| **ID** | UTV2-55 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M9 |
| **Area** | `area:api` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-55-requeue-endpoint` |
| **PR** | [#30](https://github.com/griff843/Unit-Talk-v2/pull/30) — **MERGED** ✅ (2026-03-27) |

#### Scope

6 qualified picks are orphaned in `validated` status with no `distribution_outbox` row — the submit controller catches enqueue failures silently. Add `POST /api/picks/:id/requeue` to recover them. Also add a worker guard to skip delivery for already-settled picks (stale outbox entry exists for pick `2783c8e2`).

#### Acceptance Criteria

- [ ] AC-1: `POST /api/picks/:id/requeue` route registered on API server
- [ ] AC-2: Returns 422 if `promotion_status !== 'qualified'`
- [ ] AC-3: Returns 409 if outbox row already exists (pending or sent)
- [ ] AC-4: Returns 409 if pick is `settled` or `voided`
- [ ] AC-5: On success: enqueues to `distribution_outbox`, returns 200 `{ outboxId, target, pickId }`
- [ ] AC-6: Worker skips delivery for settled/voided picks; logs reason; outbox row marked complete
- [ ] AC-7: `pnpm verify` exits 0; test count ≥ current baseline + 3
- [ ] AC-8: At least 3 new tests: success, 422 (not qualified), 409 (already queued)

#### Constraints

- Do not change `submit-pick-controller.ts` error handling
- Do not change `enqueueDistributionWithRunTracking` signature
- Permitted files: `apps/api/src/server.ts`, new `apps/api/src/controllers/requeue-controller.ts`, test file, `apps/worker/src/distribution-worker.ts`
- Do not touch `apps/ingestor`, `apps/operator-web`, `apps/smart-form`

#### Contract Authority

`docs/05_operations/UTV2-55_REQUEUE_CONTRACT.md` (status: RATIFIED)

---

### UTV2-54 — T3 Operator Web Ingestor Health Card

| Field | Value |
|---|---|
| **ID** | UTV2-54 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **DONE** |
| **Milestone** | M9 |
| **Area** | `area:operator-web` |
| **Blocked by** | — |
| **Branch** | `augment/UTV2-54-ingestor-health-card` |
| **PR** | #28 — closed (implementation cherry-picked to main as `a0f50f4`, 2026-03-27) |

#### Scope

The operator HTML dashboard shows health cards for worker, best-bets channel, and trader-insights channel. Add an **Ingestor** health card showing last run status. Read from `system_runs` where `run_type = 'ingestor'`. Display: status (most recent run), last run time, leagues configured. Display `—` when no rows exist (ingestor has not yet run). Read-only — no new write surfaces, no new routes (extend existing snapshot query).

#### Acceptance Criteria

- [ ] AC-1: `createSnapshotFromRows()` includes `ingestorHealth: { status, lastRunAt, runCount }` derived from `system_runs` rows
- [ ] AC-2: HTML dashboard renders an "Ingestor" card with status and last run time
- [ ] AC-3: When no `system_runs` rows with `run_type='ingestor'`: card shows `status: 'unknown'` and last run `—`
- [ ] AC-4: `pnpm verify` exits 0; test count does not decrease
- [ ] AC-5: At least 2 new tests (with runs / without runs)

#### Constraints

- Only modify `apps/operator-web/src/server.ts` and `server.test.ts`
- Extend `GET /api/operator/snapshot` — do not add new routes
- Parallel-safe: no overlap with UTV2-53 (discord-bot)

---

### UTV2-52 — T2 Ingestor App Monorepo Integration

| Field | Value |
|---|---|
| **ID** | UTV2-52 |
| **Tier** | T2 |
| **Lane** | `lane:codex` |
| **Status** | **DONE** |
| **Milestone** | M8 |
| **Area** | `area:ingestor` |
| **Blocked by** | — |
| **Branch** | `codex/UTV2-52-ingestor-integration` |
| **PR** | #27 — **MERGED** ✅ (2026-03-27) |

#### Scope

`apps/ingestor/` exists on disk with 21 passing tests but is untracked. It is a fully implemented SGO data ingestor with proper `tsconfig.json` (composite) and `package.json`. It is not in root `tsconfig.json` references and not committed. `packages/contracts/src/provider-offers.ts` is also untracked and may be required for the build.

Wire the ingestor into the monorepo build without changing any implementation logic.

#### Acceptance Criteria

- [ ] AC-1: `apps/ingestor/` committed to repo (all source files tracked)
- [ ] AC-2: `{ "path": "./apps/ingestor" }` added to root `tsconfig.json` references
- [ ] AC-3: `pnpm type-check` exits 0
- [ ] AC-4: `pnpm build` exits 0
- [ ] AC-5: `tsx --test apps/ingestor/src/ingestor.test.ts` → 21 tests, 0 failures
- [ ] AC-6: `pnpm verify` exits 0; total test count = prior baseline + 21

#### Constraints

- Do not change ingestor implementation logic
- Do not add migrations
- Do not touch `apps/api`, `apps/worker`, `apps/smart-form`, `apps/operator-web`, `apps/discord-bot`
- If `packages/db` exports (`createDatabaseIngestorRepositoryBundle`, `createInMemoryIngestorRepositoryBundle`) are missing, add them — do not change existing exports

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
| **Status** | **DONE** |
| **Milestone** | M8 |
| **Area** | `area:api` |
| **Blocked by** | — |
| **Branch** | — |
| **PR** | — |

#### Scope

UTV2-46 (merged 2026-03-27) wired `computeAndAttachCLV()` into `recordGradedSettlement()`. All 3 existing settlements predate the merge — no live proof exists. Trigger a grading run against a posted pick with a matching `provider_offers` row. Verify `settlement_records.payload` contains top-level `clvRaw`, `clvPercent`, `beatsClosingLine` keys.

#### Acceptance Criteria

- [x] AC-1: Submit and post a pick with finite odds and a selection containing "over" or "under"
- [x] AC-2: Confirm participant has a matching `provider_offers` row
- [x] AC-3: Run grading pass — pick `3f8e9119` graded: `win`
- [x] AC-4: Settlement `5d6a6dcd` payload: `clvRaw=0.03774`, `clvPercent=3.774`, `beatsClosingLine=true` — all three top-level keys confirmed
- [x] AC-5: Pre-merge settlements omit `clvRaw` key entirely (not null) — omit path confirmed

#### Proof

- Participant: Jalen Brunson (`JALEN_BRUNSON_1_NBA`)
- Event: New York Knicks vs. Charlotte Hornets (2026-03-26)
- Market: `assists-all-game-ou` line=6.5
- Pick: Over 6.5 @-139 | Actual: 8 assists → **win**
- Closing line (SGO): over=-139 / under=+105 | snapshot_at=2026-03-26T20:22:19
- CLV: `clvRaw=0.03774` (3.774%) — pick beats fair closing line ✓
- Settlement ID: `5d6a6dcd-653d-4ba0-8795-bd08c6f4fd38`
- Pick ID: `3f8e9119-5a7a-40dd-abae-360a33348920`
- Proof scripts: `scripts/clv-proof.ts`, `scripts/clv-grade.ts`

#### Contract Authority

`docs/05_operations/T2_SMART_FORM_CONFIDENCE_CONTRACT.md §8`

---

### UTV2-51 — T3 Operator Web CLV Settlement Display

| Field | Value |
|---|---|
| **ID** | UTV2-51 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **DONE** |
| **Milestone** | M8 |
| **Area** | `area:operator-web` |
| **Blocked by** | — |
| **Branch** | `augment/UTV2-51-operator-clv-display` |
| **PR** | #26 — **MERGED** ✅ (2026-03-27) |

#### Scope

UTV2-46 wired CLV data into `settlement_records.payload` as top-level keys (`clvRaw`, `clvPercent`, `beatsClosingLine`). The operator HTML settlement table does not display these. Add `CLV%` and `Beats Line` columns. Display `—` when absent. Read-only display change — no new routes, no DB queries, no write surfaces.

#### Acceptance Criteria

- [ ] AC-1: `recentSettlements` HTML table gains `CLV%` and `Beats Line` columns
- [ ] AC-2: `clvPercent` present → display as `3.2%` (one decimal); absent → `—`
- [ ] AC-3: `beatsClosingLine` present → `✓` (true) or `✗` (false); absent → `—`
- [ ] AC-4: `pnpm verify` exits 0; test count does not decrease
- [ ] AC-5: At least 1 new test covering the CLV column rendering path

#### Constraints

- Only modify `apps/operator-web/src/server.ts` and `server.test.ts`
- Do not add new routes or DB queries
- Do not touch `apps/smart-form/**`
- Parallel-safe: no overlap with UTV2-48 or any active Codex scope

---

### UTV2-47 — T3 Discord APPLICATION_ID Fix

| Field | Value |
|---|---|
| **ID** | UTV2-47 |
| **Tier** | T3 |
| **Lane** | `lane:augment` |
| **Status** | **DONE** |
| **Milestone** | M8 |
| **Area** | `area:discord-bot` |
| **Blocked by** | — |
| **Branch** | `augment/UTV2-47-discord-application-id` |
| **PR** | #23 — **MERGED** ✅ (2026-03-27) |

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
| **Branch** | `augment/UTV2-50-discord-help-rebase` |
| **PR** | [#32](https://github.com/griff843/Unit-Talk-v2/pull/32) — **MERGED** ✅ (2026-03-27) |

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

