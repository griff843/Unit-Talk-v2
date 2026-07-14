# PROOF: UTV2-1396
MERGE_SHA: d90ff5bf82f968b2ad3bb6ccc5fcfda32229c80b

## Verification

ASSERTIONS:
- [x] Shared `isTestFixturePick` predicate (client.ts) catches `metadata.testRun` and `proof_issue`, not just the previously-caught `proof_fixture_id`/`proof_script`/`test_key`
- [x] Applied at read time to Command Center performance/leaderboard/intelligence/queues aggregations and `alert-query-service`'s signal-quality metric
- [x] No historical row backfill or delete
- [x] No change to the proof-auditor-gate contract or T1 proof harness shape
- [x] `pnpm type-check` and `pnpm test` green

EVIDENCE:
```text
$ pnpm type-check
(exit 0)

$ npx tsx --test apps/api/src/alert-query-service.test.ts apps/command-center/src/lib/data/client.test.ts
(11 tests, 0 failures)

$ pnpm verify
(exit 0: env:check, lint, type-check, build, test, test:db, and repository live-proof suite green)

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
```

No database-writing verification was added for this T2 read-path change; no scanner or runtime configuration was changed.
