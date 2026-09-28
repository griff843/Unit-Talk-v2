# Diff summary: WORK-2026092806

| File | Change |
|---|---|
| `.ops/work/WORK-2026092806.md` | Binds the approved governance packet and narrow acceptance contract. |
| `scripts/ops/proof-schema.ts` | Requires `PENDING_POST_DEPLOY` to resolve to authoritative GitHub Live Schema Parity run/job records for the exact evidence head and expected drift-gate failure; retains real production parity PASS as the only post-merge close evidence. |
| `scripts/ops/proof-schema.test.ts` | Tests the valid authoritative receipt and mutations for fabricated IDs, wrong workflow/head, incomplete runs, unrelated failures, malformed markers, and post-merge refusal. |
| `scripts/ops/truth-check-lib.ts` | Lets the close-eligibility consumer inject the same deterministic GitHub receipt resolver used by its mechanical tests; production resolution remains fail-closed. |
| `scripts/ops/truth-check-lib.test.ts` | Proves close eligibility consumes authoritative pending-receipt verification and lane close remains fail-closed. |
| `docs/05_operations/DB_MIGRATION_WORKFLOW.md` | Defines governed non-production candidate proof and mandatory post-deploy production parity. |
| `docs/05_operations/DB_EXECUTION_PLAN.md` | Places the pending obligation before merge and actual parity PASS after sanctioned apply. |
| `docs/05_operations/CLOSEOUT_TRUTH_POLICY.md` | Records that merge eligibility never implies close eligibility for pending parity. |
| `docs/06_status/proof/WORK-2026092806/*` | Exact-source proof, verification record, diff summary, and model-routing provenance. |

## SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: e1db7f7ac347e3a2d8741e036a6f20d329d4c069
