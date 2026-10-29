# Diff summary: WORK-2026102902

Execution SHA: b95b51fb40aeaed90cfe2e39089581471ba9cc67

| File | Change |
|---|---|
| scripts/ops/model-routing.ts | Adds `reconcileObservedModelRouting` and the `DeclaredModelRouting` type, plus `override.declared`. `validatePersistedModelRouting` refuses a reconciled block with `RECONCILED_OBSERVATION`. |
| scripts/ops/model-routing.test.ts | Six tests: the observed values, keeping the first declaration, the no-op refusal, empty fields, sidecar acceptance and rejection through `validatePreMergeModelRoutingEvidence`, and the codex-exec refusal. |
| scripts/ops/lane-manifest.ts | New `reconcile-routing` subcommand: Codex-only, refuses `done` lanes, names every missing flag in one error. |
| scripts/ops/lane-manifest.test.ts | Five tests: the rewrite, missing flags, a done lane, a non-Codex lane, and command routing. |
| docs/05_operations/LANE_MANIFEST_SPEC.md | Section 15.1 documents the command and its limits. |
| docs/05_operations/schemas/lane_manifest_v1.schema.json | Admits `model_routing.override.declared`, which `additionalProperties: false` would otherwise contradict. |

Not changed: `codex-model-routing.json`, `policy_version`, `shared.ts` manifest validation, the proof validators and closeout rebind, the merge gate, workflows, runtime code and schema migrations.
