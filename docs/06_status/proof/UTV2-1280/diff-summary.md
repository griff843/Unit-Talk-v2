# UTV2-1280 — Diff Summary

**Issue:** Ingestor MLB cycle hangs — no MLB provider offers since 2026-06-12
**Tier:** T1 · **Lane type:** runtime · **Executor:** claude
**Branch:** `griffadavi/utv2-1280-ingestor-mlb-cycle-hangs-no-mlb-provider-offers-since-2026`
**Merge SHA:** _(bound post-merge)_

## Root cause (evidence-backed)

The SGO league cycle iterates leagues sequentially (`['NBA','NFL','MLB','NHL']`) with
**no hard per-league timeout** — the only `fetchWithTimeout` in the runner guarded the
5s SGO account-usage call. A single league that stalls therefore hangs the whole cycle:

- Hung run `49c7d04f` (`system_runs`, `ingestor.cycle`, MLB) was `status=running` for
  **~7.5h** (dur 26,840s) at observation; the prior 06-13 MLB runs were force-`failed`
  ~28h later by the startup `reapStaleRuns` reaper (identical `finished_at`), i.e. true
  indefinite hangs, not slowness.
- `reapStaleRuns` only runs **once at daemon startup** (15-min stale threshold), so a hung
  cycle stays hung until the process restarts — MLB went dark from 06-12 07:35 onward.
- The ingestor connects via the Supabase SDK over PostgREST as `service_role`, whose
  `rolconfig` is **null (no `statement_timeout`)**; only the offers-upsert / archive paths
  `SET LOCAL` a timeout. Other calls (entity resolution, `findExistingCombinations`,
  `markClosingLines`) and SDK HTTP have no client-side bound.
- UTV2-1275's player-prop fetch is **league-wide** (`leagueID=MLB` + `oddID` PLAYER_ID
  wildcards + a **7-day** `startsBefore` window) — high-volume on a full MLB slate, which
  pushed the unbounded path past completion. (NBA succeeded because its 1-event slate is
  trivial — the hang is MLB-volume-specific, not the prop fetch per se.)

## Changes (apps/ingestor only — no schema, no migration, no DB-enum change)

| File | Change |
|---|---|
| `src/ingestor-runner.ts` | New `LeagueIngestTimeoutError` + `ingestLeagueWithTimeout()` — a hard per-league wall-clock bound (`leagueTimeoutMs`, default **240_000ms**, `<=0` disables). On timeout it `AbortController.abort()`s the in-flight SGO fetch (graceful: routes into `ingestLeague`'s existing fail-closed `catch`) **and** `Promise.race`-rejects so the runner advances even if a downstream call is unabortable. Applied to the main league loop and the finalized-repoll loop; emits a TIMEOUT warning + ops alert and proceeds to the next league. |
| `src/ingest-league.ts` | New `signal?: AbortSignal` option threaded into both SGO fetches; `throwIfAborted()` checkpoints between fetch / DB-write / results phases so a fired deadline fails the cycle closed via the existing `catch` (records `provider_cycle_status` failed). |
| `src/sgo-fetcher.ts` | `signal?` added to odds + results fetch options; combined with the per-page 30s timeout via `AbortSignal.any`; `throwIfAborted()` at the top of the pagination loop so a fired deadline stops paging immediately. |
| `src/sgo-request-contract.ts` | Player-prop (oddID-wildcard) **live** fetch `startsBefore` narrowed from **7 days → 36h** to bound high-volume PLAYER_ID-wildcard pagination/payload. Game-line markets keep 7 days; an explicit `startsBefore` always wins; historical fetches unchanged. |
| `src/index.ts` | Reads `UNIT_TALK_INGESTOR_LEAGUE_TIMEOUT_MS` (via `process.env`, default 240_000) and passes `leagueTimeoutMs` into `runIngestorCycles`. |
| `src/ingest-league-timeout.test.ts` | New focused tests (5). |

## Guardrails honored

No freshness-gate loosening · no fabricated picks · no backfill · no production-evidence
mutation · no P3 cert · no CLV/ROI/edge claims · no secrets · no schema/migration ·
no cross-package change (config `AppEnv` untouched — env read via `process.env`).
