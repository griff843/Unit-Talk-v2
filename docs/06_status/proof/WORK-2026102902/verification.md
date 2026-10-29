# PROOF: WORK-2026102902

MERGE_SHA: pending merge

Issue: WORK-2026102902
Tier: T1
Lane type: governance
Execution SHA: `b95b51fb40aeaed90cfe2e39089581471ba9cc67`
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] `reconcileObservedModelRouting` writes the observed profile, model and reasoning effort as a `manual-override` block, keeps `policy_version`, and keeps the lane-start routing under `override.declared`. A second reconciliation keeps the first declaration (`model-routing.test.ts`).
- [x] It refuses a no-op and names every empty field (`model-routing.test.ts`).
- [x] A reconciled manifest accepts a sidecar that records the observed model with `override_used: true` and a matching `override_authorized_by`, and rejects a sidecar matching the original declaration (`validatePreMergeModelRoutingEvidence`).
- [x] `validatePersistedModelRouting` refuses a reconciled block with `RECONCILED_OBSERVATION`, even when the observed values match an enabled policy profile, so codex-exec cannot run a reconciled lane.
- [x] `ops:lane-manifest reconcile-routing` rewrites a started Codex manifest. It refuses a `done` lane and a non-Codex lane, and names every missing flag in one error (`lane-manifest.test.ts`).
- [x] No policy file, policy version, proof validator, closeout rebind, merge gate, workflow, runtime or schema-migration path changed.

## EVIDENCE:

Focused suites on the execution SHA:

```text
pnpm exec tsx --test scripts/ops/model-routing.test.ts scripts/ops/lane-manifest.test.ts scripts/ops/codex-exec.test.ts scripts/ops/proof-generate.test.ts scripts/ops/shared.test.ts scripts/ops/lane-start.test.ts
pass 436
fail 0
```

Ops aggregate:

```text
pnpm test:ops
tests 3716
pass 3706
fail 0
skipped 10
```

Mutation checks. Each guard was disabled, `model-routing.test.ts` was run, and the file was restored:

```text
M1 no-op refusal removed      -> not ok "reconcileObservedModelRouting refuses a no-op"            (fail 1)
M2 override.declared dropped  -> not ok "records the observed routing and keeps the declaration",
                                 not ok "codex-exec refuses a reconciled lane ..."                  (fail 2)
M3 codex-exec refusal removed -> not ok "codex-exec refuses a reconciled lane ..."                  (fail 1)
```

## Verification

- [x] Focused suites: 436 pass, 0 fail.
- [x] `pnpm test:ops`: 3706 pass, 0 fail, 10 skipped.
- [x] `pnpm type-check`: exit 0.
- [x] `pnpm lint` scope (eslint on the four changed scripts): exit 0.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head b95b51fb40aeaed90cfe2e39089581471ba9cc67`: PASS. 10 changed files, no matching rules, no artifacts required.
- [ ] `pnpm test:db`: deferred to the protected `staging-ci` environment. The required `verify` check runs "Writable DB proof (staging only)". Staging credentials are not held locally, and no production database was accessed.
- [ ] `pnpm verify` in CI on the PR head: pending.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
