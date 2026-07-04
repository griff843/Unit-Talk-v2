# UTV2-1297 Verification Log

**Issue:** UTV2-1297 — MLB finalized-repoll throughput: instrument results path
**Tier:** T2
**Branch:** claude/utv2-1297-finalized-repoll-throughput
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1054
**Merge SHA:** 736d0d41603702da50af148ae714e98dd4befcfa

## Verification

| Command | Status | Evidence |
|---------|--------|---------|
| `pnpm type-check` | PASS | run 2026-07-04 on main at post-merge state containing merge SHA `736d0d41` — `tsc -b tsconfig.json` clean, zero errors |
| `pnpm test` | PASS | run 2026-07-04 on main — all test groups green; final group TAP: `# tests 19` / `# pass 19` / `# fail 0` / `# skipped 0` |
| `pnpm test:db` | PASS | run 2026-07-04 against live Supabase — TAP: `# tests 7` / `# pass 7` / `# fail 0` / `# skipped 0` (runtime evidence for the ingestor results-path instrumentation) |
| `pnpm verify` | FAIL (unrelated to this lane) | run 2026-07-04 — single failure is `apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts` asserting live data exists in a 72h window; fails because the SGO API key went inactive 2026-06-30 12:41 UTC (vendor-side outage, zero ingestion since). All static steps (lint, type-check, build, test) green. Not caused by, and not maskable by, this lane's merged diff. |
| `scripts/ci/r-level-check.ts` | PASS | run 2026-07-04 with `--base 736d0d41^1 --head 736d0d41` — Verdict: PASS, 4 changed files, rule matched: `ingestor-provider` |

## Runtime evidence (live DB queries)

Live Supabase queries run 2026-07-04 against `system_runs` (project `zfzdnfwdarxucxtaojxm`) show the results-path instrumentation delivered by this lane recording in production. Query: `select details from system_runs where run_type='ingestor.cycle' and status='succeeded' order by started_at desc limit 1;`

Returned row (latest succeeded cycle, snapshotAt 2026-06-30T12:54:45.002Z, league NFL) includes the lane's instrumentation fields with real row_counts and timings:

```json
"phaseTimings": {"resultsFetch": 240, "resultsResolve": 0, "resultsEventLookup": 0, "resultsInsertGameResults": 0, "resultsParticipantLookup": 0, "resultsPerCandidateTotal": 0},
"resultsEventsCount": 0, "resultsErrorsCount": 0, "insertedResultsCount": 0, "resolvedEventsCount": 0, "resolvedParticipantsCount": 0
```

Aggregate over the last 6 days: 377 succeeded `ingestor.cycle` runs carrying these instrumented fields (queries run via Supabase MCP, 2026-07-04).

## Reconciliation note

This verification log was authored post-merge during ghost-lane reconciliation (2026-07-04). The lane's PR #1054 merged at `736d0d41603702da50af148ae714e98dd4befcfa` with green CI on 2026-06-24, but automated closeout was cancelled before `verification.md` was generated (the prior `runtime-verification.md` was an unexecuted placeholder). The commands above were re-executed for real against main, which contains the merge SHA in its history, and the results recorded here.

## What This Lane Delivers

- Instrumentation of the MLB finalized-repoll results path in `apps/ingestor/src/ingest-league.ts` and `apps/ingestor/src/results-resolver.ts`, with coverage in `apps/ingestor/src/results-resolver.test.ts`.
