# Diff summary: WORK-2026111102

Odds API scores results ingestion: operator CLI, doc-derived fixtures and staging only. No deployment, scheduling, provider key, live vendor call or production write.

| File | Change |
|---|---|
| `apps/ingestor/src/odds-api-fetcher.ts` | `fetchOddsApiScores`: validated GET of the scores endpoint with quota telemetry. |
| `apps/ingestor/src/odds-api-scores-parser.ts` | Classifies an event as `final` only when completed, both scores numeric, names matching the home/away teams, and a fresh `last_update`. |
| `apps/ingestor/src/odds-api-scores-team-map.ts` | Static map from Odds API team names to canonical external ids; no fuzzy matching. |
| `apps/ingestor/src/odds-api-scores-resolver.ts` | Writes the event, participants and the four full-game result keys (7 rows). Step 13: checks existing rows for conflicts before any write, stages the event without `resultsProof`, inserts only missing identical rows, confirms all seven, and only then marks the event `completed` with `resultsProof`; a conflicting value, timestamp or row makes zero writes (`conflicting_results`). |
| `scripts/ops/odds-api-scores-sync.ts` | `results:odds-api-scores` CLI: dry run by default, `--apply` refused on anything but staging, blast-radius report, run audit row. |
| `apps/api/src/grading-service.ts` | Trusts `odds-api` results only for Track Only evidence-plane picks with a complete `resultsProof`, for game total, team total, spread and moneyline; fixture payloads only on staging or loopback. |
| `apps/api/src/grading-service.ts` (steps 11-12) | Restricted passes load only the requested pick ids and reapply lifecycle and Track Only admission; run records carry `restricted` and `requested_pick_count`, and a restricted pass never reports `no_op_no_input`. Unrestricted cron path unchanged. |
| `apps/api/src/t1-proof-utv2-1886-settlement-batch.test.ts` | Outside the lane lock, pending PM `scope-override/v1`: the empty-restriction live proof now expects 0 picks read and `restricted: true`; outcome, freshness and run assertions unchanged. |
| `apps/api/src/grading-service.ts` (step 13a) | A results-proven event grades only with exactly seven same-source result rows matching the event's home and away links, the proof's `providerLastUpdate`, and mutually consistent totals, margins and moneylines; otherwise the pick is skipped (`odds_api_results_incomplete` / `odds_api_results_inconsistent`) with no settlement or outbox row. Other providers unchanged. |
| `apps/ingestor/src/__fixtures__/odds-api-scores/*.doc-derived.json` | 15 fixtures derived from the documented response shape. |
| `*.test.ts` (parser, resolver, sync, grading-service, staging proof) | Tests 1-38 plus step 11-13b tests; test 38 is the CI-only staging journey across all four families, with interruption recovery and concurrent applies. |
| `package.json` | `results:odds-api-scores` script and test registration only (PM D6). |
| `.ops/work/WORK-2026111102.md`, `docs/06_status/lanes/WORK-2026111102.json`, `.ops/sync/WORK-2026111102.yml` | Work order (incl. steps 9-13b, the D7 re-audit lists and the DEBT-032/033 record), lane manifest and sync record. |
| `docs/06_status/proof/WORK-2026111102/*` | This proof bundle and the model-routing sidecar. |

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1846
