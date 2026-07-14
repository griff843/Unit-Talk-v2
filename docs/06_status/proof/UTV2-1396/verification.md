# PROOF: UTV2-1396
MERGE_SHA: c92a3701ec220211c1e5e984688964f469d70a16

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
```

No database-writing verification was added for this T2 read-path change; no scanner or runtime configuration was changed.
