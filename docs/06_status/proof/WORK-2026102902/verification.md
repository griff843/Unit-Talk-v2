# PROOF: WORK-2026102902

MERGE_SHA: pending merge

Issue: WORK-2026102902
Tier: T1
Lane type: governance
Execution SHA: `3af5aada24ba425b849cc4c0b227093dce6e1a0e`
result: local_static_pass_staging_deferred

Revision: bounded correction for PM review comment 6511391881 (CHANGES REQUIRED at 81875e18).

## ASSERTIONS:

- [x] (1) Observed versus unavailable. `--reasoning-effort-unavailable` records `reasoning_effort: "unavailable"` and `override.observation.unavailable_fields: ["reasoning_effort"]`. The sentinel cannot be passed as an observed value, and a reported effort records no unavailable fields (`model-routing.test.ts`).
- [x] (2) Unverified flag. Every reconciliation records `override.observation.verification: "unverified-external-session"` and its `source`. On a reconciled lane, `validatePreMergeModelRoutingEvidence` rejects a sidecar that drops the flag or claims `verified`, claims an exact effort the manifest records as unavailable, or names a different authorizer. `codex-exec` refuses a reconciled lane (`RECONCILED_OBSERVATION`).
- [x] (3) Authorization boundary. There is no caller-supplied authorizer: `--authorized-by` and `--reason` are removed. `--approval-comment` is fetched from GitHub and must be a `pm-verdict/v1` `APPROVED` verdict, parsed by the merge gate's own `merge-gate-verdict.cjs`, that meets all of these:
  - its author is a CODEOWNERS reviewer and not a bot;
  - it is on the lane's own PR (from `pr_url`);
  - its `Issue:`, `PR:` and `Head SHA:` match the lane and the PR's current head;
  - it contains the exact line `Routing reconciliation: <model> / <effort or unavailable>`.

  `authorized_by` is the author GitHub reports.
- [x] Adversarial tests refuse each of these approvals: a forged author, a bot, a null user, a body that is not a verdict, `CHANGES_REQUIRED`, a wrong issue, a wrong PR, a stale head, a wrong effort and a wrong model. A forged `--authorized-by` flag has no effect, and the manifest stays unchanged after each refusal. Fabricated sidecars fail against a reconciled manifest.
- [x] The original declaration is kept in `override.declared`, and a second reconciliation keeps the first one. No-ops, missing flags (all named at once), both effort flags together, `done` lanes, lanes without a PR and non-Codex lanes are refused.
- [x] No policy file, policy version, closeout rebind, merge gate, workflow, runtime or migration path changed.

## EVIDENCE:

Focused suites on the execution SHA:

```text
pnpm exec tsx --test scripts/ops/model-routing.test.ts scripts/ops/lane-manifest.test.ts scripts/ops/codex-exec.test.ts scripts/ops/proof-generate.test.ts scripts/ops/shared.test.ts scripts/ops/lane-start.test.ts scripts/ops/pre-merge-authorization.test.ts
pass 497
fail 0
```

Ops aggregate:

```text
pnpm test:ops
tests 3720
pass 3710
fail 0
skipped 10
```

Mutation checks. Each guard was disabled, `model-routing.test.ts` and `lane-manifest.test.ts` were run, and the file was restored (verified with cmp):

```text
M1 CODEOWNERS reviewer check removed      -> fail 2 (both adversarial approval tests)
M2 "Routing reconciliation" line removed  -> fail 2 (both adversarial approval tests)
M3 head-SHA binding removed               -> fail 1 (adversarial approval test)
M4 sidecar unverified-flag check removed  -> fail 1 (adversarial sidecar test)
M5 unavailable-sentinel refusal removed   -> fail 1 (sentinel test)
M6 codex-exec refusal removed             -> fail 1 (codex-exec test)
M7 no-op refusal removed                  -> fail 1 (no-op test)
```

## Verification

- [x] Focused suites: 497 pass, 0 fail.
- [x] `pnpm test:ops`: 3710 pass, 0 fail, 10 skipped.
- [x] `pnpm type-check`: exit 0.
- [x] `pnpm exec eslint` on the four changed scripts: exit 0. The repo-wide `pnpm lint` runs in CI.
- [x] Mutation checks: 7 of 7 caught.
- [ ] `pnpm test:db`: deferred to the protected `staging-ci` environment. The required `verify` check runs "Writable DB proof (staging only)". No production database was accessed.
- [ ] `pnpm verify` in CI on the new PR head: pending.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1801
