# UTV2-61 — T3 Recap CLV and Stake Enrichment

**Status:** RATIFIED
**Lane:** `lane:codex` (T3 implementation)
**Tier:** T3
**Milestone:** M11
**Ratified:** 2026-03-27
**Authority:** Claude lane — M11 contract authoring session 2026-03-27

---

## Problem

`/recap` embeds show `CLV%: —` and `Stake: —` for every pick. The data already exists:
- `clvPercent` is written to `settlement_records.payload` at settlement time (UTV2-46)
- `stake_units` is on the `picks` row

Both are read elsewhere in `operator-web/src/server.ts` (leaderboard, stats) but not included in `CapperRecapPick`.

---

## Scope

Wire `clvPercent` and `stakeUnits` through the recap response chain so they populate in the `/recap` Discord embed.

**No schema changes. No new routes. No behavioral changes.**

---

## Permitted Files

- `apps/operator-web/src/server.ts` — add fields to `CapperRecapPick` interface and populate in `buildCapperRecapResponse()`
- `apps/operator-web/src/server.test.ts` — update/add tests
- `apps/discord-bot/src/commands/recap.ts` — pass `clvPercent` and `stakeUnits` through to `buildRecapField()`
- `apps/discord-bot/src/discord-bot-foundation.test.ts` — update/add tests

**Do NOT touch:** `apps/api`, `apps/worker`, `apps/ingestor`, `apps/smart-form`, `packages/*`

---

## Acceptance Criteria

- [ ] AC-1: `CapperRecapPick` has `clvPercent: number | null` and `stakeUnits: number | null`
- [ ] AC-2: `buildCapperRecapResponse()` populates `clvPercent` from `settlementRecord.payload.clvPercent` (null if absent/non-finite)
- [ ] AC-3: `buildCapperRecapResponse()` populates `stakeUnits` from `pick.stake_units` (null if absent/non-finite)
- [ ] AC-4: `/recap` Discord embed shows CLV% and Stake as populated values when present (not `—`)
- [ ] AC-5: `pnpm verify` exits 0; test count >= baseline + 2

---

## Constraints

- Fail-safe: if `clvPercent` or `stakeUnits` cannot be read, field must be `null` — never throw
- Do not add `clvPercent` or `stakeUnits` to the Discord embed title or pick field name — values only
- `stakeUnits` from `picks.stake_units` may be `null` in DB — handle gracefully
