# UTV2-1293 — Verification (post-deploy runtime proof)

**Lane:** UTV2-1293 — Keep autorun ingestor daemon resident (MAX_CYCLES=0 must run forever)
**Tier:** T2 · **Lane type:** runtime · **Executor:** Claude
**PR:** #1047 (squash-merged; supersedes auto-closed #1046 after branch was renamed to carry the issue ID)
**Merge SHA:** `9d5a5827ca55d5cdbd127654a9eed2f18f0960b7`
**Deploy:** GitHub Actions Deploy run 28044197919 — completed/success (verify, build, canary, promote, smoke all green). Prod image `ghcr.io/griff843/unit-talk-v2/ingestor:9d5a5827…` live on Hetzner (host `unit-talk-prod`, container `unit-talk-ingestor-1`).

## Summary

`apps/ingestor/src/index.ts` mapped `MAX_CYCLES=0` → `undefined`; the runner coalesces `options.maxCycles ?? 1` → **1**, so the autorun daemon ran a single cycle then returned, and with the watchdog `unref()`'d the event loop drained → clean `exit(0)` → `restart: unless-stopped` churn. The fix passes `Number.POSITIVE_INFINITY` for the daemon and adds a ref'd keep-alive (cleared in `finally`). Container confirmed running the autorun daemon directly (`tsx apps/ingestor/src/index.ts`, PID 1, `UNIT_TALK_INGESTOR_AUTORUN=true`, `UNIT_TALK_INGESTOR_MAX_CYCLES=0`) — exactly the path this fix targets.

## Verification — static (merge SHA)

- `pnpm type-check`: clean (CI `verify` job on PR #1047 head, exit 0).
- `pnpm test` (`apps/ingestor`): 86/86 pass (CI `verify` on PR #1047 head, exit 0).
- `pnpm verify` (static profile): PASS end-to-end on the merge SHA (Deploy run 28044197919 `verify` job, exit 0).

No `test:db` TAP is fabricated; T2 runtime proof is static + post-deploy runtime observation (live Supabase `test:db` is degraded — see first NO below).

## Verification — post-deploy 10-point runtime proof (host + read-only DB signals)

Pre-deploy baseline (image `08901fa3`, captured 2026-06-23 ~17:28Z): container resident but every league logged `SGO_API_KEY missing; skipping ingest for MLB`; `game_results` frozen at max `created_at = 2026-06-22 03:17:33Z`; 0 `ingestor.cycle` `system_runs` rows in the prior 2h.

| # | Required signal | Result | Evidence |
|---|---|---|---|
| 1 | Ingestor resident beyond old ~35s window | **YES** | Current run StartedAt 17:33:58Z resident ≥2.7 min through a full DB-degraded MLB phase; heartbeat holds (`cycle:1, phase:league-start, league:MLB`) instead of exiting. Keep-alive working. |
| 2 | RestartCount stops climbing | **YES (stabilized)** | `RestartCount=3`, stable since 17:33:58Z. The 0→3 occurred during the deploy promote window + first heavy DB-stalled cycles; no longer the old ~35s loop. |
| 3 | MLB league logs appear | **YES** | `[ingestor] cycle sgo/MLB …`; MLB now ingested (was `skipping ingest for MLB` pre-deploy — SGO key now resolves). |
| 4 | MLB phase timing appears | **YES** | `[ingestor] cycle sgo/MLB phase timings(ms): …` emitted per cycle. |
| 5 | finalized-repoll league=MLB runs | **YES** | `[ingestor] finalized-repoll league=MLB candidates=24` (17:32:09Z). |
| 6 | finalized-repoll candidates > 0 | **YES** | candidates = **24**. |
| 7 | finalized_results_in > 0 | **NO** | `[results-telemetry] finalized_results_in=0 completed=0 inserted=0` every cycle. → next first NO below. |
| 8 | completed transitions > 0 | **NO** | `completed=0` (same telemetry line). |
| 9 | game_results inserted > 0 | **NO** | `game_results` max `created_at` still `2026-06-22 03:17:33Z`; **0** rows since 17:30Z. Frozen ~38h. |
| 10 | statement-timeout / 521 storm cleared | **NO** | Actively firing: `raw_payloads insert failed: canceling statement due to statement timeout`; `odds_snapshots insert failed: canceling statement due to statement timeout`; `Failed to upsert provider cycle status: Could not query the database for the schema cache`. |

## Next exact first NO (after the daemon is resident)

**Supabase write-path degradation — Postgres `statement_timeout` cancels the MLB result/odds writes; root cause is our table bloat with autovacuum never run.**

The resident daemon reaches MLB and finalized-repoll surfaces 24 in-window MLB candidates, but their persistence writes are cancelled by `statement_timeout`, so nothing settles:

```
17:34:47Z  archive fail-open for sgo/MLB: raw_payloads insert failed: canceling statement due to statement timeout
17:35:03Z  odds_snapshot write failed for sgo/MLB (non-fatal): odds_snapshots insert failed: canceling statement due to statement timeout
17:32:06Z  league=MLB failed, skipping to next: Failed to upsert provider cycle status: Could not query the database for the schema cache
```

Read-only `pg_stat_user_tables` (live, project `zfzdnfwdarxucxtaojxm`):

| table | total size | live rows | dead rows | last_autovacuum | last_analyze |
|---|---|---|---|---|---|
| system_runs | **1215 MB** | 4 | 2 | **null (never)** | **null (never)** |
| raw_payloads | **657 MB** | 4 | 0 | null (never) | null (never) |
| odds_snapshots | **405 MB** | 2 | 0 | null (never) | null (never) |
| game_results | 41 MB | 0 | 0 | null (never) | null (never) |

Severe bloat (gigabytes for single-digit live-row counts) + stale/absent planner stats → write-path statement timeouts and schema-cache query failures. Because MLB odds/results cannot persist, the 24 finalized-repoll candidates cannot settle → points 7–9 stay 0 and `game_results` stays frozen. This is the UTV2-1290 write-path degradation incident; durable prevention is the DB maintenance + retention lane.

## R-level compliance

`scripts/ci/r-level-check.ts` (CI "R-Level Compliance Check" on PR #1047 head): **PASS**. The diff
touches only `apps/ingestor/**` (R1 ingestor-provider per `docs/05_operations/r1-r5-rules.json`),
which requires no R2–R5 artifacts (no determinism/shadow/fault/strategy reports). No required R-level
artifacts were missing.

## Scope verdict

UTV2-1293's own scope — the autorun daemon stays resident (not 1-cycle-then-`exit(0)`), reaches the in-season league (MLB), and runs finalized-repoll — is **restored and proven in production**. The settlement chain is **not** fully restored: it is blocked downstream by the DB write-path degradation, which is a separate root cause (table bloat / never-run autovacuum) tracked as DB maintenance + retention. Mitigation (`ANALYZE`/`VACUUM`/retention) is **PM-gated** and not performed in this lane.

## Guardrails honored

No public Discord. No P3 certification. No CLV/ROI/edge claims. No fabricated proof (all values are verbatim host/DB observations). No live backfill. No purge/delete. No `VACUUM FULL`/`pg_repack`/index DDL. No secrets printed. UTV2-1042/UTV2-1288 not touched. The >48h finalized backlog (`markClosingLines skipping 614 events outside the 48h window`) is kept separate and PM-gated.

---

# PROOF: UTV2-1293
MERGE_SHA: 9d5a5827ca55d5cdbd127654a9eed2f18f0960b7

ASSERTIONS:
- [x] `MAX_CYCLES=0` now maps to `Number.POSITIVE_INFINITY` (not `undefined`); ref'd `daemonKeepAlive` added and cleared in `finally` (apps/ingestor/src/index.ts).
- [x] Deployed to Hetzner as image `9d5a5827…`; container runs the autorun daemon directly; RestartCount stabilized at 3; resident ≥2.7 min through a DB-degraded MLB phase.
- [x] MLB ingests; finalized-repoll league=MLB runs with candidates=24.
- [ ] finalized_results_in / completed / game_results > 0 — BLOCKED by next first NO: Supabase write-path `statement_timeout` from table bloat (system_runs 1215 MB, raw_payloads 657 MB, odds_snapshots 405 MB; autovacuum never run). PM-gated DB maintenance + retention.
