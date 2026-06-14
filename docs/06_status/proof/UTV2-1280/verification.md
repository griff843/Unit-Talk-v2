# UTV2-1280 — Verification

**Issue:** UTV2-1280 — Ingestor MLB cycle hangs; no MLB provider offers since 2026-06-12.
**Branch:** `griffadavi/utv2-1280-ingestor-mlb-cycle-hangs-no-mlb-provider-offers-since-2026` · **Lane type:** runtime · **Tier:** T1
**Base SHA:** `f8919d52` · **PR head:** `a9248430` · **Merge SHA:** _(bound post-merge)_

> Lane executed in the main checkout (main-control mode), zero concurrent lanes
> (the two merged ghost lanes were reconciled to `done` first), node_modules
> preexisting. No production rows mutated by this lane.

## Scope of this lane (PM-confirmed)

UTV2-1280 is the **code / runtime-safety** fix. This bundle proves the mechanism:
the MLB cycle cannot hang indefinitely, fetch/cycle timeouts are bounded, fail-closed
behavior works, and the next league proceeds after an MLB timeout/failure. The **live
production proof** (production SHA includes UTV2-1280; fresh same-day MLB
`provider_offer_history` rows with `provider_participant_id`; market_universe /
candidates flow) is deferred to **post-deploy via UTV2-1279** — only deployed runtime
can prove it. (PM decision, 2026-06-14.)

## Root cause (live evidence)

- Hung run `49c7d04f` (`system_runs`, `ingestor.cycle`, MLB) was `status=running` for
  **~7.5h** at observation; the prior 06-13 MLB runs were force-`failed` ~28h later by the
  startup `reapStaleRuns` reaper (identical `finished_at`) — indefinite hangs, not slowness.
- `reapStaleRuns` runs **once at daemon startup** (15-min threshold); a hung cycle stays
  hung until restart, so MLB went dark after 06-12 07:35.
- Ingestor connects via the Supabase SDK over PostgREST as `service_role`, whose
  `rolconfig` is **null (no `statement_timeout`)**; the SGO league loop had **no hard
  per-league timeout** (only the 5s account-usage call was bounded).
- The player-prop fetch (introduced by the player-prop lane) is **league-wide**
  (`leagueID=MLB` + PLAYER_ID-wildcard `oddID` + 7-day window) — high-volume on a full MLB
  slate, which pushed the unbounded path past completion. NBA succeeded because its slate
  is trivial — the hang is MLB-volume-specific.

## Verification — commands run on the branch

- `pnpm type-check` → **PASS** (`tsc -b`, project references clean).
- `pnpm lint` → **PASS** (eslint, cached).
- `pnpm build` → **PASS** (`tsc -b`).
- `pnpm test` (full suite) → **PASS** — exit 0, **0 failures** across all sub-suites
  (verified twice, two independent runs both exit 0; `grep -c '^not ok'` = 0).
- `pnpm test:db` (live Supabase smoke, T1 runtime proof) → **PASS** — **7/7**.
- Focused: `tsx --test apps/ingestor/src/ingest-league-timeout.test.ts` → **5/5 PASS**;
  regression `tsx --test apps/ingestor/src/player-prop-ingest.test.ts apps/ingestor/src/ingestor.test.ts` → **92/92 PASS**.

### `pnpm test:db` (live Supabase smoke — node:test TAP)

```
> tsx --test apps/api/src/database-smoke.test.ts
# tests 7
# pass 7
# fail 0
```

### Focused bounded-timeout / fail-closed tests

```
> tsx --test apps/ingestor/src/ingest-league-timeout.test.ts
ok 1 - ingestLeagueWithTimeout: a hung league fetch fails closed within the bound, not indefinitely  (105ms ~= 100ms bound)
ok 2 - ingestLeagueWithTimeout: timeoutMs <= 0 disables the bound (explicit opt-out)
ok 3 - runIngestorCycles: a hung MLB league does not block NBA — cycle fails closed and proceeds
ok 4 - buildSgoOddsRequestUrl: player-prop fetch narrows startsBefore to the imminent slate
ok 5 - buildSgoOddsRequestUrl: explicit startsBefore overrides the player-prop narrowing
# tests 5  # pass 5  # fail 0
```

## What was proven (against the UTV2-1280 acceptance list)

| Required proof | Result |
|---|---|
| MLB cycle cannot hang indefinitely | Test 1 — a fetch that hangs until aborted fails closed in ~the bound (105ms for a 100ms bound), not indefinitely. `ingestLeagueWithTimeout` `Promise.race`-rejects regardless of whether the downstream call is abortable. |
| Fetch / cycle timeouts are bounded | Per-page HTTP 30s timeout now combined with the external deadline via `AbortSignal.any`; pagination stops on `throwIfAborted`; per-league wall-clock bound `leagueTimeoutMs` (default 240s, `<=0` disables). |
| Fail-closed behavior works | On timeout the in-flight SGO fetch aborts → `ingestLeague`'s existing `catch` records `provider_cycle_status` failed + `completeRun(failed)`; the runner emits a TIMEOUT warning + ops alert (Test 3 asserts the warning). |
| Next league proceeds after MLB timeout/failure | Test 3 — with MLB hung, `runIngestorCycles(['MLB','NBA'])` returns bounded (<8s) with **NBA present** and MLB absent from succeeded results. |
| High-volume MLB request bounded (not removed) | Tests 4–5 — the live player-prop fetch window is narrowed 7d→36h; game-line keeps 7d; an explicit `startsBefore` still wins. Event-centered model intact. |
| No freshness-gate loosening | Freshness gate (`evaluateProviderOfferFreshnessGate`) and staging untouched; diff is timeout + abort plumbing + request window only. |
| No fabricated picks / no backfill / no prod-evidence mutation | No writes to picks/submissions/settlement/outbox; no historical/backfill path touched; lane wrote no production rows. |

## Guardrails honored

No P3 certification; UTV2-1042 not marked Done; no CLV/ROI/edge claims; no public Discord
change; no live backfill; no local production-mutating live cycle (PM-deferred to UTV2-1279);
no freshness-gate loosening; no fabricated picks; no production evidence rows mutated; no secrets
emitted; no schema/migration; `@unit-talk/config` `AppEnv` untouched (env read via `process.env`).

## R-level

R-level per `docs/05_operations/r1-r5-rules.json` evaluated at lane close. Runtime ingestor
behavior change (timeout/abort plumbing + request window); no schema/migration/contract change.
Runtime proof: `pnpm test:db` 7/7 (live Supabase). Live production freshness proof deferred to
the post-deploy lane (UTV2-1279).
