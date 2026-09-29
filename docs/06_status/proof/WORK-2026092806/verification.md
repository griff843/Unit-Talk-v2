# PROOF: WORK-2026092806

MERGE_SHA: pending merge

Issue: WORK-2026092806
Tier: T1
result: pass (static governance behavior); governed staging DB receipt pending CI

## ASSERTIONS:

- [x] A candidate migration may use `PENDING_POST_DEPLOY` before merge only when GitHub independently confirms the cited run/job belongs to `.github/workflows/live-schema-parity.yml`, targets the exact immutable evidence head, completed with the comparison path green and drift gate failed, and the evidence states `production_ddl_applied: false` plus `post-deploy-before-lane-close`.
- [x] The run is bound to the authoritative repository and PR number; GitHub's mutable PR-head field may advance only through commits whose complete commit-level touched-path history is limited to the lane's proof and bookkeeping files.
- [x] Close Eligibility can recover an absent immutable evidence commit from a depth-1 checkout only by deepening GitHub's authoritative `refs/pull/<number>/head`; it never fetches or trusts a caller-supplied raw SHA.
- [x] An implementation/runtime change after the evidence source is refused even if a later commit reverts it and leaves a clean net diff.
- [x] Generic `FAIL`, missing evidence, `SKIP`, fake `PASS`, stale/malformed pending evidence, and pending evidence without exact run/job identity are refused.
- [x] Post-merge lane close refuses `PENDING_POST_DEPLOY`; only a genuine production live-schema-parity `PASS` with exact run/job identity satisfies close.
- [x] Migration roundtrip, refusal/precondition, empty-scratch, and writable staging behavior receipts remain mandatory before merge.
- [x] Existing genuine parity `PASS` evidence and all non-migration proof profiles retain their prior behavior.
- [x] The production parity workflow and PR #1678 retention implementation are unchanged; no DDL was deployed.

## EVIDENCE:

Focused contract suite:

```text
tests 108
pass 108
fail 0
```

Real shallow-checkout regression, using a `codex/utv2-9000-migration-proof` branch and a bare remote that exposes the candidate only through `refs/pull/1678/head`:

```text
checkout_depth: 1
immutable_evidence_commit_before_validation: absent
authoritative_ref_fetched: refs/pull/1678/head
immutable_evidence_commit_after_validation: present
ancestry_and_proof_only_path_check: pass
```

PR #1678 receipt fixture, using its real failed parity receipt (`run 36471754689`, `job 109095503592`) at immutable evidence source `12e0f4b936586ab86cf2db300c07ccefdcb32c51`, with proof-only descendant `850e30675a993c3bba7e9192326a31b66fbc54c3`:

```text
pre_merge_valid: true
pre_merge_failures: []
fabricated_run_id: refused (migration_schema_parity_receipt_unverified)
fabricated_job_id: refused (migration_schema_parity_receipt_unverified)
wrong_pr_or_repository: refused (migration_schema_parity_receipt_unverified)
wrong_job_run_binding: refused (migration_schema_parity_receipt_unverified)
wrong_workflow_or_head: refused (migration_schema_parity_receipt_unverified)
implementation_after_source: refused (migration_schema_parity_receipt_unverified)
implementation_change_then_revert: refused (migration_schema_parity_receipt_unverified)
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

- `pnpm exec tsx --test scripts/ops/proof-schema.test.ts` — PASS (108/108), including the depth-1 UTV2 migration-lane checkout.
- `pnpm verify:static` — PASS at implementation source `1591c258d681c0a801a9760338e1a2d18c44a690` after the current `main` sync.
- `pnpm type-check` — PASS.
- `pnpm lint` — PASS.
- `git diff --check` — PASS before implementation commit.
- `pnpm verify` — static stages PASS (env check, lint, type-check, build, unit tests, command manifest, migration versions, migration lint); final writable live-DB stage correctly REFUSED by staging identity containment, so the aggregate command exited 1.
- `pnpm test:db` — correctly REFUSED before DB access for the same local target-identity mismatch. The exact-head PR must obtain the governed `staging-ci` receipt; this proof does not convert containment into PASS.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1687
Execution SHA: 1591c258d681c0a801a9760338e1a2d18c44a690
