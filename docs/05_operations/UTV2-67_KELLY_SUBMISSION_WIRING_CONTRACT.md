# UTV2-67 — T2 Kelly Sizing at Submission

**Status:** RATIFIED
**Lane:** `lane:codex` (T2 implementation)
**Tier:** T2
**Milestone:** M11
**Ratified:** 2026-03-27
**Authority:** Claude lane — M11 contract authoring session 2026-03-27
**Blocked by:** UTV2-64 (DONE — devig result now written to metadata)

---

## Problem

`packages/domain/src/risk/kelly-sizer.ts` is implemented and tested. After UTV2-64 merged, `pick.metadata.deviggingResult` contains the fair probability needed for Kelly sizing. The sizing is never called at submission time.

Additionally, `findLatestMatchingOffer()` in `submission-service.ts` uses `Array.find()` which returns the first matching offer, not the latest by `snapshot_at`. This is a latent correctness issue — fix it in the same PR.

---

## Scope

Two changes in one PR:

**1. Fix `findLatestMatchingOffer`** — sort offers by `snapshot_at` DESC before returning the first match.

**2. Wire Kelly sizing** — after `resolveDeviggingResult()` returns a result, call `computeKellySizing()` from `@unit-talk/domain` using the devigged fair probability and the pick's odds. Write to `pick.metadata.kellySizing`. Fail-closed.

**No schema changes. No new routes. No new packages.**

---

## Key Files to Read First

- `packages/domain/src/risk/kelly-sizer.ts` — `computeKellySizing()` signature, `BankrollConfig`, `DEFAULT_BANKROLL_CONFIG`
- `apps/api/src/submission-service.ts` — `resolveDeviggingResult()` and `findLatestMatchingOffer()` from UTV2-64

---

## Permitted Files

- `apps/api/src/submission-service.ts` — fix `findLatestMatchingOffer`, add Kelly enrichment
- `apps/api/src/submission-service.test.ts` — add ≥2 tests

**Do NOT touch:** `apps/operator-web`, `apps/worker`, `apps/discord-bot`, `apps/smart-form`, `apps/ingestor`, `packages/*`

---

## Acceptance Criteria

- [ ] AC-1: `findLatestMatchingOffer` sorts by `snapshot_at` DESC and returns the latest matching offer (not first-found)
- [ ] AC-2: After devig result is written, `computeKellySizing()` is called with `overFair` from `deviggingResult` and `pick.odds`
- [ ] AC-3: Result written to `pick.metadata.kellySizing` (null if devig absent, sizing throws, or odds non-finite)
- [ ] AC-4: Submission succeeds when Kelly sizing throws — fail-closed
- [ ] AC-5: `pnpm verify` exits 0; test count >= baseline + 2

---

## Constraints

- Use `DEFAULT_BANKROLL_CONFIG` from `@unit-talk/domain` — no env-configurable override yet
- `metadata.kellySizing` is **operator-visible only** — do NOT surface it in the `/recap` Discord embed or any capper-facing surface without a ratified contract
- Do not backfill existing picks
- Kelly sizing requires a valid devig result — if `deviggingResult` is null, skip Kelly sizing entirely (don't call with raw implied odds)
- `pick.odds` may be null/undefined — guard with `Number.isFinite` before calling
