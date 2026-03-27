# M11 Closure Verification Proof

**Status:** PASS (all ACs confirmed)
**Verified:** 2026-03-27
**Verifier:** Claude lane (independent)
**Main at:** `1bab4d8` (queue update — UTV2-63/67 DONE)
**pnpm verify:** EXIT 0 — 678/678 tests pass, 0 fail

---

## Gate Results

| Gate | Status | Notes |
|---|---|---|
| `pnpm env:check` | PASS | |
| `pnpm lint` | PASS | 0 errors |
| `pnpm type-check` | PASS | 0 errors |
| `pnpm build` | PASS | exit 0 |
| `pnpm test` | PASS | 678 tests, 678 pass, 0 fail |

**Note:** `pnpm install` was blocked by a stale `esbuild.exe` service process (PID 29636) left from a prior build session. Killed process, re-ran install — completed cleanly. Stale process was not related to M11 code changes.

---

## M11 Deliverable Verification

### UTV2-61 — Recap CLV/Stake Enrichment (PR #37)

**Method:** Code review on main.

- `apps/discord-bot/src/commands/recap.ts` — `clvPercent: number | null` and `stakeUnits: number | null` in `CapperRecapResponse` type ✓
- `pick.clvPercent` and `pick.stakeUnits` mapped at lines 117–119 ✓
- `buildRecapField` renders `CLV: ${fields.get('CLV%') ?? '—'}` in embed output ✓
- CLV and stake sourced from settlement records, not pick payload directly ✓

**PASS**

---

### UTV2-62 — Dead-Letter Outbox Promotion (PR #35)

**Method:** Code review on main + git show.

- `markDeadLetter(outboxId, errorMessage)` added to `OutboxRepository` interface (`packages/db/src/repositories.ts`) ✓
- `markDeadLetter()` implemented in both `InMemoryOutboxRepository` and `DatabaseOutboxRepository` (`packages/db/src/runtime-repositories.ts`) ✓
- `distribution-worker.ts` line 172: `const shouldDeadLetter = failed.attempt_count >= 3` ✓
- Line 174: `await repositories.outbox.markDeadLetter(claimed.id, errorMessage)` called when threshold reached ✓
- Audit action: `distribution.dead_lettered` when dead-lettered, `distribution.failed` otherwise ✓
- Tests in `worker-runtime.test.ts` cover dead-letter promotion path ✓

**PASS**

---

### UTV2-63 — Dead-Letter Operator Surface (PR #39)

**Method:** Code review on main.

- `deadLetterOutbox: number` added to `OperatorSnapshot.counts` type (`server.ts` line 77) ✓
- `counts.deadLetterOutbox` computed as `recentOutbox.filter(row => row.status === 'dead_letter').length` (line 909) ✓
- Distribution health degrades when `counts.deadLetterOutbox > 0` (line 923) ✓
- Detail message: `X dead-letter outbox item(s) need attention` (lines 928–932) ✓
- Per-target channel health also checks for dead-letter rows (lines 1013–1033) ✓

**PASS**

---

### UTV2-64 — DeviggingService Submission Wiring (PR #36)

**Method:** Code review on main.

- `resolveDeviggingResult()` called at submission time in `submission-service.ts` ✓
- Result written to `pick.metadata.deviggingResult` ✓
- Fail-closed: null written on absent offers, devig errors, or non-finite odds ✓
- `findLatestMatchingOffer()` used to locate provider offer by market key ✓

**PASS**

---

### UTV2-65 — M10 Closure Verification

**Method:** Separate proof artifact.

- See `docs/06_status/UTV2-65_proof.md` — all ACs PASS
- `PROGRAM_STATUS.md` updated: M10 CLOSED, M11 active

**PASS**

---

### UTV2-66 — Discord Bot Startup Entry Point (PR #38)

**Method:** Code review on main + live confirmation.

- `apps/discord-bot/src/main.ts` exists and matches required implementation from contract ✓
- `package.json` `dev` script: `tsx src/main.ts` ✓
- `index.ts` unchanged — remains library entry for `buildRecapEmbedData` ✓
- Bot confirmed live: `[discord-bot] Ready as Unit Talk#9476` (Augment session 2026-03-27) ✓

**PASS**

---

### UTV2-67 — Kelly Sizing at Submission (PR #40)

**Method:** Code review on main.

- `findLatestMatchingOffer()` (`submission-service.ts` line 182) sorts `snapshot_at` DESC with `created_at`/`id` tiebreakers (line 189) ✓
- `computeKellySize()` imported from `@unit-talk/domain` (line 25) ✓
- `americanToDecimal()` imported for odds conversion (line 22) ✓
- Called as `computeKellySize(deviggingResult.overFair, americanToDecimal(odds), DEFAULT_BANKROLL_CONFIG)` (lines 221–223) ✓
- Result written to `pick.metadata.kellySizing` (line 88) ✓
- Fail-closed: `kellySizing = null` when devig absent, odds non-finite, or sizing throws (lines 73–89) ✓
- `kellySizing` is operator-visible only — not surfaced in `/recap` Discord embed ✓

**PASS**

---

## Verdict

| Deliverable | PR | Result |
|---|---|---|
| UTV2-61 Recap CLV/stake enrichment | #37 | **PASS** |
| UTV2-62 Dead-letter outbox promotion | #35 | **PASS** |
| UTV2-63 Dead-letter operator surface | #39 | **PASS** |
| UTV2-64 DeviggingService submission wiring | #36 | **PASS** |
| UTV2-65 M10 closure verification | — | **PASS** |
| UTV2-66 Discord bot startup entry point | #38 | **PASS** |
| UTV2-67 Kelly sizing at submission | #40 | **PASS** |
| `pnpm verify` | — | **EXIT 0 (678/678)** |

**M11 CLOSED.**
