# Diff summary: WORK-2026102902

Execution SHA: 01090aa0f82baa722398b5ad801af5f14090b176

| File | Change |
|---|---|
| scripts/ops/model-routing.ts | Adds `verifyRoutingApproval` (pm-verdict/v1 APPROVED by a CODEOWNERS non-bot author on the lane's PR at its head, with placement checked against GitHub's `issue_url` and the comment URL, naming the exact routing) and `reconcileObservedModelRouting` (observed vs unavailable, unverified-external-session flag, original declaration kept). The pre-merge sidecar contract enforces the flag, unavailable fields and authorizer on a reconciled lane. `validatePersistedModelRouting` refuses a reconciled block. |
| scripts/ops/model-routing.test.ts | Reconciliation, unavailable sentinel, adversarial approvals and fabricated sidecars, codex-exec refusal. |
| scripts/ops/lane-manifest.ts | `reconcile-routing` subcommand: fetches the approval comment and the PR head from GitHub, and takes no caller-supplied authorizer. |
| scripts/ops/lane-manifest.test.ts | Command path with a fake GitHub: recorded reviewer, forged approval, missing and conflicting flags, refused lane states. |
| docs/05_operations/LANE_MANIFEST_SPEC.md | Section 15.1 documents the command and its limits. |
| docs/05_operations/schemas/lane_manifest_v1.schema.json | Admits `override.declared`, `override.observation` and `override.approval`. |

Not changed: `codex-model-routing.json`, `policy_version`, `shared.ts` manifest validation, the closeout rebind (`proof-generate.ts`), the merge gate and `merge-gate-verdict.cjs` (reused, not modified), workflows, runtime code and schema migrations. `validatePreMergeModelRoutingEvidence` changed only for reconciled lanes.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1801
