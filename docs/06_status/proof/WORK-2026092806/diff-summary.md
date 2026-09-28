# Diff summary: WORK-2026092806

| File | Change |
|---|---|
| `.ops/work/WORK-2026092806.md` | Binds the approved governance packet and narrow acceptance contract. |
| `scripts/ops/proof-schema.ts` | Adds the strict pre-merge `PENDING_POST_DEPLOY` migration-parity obligation while retaining real production parity PASS as the only post-merge close evidence. |
| `scripts/ops/proof-schema.test.ts` | Tests valid pending evidence, malformed/generic refusal, and post-merge refusal. |
| `scripts/ops/truth-check-lib.test.ts` | Proves close eligibility is phase-aware and lane close remains fail-closed. |
| `scripts/ops/lane-link-pr.ts` | Preserves an already-authorized T1 staging-CI obligation when exact-head PR linking reconstructs an expired token. |
| `scripts/ops/lane-link-pr.test.ts` | Proves token recovery preserves but cannot invent the manifest-authorized obligation. |
| `docs/05_operations/DB_MIGRATION_WORKFLOW.md` | Defines governed non-production candidate proof and mandatory post-deploy production parity. |
| `docs/05_operations/DB_EXECUTION_PLAN.md` | Places the pending obligation before merge and actual parity PASS after sanctioned apply. |
| `docs/05_operations/CLOSEOUT_TRUTH_POLICY.md` | Records that merge eligibility never implies close eligibility for pending parity. |
| `docs/06_status/proof/WORK-2026092806/*` | Exact-source proof, verification record, diff summary, and model-routing provenance. |

## SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 170039b84878d7ca88578464d2db4ba696c46308
