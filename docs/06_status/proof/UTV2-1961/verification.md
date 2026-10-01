# PROOF: UTV2-1961

MERGE_SHA: pending merge

Issue: UTV2-1961
Tier: T1
result: pass

## ASSERTIONS:

- [x] Workflow refuses non-dispatch events, non-main refs and unsupported migration profiles.
- [x] PostgreSQL probes require canonical production warehouse_reader and observe transaction_read_only=on.
- [x] Management token is confined to linked-project ledger reads and excluded from PostgreSQL probes.
- [x] No DDL, retention RPC, DML or deletion is reachable from this workflow.
- [x] Receipt and ledger use immutable artifact v4; separate production parity remains mandatory.
- [x] Four owned files remain byte-identical to reviewed companion commit ca628341519f363b9ee80660064f2604b3b5e76a.
- [x] Verifier dependency merged in main at 80eb0f2d579d19f9c1de2db4d3196a266580be0a.

## EVIDENCE:

```text
pnpm test:production-post-migration: tests 11; pass 11; fail 0
credential/staging guard suites: tests 75; pass 75; fail 0
pnpm verify:static: exit 0
Environment, lint, type-check, build, tests, verifier tests and command gates passed.
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 137 migration file(s) verified — no duplicate versions.
[lint-migrations] 136 migration file(s) checked — no findings.
R-level: PASS; 8 changed files; no matching rules.
pnpm test:db: REFUSED before DB client construction; local placeholder is not governed staging.
Writable live proof remains mandatory in protected staging CI.
```

## Verification

Commands: pnpm verify:static; pnpm test:production-post-migration;
pnpm exec tsx --test scripts/ci/workflow-production-credential-guard.test.ts scripts/ci/staging-path-enforcement.test.ts;
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD; pnpm test:db.

Production workflow has not been dispatched. This proves integration, not production truth.
Production read-only receipt and separate authoritative parity remain pending governed merge.
No production DDL, retention, canary, pruning or deletion occurred.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 7004fd4adc1e3c7d121d4aeeca8223e90c996509
