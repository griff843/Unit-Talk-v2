# PROOF: WORK-2026110803

MERGE_SHA: pending merge

> Scaffolded by `ops:lane-start`. Nothing below has been run. Record each command
> actually executed and its real result before review. `post-merge-lane-close.yml`
> binds the merge SHA; never write one here by hand.

Issue: WORK-2026110803
Tier: T1
result: not_run

## ASSERTIONS:

- [x] The sidecar is derived only from the reconciled manifest and carries no Codex telemetry (test: derives the sidecar from the reconciled manifest and invents no telemetry).
- [x] A later PR head advance keeps the reconciliation valid (test: still accepts the reconciliation after the PR head advanced).
- [x] An approval head absent from the PR history is refused (test: refuses when the approval head is not in the PR history).
- [x] Unreconciled, non-Codex, done, missing or altered approval, and conflicting-sidecar cases are refused; an identical sidecar is a no-op (tests: refuses an unreconciled/non-Codex/done lane; missing or altered approval identity; stored approval no longer matches; idempotent and never overwrites).

## EVIDENCE:

Head under test: 79e21f7635a2ddfbe27c3f4c07bcb85815aa18d3. Output below is verbatim from commands run in the lane worktree (selected lines only where noted).

Focused tests: `npx tsx --test scripts/ops/lane-manifest.test.ts scripts/ops/model-routing.test.ts`, lines matching write-reconciled / buildReconciled plus the totals:

```
# Subtest: write-reconciled-sidecar derives the sidecar from the reconciled manifest and invents no telemetry
ok 43 - write-reconciled-sidecar derives the sidecar from the reconciled manifest and invents no telemetry
# Subtest: write-reconciled-sidecar still accepts the reconciliation after the PR head advanced
ok 44 - write-reconciled-sidecar still accepts the reconciliation after the PR head advanced
# Subtest: adversarial: write-reconciled-sidecar refuses when the approval head is not in the PR history
ok 45 - adversarial: write-reconciled-sidecar refuses when the approval head is not in the PR history
# Subtest: adversarial: write-reconciled-sidecar refuses an unreconciled, non-Codex or done lane
ok 46 - adversarial: write-reconciled-sidecar refuses an unreconciled, non-Codex or done lane
# Subtest: adversarial: write-reconciled-sidecar refuses a missing or altered approval identity
ok 47 - adversarial: write-reconciled-sidecar refuses a missing or altered approval identity
# Subtest: write-reconciled-sidecar is idempotent and never overwrites a conflicting sidecar
ok 48 - write-reconciled-sidecar is idempotent and never overwrites a conflicting sidecar
# Subtest: adversarial: write-reconciled-sidecar refuses when the stored approval no longer matches what GitHub returns
ok 49 - adversarial: write-reconciled-sidecar refuses when the stored approval no longer matches what GitHub returns
# Subtest: buildReconciledModelRoutingSidecar carries the manifest unavailable fields and unverified flag
ok 91 - buildReconciledModelRoutingSidecar carries the manifest unavailable fields and unverified flag
# Subtest: buildReconciledModelRoutingSidecar refuses a block that was never reconciled
ok 92 - buildReconciledModelRoutingSidecar refuses a block that was never reconciled
# tests 92
# pass 92
# fail 0
# skipped 0
```

Mutation proof: each mutation was applied to the source, `npx tsx --test scripts/ops/lane-manifest.test.ts` was run, then the source was restored. Output (the `^not ok|^# fail` filter):

```
== M1: drop PR-history check
not ok 45 - adversarial: write-reconciled-sidecar refuses when the approval head is not in the PR history
# fail 1
== M2: verify against current head instead of stored head
not ok 43 - write-reconciled-sidecar derives the sidecar from the reconciled manifest and invents no telemetry
not ok 44 - write-reconciled-sidecar still accepts the reconciliation after the PR head advanced
not ok 45 - adversarial: write-reconciled-sidecar refuses when the approval head is not in the PR history
not ok 48 - write-reconciled-sidecar is idempotent and never overwrites a conflicting sidecar
# fail 4
== M3 rerun (skip authorized_by match and stored-identity equality checks)
not ok 49 - adversarial: write-reconciled-sidecar refuses when the stored approval no longer matches what GitHub returns
# fail 1
== restored
# tests 92
# pass 92
# fail 0
```

`pnpm verify` on commit 01637c26a (before the proof/lane-link commits): `verify:static` ran lint, type-check, build and the unit tests; its final test stage reported `# tests 227`, `# pass 227`, `# fail 0`. `verify:commands` passed. `test:live-db` then stopped at the staging-target assertion, which refuses a local target by design:

```
[command-manifest] Verified 14 command definition(s) against .../apps/discord-bot/command-manifest.json
[check-migration-versions] 139 migration file(s) verified — no duplicate versions.
[lint-migrations] 138 migration file(s) checked — no findings.
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

The live-DB step is deferred to staging CI (Writable DB proof) under the PT1 route-B containment deferral.

## Verification

- `npx tsx --test scripts/ops/lane-manifest.test.ts scripts/ops/model-routing.test.ts`: exit 0, 92 pass, 0 fail (output in EVIDENCE).
- `pnpm verify`: lint, type-check, build and tests passed; stopped at `test:live-db` (local target refused, deferred to staging CI).
- No code files changed after commit 01637c26a; later commits are proof and lane metadata only.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 01637c26a6b53b1ac32fb3a25049c7b712717d02

## Executor verification notes (WORK-2026110803)

- Focused tests: `scripts/ops/lane-manifest.test.ts` + `scripts/ops/model-routing.test.ts` — 92/92 pass (includes the legitimate PR-head-advance case, idempotence, conflicting sidecar, each refusal).
- Mutation proof (each mutation restored afterwards): removing the PR-history check fails "refuses when the approval head is not in the PR history"; verifying against a different head than the stored one fails 4 tests; skipping the reviewer/identity equality checks fails "refuses when the stored approval no longer matches what GitHub returns".
- `pnpm lint`, `pnpm type-check`, `pnpm build`, `pnpm test` (227/227 in the final stage) passed in `pnpm verify`. `pnpm verify` stopped at `test:live-db` / `ci:assert-staging` with `ref=unidentified`: the live-DB step refuses locally and is deferred to staging CI under the PT1 route-B containment deferral.
- No `package.json` change: both test files are already registered in `test:ops`.
