# UTV2-1272 — Verification

**Issue:** UTV2-1272 — Restore SGO key delivery, AppEnv scheduling, and provider offer freshness so forward-flow CLV can compute (PM-rescoped 2026-06-13).
**Branch:** `claude/utv2-1272-appenv-scheduling-and-clv-diagnostic` · **Lane type:** runtime · **Tier:** T1
**Base SHA:** `e7213ad7` · **Merge SHA:** `778ebcd34cbb43c52df9f09852dffc8377b87078` (PR #1020, squash-merged)

> Lane executed single-worktree (zero concurrent lanes; main worktree already has `node_modules`).
> Substrate guard PASS (0 hard-fail), no active-lane file-scope overlap, sync file `.ops/sync/UTV2-1272.yml` present.

## Verification

Commands run on the branch:

- `pnpm type-check` → **PASS** (`tsc -b`, project references clean).
- `pnpm test` → **PASS** — 3,171 tests, 0 failures (full `pnpm verify` run).
- `pnpm verify` → **PASS** — sync-check, system-alignment, automation-coverage, env:check, lint (eslint),
  type-check, build, test, smart-form verify, verify:commands (command-manifest + migration lint) all green.
- `pnpm test:db` → see `runtime-health.json` (live Supabase smoke for T1).
- Focused: `tsx --test apps/ingestor/src/scheduler.test.ts apps/ingestor/src/sgo-key-manager.test.ts packages/config/src/env.test.ts` → **21/21 PASS**.

## Executed-command evidence

### `pnpm test:db` (live Supabase smoke — node:test TAP)

```
> @unit-talk/v2@0.1.0 test:db
> tsx --test apps/api/src/database-smoke.test.ts
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 115883.44253
```

### `pnpm test` (full suite via `pnpm verify` — node:test TAP)

```
# tests 3171
# pass 3171
# fail 0
# skipped 0
```

`pnpm type-check` → PASS (`tsc -b`). `pnpm verify` → PASS (sync-check, system-alignment,
automation-coverage, env:check, lint, type-check, build, test, smart-form verify, verify:commands).

## What was proven (against the UTV2-1272 acceptance list)

| Required proof | Result |
|---|---|
| SGO key candidate count > 0 without printing secrets | Proven by `sgo-key-manager.test.ts` — candidates fold singular→plural, dedup, and tags are masked (`describeSgoApiKey`). |
| Ingestor no longer logs a misleading "SGO_API_KEY missing" | `buildSgoKeyResolutionDiagnostic` distinguishes `SGO_KEY_UNCONFIGURED` vs `SGO_KEY_PROBE_FAILED`; wired into `index.ts`. Ingestion is live (provider_offer_history ~105k writes/24h) → prior log was a transient/false alarm, now contextualized. |
| AppEnv exposes scheduling vars | 6 `UNIT_TALK_INGESTOR_*` vars added to `AppEnv` + `loadEnvironment()`; proven by `env.test.ts`. |
| Scheduling can be enabled at runtime; peak/off-peak works | Proven by `scheduler.test.ts` (peak/off-peak/fixed resolution); unsafe cast removed so AppEnv values reach `parseSchedulerConfig`. |
| Canonical CLV source path identified | `provider_offer_history` (fresh) is the CLV closing-line source; `provider_offers` confirmed LEGACY/FROZEN. See `missing-event-context-diagnostic.md`. |
| ≥1 current player-prop settlement reaches computed CLV, OR exact blocker proven | **Exact blocker proven:** CLV computes for eligible well-formed props (~31 computed); forward-flow `closing_for_clv`=0 because no eligible pick has settled-with-computed-CLV since the UTV2-1262 write path deployed (latest 2026-06-11). Volume/timing, not a defect. |
| UTV2-1250-style post-diagnostic recommendation | In `missing-event-context-diagnostic.md` → "Conclusion for Wave 2". |

## Guardrails honored

No P3 certification; UTV2-1042 not marked Done; no CLV/ROI/edge claims; no public Discord change;
no live backfill; no WebSocket; no secrets emitted (keys masked); no production evidence rows mutated
(diagnosis read-only SELECT); **no CLV resolver semantic change** (resolver file untouched).

## R-level

R-level per `docs/05_operations/r1-r5-rules.json` evaluated at lane close; runtime config + ingestor
diagnostics + read-only script, no schema/migration/contract changes.
