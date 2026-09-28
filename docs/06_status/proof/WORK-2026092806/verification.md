# PROOF: WORK-2026092806

MERGE_SHA: pending merge

Issue: WORK-2026092806
Tier: T1
result: pass (static governance behavior); governed staging DB receipt pending CI

## ASSERTIONS:

- [x] A candidate migration may use `PENDING_POST_DEPLOY` before merge only when GitHub independently confirms the cited run/job belongs to `.github/workflows/live-schema-parity.yml`, targets the exact evidence head, completed with the comparison path green and drift gate failed, and the evidence states `production_ddl_applied: false` plus `post-deploy-before-lane-close`.
- [x] Generic `FAIL`, missing evidence, `SKIP`, fake `PASS`, stale/malformed pending evidence, and pending evidence without exact run/job identity are refused.
- [x] Post-merge lane close refuses `PENDING_POST_DEPLOY`; only a genuine production live-schema-parity `PASS` with exact run/job identity satisfies close.
- [x] Migration roundtrip, refusal/precondition, empty-scratch, and writable staging behavior receipts remain mandatory before merge.
- [x] Existing genuine parity `PASS` evidence and all non-migration proof profiles retain their prior behavior.
- [x] The production parity workflow and PR #1678 retention implementation are unchanged; no DDL was deployed.

## EVIDENCE:

Focused contract suite:

```text
tests 263
pass 263
fail 0
```

PR #1678 receipt fixture, using its real failed parity receipt (`run 36441151899`, `job 108991710221`) and immutable GitHub run/job response shapes:

```text
pre_merge_valid: true
pre_merge_failures: []
fabricated_run_id: refused (migration_schema_parity_receipt_unverified)
fabricated_job_id: refused (migration_schema_parity_receipt_unverified)
wrong_workflow_or_head: refused (migration_schema_parity_receipt_unverified)
unrelated_or_incomplete_failure: refused (migration_schema_parity_receipt_unverified)
post_merge_valid: false
migration_schema_parity_missing: post-merge migration close requires passing production live schema parity with exact run and job ids; PENDING_POST_DEPLOY cannot close a lane
```

Local writable-DB containment:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL. Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

## Verification

- `pnpm exec tsx --test scripts/ops/proof-schema.test.ts scripts/ops/truth-check-lib.test.ts` — PASS (263/263).
- `pnpm type-check` — PASS.
- `pnpm lint` — PASS.
- `git diff --check` — PASS before implementation commit.
- `pnpm verify` — static stages PASS (env check, lint, type-check, build, unit tests, command manifest, migration versions, migration lint); final writable live-DB stage correctly REFUSED by staging identity containment, so the aggregate command exited 1.
- `pnpm test:db` — correctly REFUSED before DB access for the same local target-identity mismatch. The exact-head PR must obtain the governed `staging-ci` receipt; this proof does not convert containment into PASS.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: e1db7f7ac347e3a2d8741e036a6f20d329d4c069
