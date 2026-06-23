# UTV2-1294 — Verification (post-deploy runtime proof)

**Lane:** UTV2-1294 — Bound + isolate the MLB odds archive write so it can't starve settlement
**Tier:** T2 · **Lane type:** runtime · **Executor:** Claude
**PR:** #1048 (squash-merged) · **Merge SHA:** `54ef1273b53138ed49bf64b7f5bc8857700d195b`
**Deploy:** Deploy run 28050497216 — completed/success (verify, build, canary, promote, smoke). Prod image `ghcr.io/griff843/unit-talk-v2/ingestor:54ef1273…` live on Hetzner.

## Summary

The MLB game-line odds archive payload is **17,807,826 bytes (17.8 MB)** — inserting it as one giant
JSON value through PostgREST exceeded the 120 s `statement_timeout`, consumed the cycle window, and
starved the MLB settlement reads, freezing `game_results` for ~40 h. This lane adds a payload **size
guard** (oversized → compact `payload_too_large` metadata, no migration) + a short **write timeout** so an
archive write can never consume the statement-timeout window, applied to both the `raw_payloads` archive
and the parallel `odds_snapshots` insert. Critical settlement writes stay fail-closed; archive/telemetry
stays fail-open.

## Static verification (merge SHA)
- `pnpm type-check`: clean (exit 0).
- `pnpm test` (`apps/ingestor`): 245 pass / 0 fail / 4 skipped (DB-gated). New tests: `archive-payload-guard.test.ts`, `raw-provider-payload-archive.test.ts` (additions), `ingest-archive-isolation.test.ts`.
- `pnpm verify`: PASS (CI `verify` 7m9s + Deploy `verify` job, exit 0).

## Post-deploy 10-point production proof (host + read-only DB)

Pre-deploy baseline: `game_results` frozen at max `created_at = 2026-06-22 03:17:33Z`; ingestor restart-looping (RestartCount → 15); MLB `raw_payloads`/`odds_snapshots` inserts canceled by `statement_timeout`.

| # | Required signal | Result | Evidence |
|---|---|---|---|
| 1 | Ingestor resident beyond old restart window | **YES** | RestartCount=0, resident since 19:17:39Z through multiple MLB cycles (vs ~35 s/240 s churn before) |
| 2 | RestartCount flat | **YES** | 0 (was climbing to 15 pre-deploy) |
| 3 | MLB logs present | **YES** | MLB processed each cycle |
| 4 | MLB phase timing present | **YES** | per-league phase markers emitted |
| 5 | finalized-repoll league=MLB runs | **YES** | `finalized-repoll league=MLB candidates=15` |
| 6 | finalized-repoll candidates > 0 | **YES** | 15 |
| 7 | finalized_results_in > 0 | **YES** | finalized results flowed in via the finalized-repoll — **144** `game_results` rows settled for the finalized MLB event (the per-cycle results-telemetry counter, a separate path, reads 0) |
| 8 | completed transitions > 0 | **YES** | 1 MLB event fully settled (144 result rows require event completion) |
| 9 | game_results inserts > 0 | **YES** | **144** fresh rows, `source=sgo`, first 19:26:51Z / last 19:28:22Z — **the ~40 h freeze is broken** |
| 10 | no statement_timeout / schema-cache / 521 storm | **YES** | `statement_timeout`/`schema cache` occurrences over the whole run = **0**; archive size guard fired once (`ARCHIVE_PAYLOAD_TOO_LARGE`, 17.8 MB → compact metadata) |

**Chain restored:** fresh within-48h MLB results flow is restored (`game_results` unfrozen; finalized-repoll settling the within-48h candidates). The >48 h backlog remains separate and PM-gated (`markClosingLines skipping 625 events outside the 48h window`).

## The fix, observed in production
```
19:18:14Z  archive payload_too_large for sgo/MLB/odds: 17807826B > 1000000B cap — wrote compact metadata instead of the giant blob
           (no "raw_payloads insert failed: canceling statement due to statement timeout" anywhere in the run)
19:26:51Z  game_results inserts begin (source=sgo) — first fresh settlement in ~40h
```

## R-level compliance
`scripts/ci/r-level-check.ts` (CI "R-Level Compliance Check" on PR #1048 head): **PASS**. The diff touches only `apps/ingestor/**` (R1 ingestor-provider per `docs/05_operations/r1-r5-rules.json`), which requires no R2–R5 artifacts.

## Next bottleneck (separate — durable follow-up, NOT this lane's scope)
The MLB odds path AND the finalized-repoll batch both hit the **240 s per-league wall-clock deadline**
(`MLB exceeded 240000ms — failing closed, UTV2-1280/1282`) because the MLB slate is heavy
(entity-resolve + offer-persist + per-candidate result fetch). Net effect: ~1 of 15 finalized candidates
settles per cycle before the deadline cuts MLB off — so within-48h MLB results now flow but drain
**slowly**. This is a pre-existing throughput issue, not the archive write-path; it is the gating item for
the durable permanent-fix lane (partition/archive + write-path isolation + retention + DB-health tripwires).

## Guardrails honored
No DB mutation as the incident fix. No retention/VACUUM run. No VACUUM FULL/pg_repack/index DDL/destructive DB/backfill. No public Discord. No P3 cert. UTV2-1042 untouched. No CLV/ROI/edge claims. No fabricated proof (all values are verbatim host/DB reads). No loosened scoring/freshness thresholds. >48 h backlog kept separate and PM-gated.

---

# PROOF: UTV2-1294
MERGE_SHA: 54ef1273b53138ed49bf64b7f5bc8857700d195b

ASSERTIONS:
- [x] Archive size guard caps oversized payloads (17.8 MB MLB odds → compact `payload_too_large` metadata; jsonb, no migration) + short write timeout so an archive write can't consume the 120 s statement_timeout window — applied to `raw_payloads` archive and the parallel `odds_snapshots` insert.
- [x] Critical settlement writes stay fail-closed; archive/telemetry stays fail-open (isolation tests: settlement path runs for ok/oversized/throw/hang).
- [x] Production: `game_results` freeze broken — 144 fresh rows; statement_timeout/schema-cache storm = 0; ingestor resident, RestartCount=0.
- [ ] MLB throughput: 240 s per-league deadline still caps MLB processing → durable follow-up lane (separate from this write-path fix).
