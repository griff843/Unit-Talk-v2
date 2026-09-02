# PROOF: RMA/v1 — Risk-Scoped Merge Authority

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the ratified pre-merge value; the Execution SHA
> row carries the verified implementation identity. This is a mission-native change: there
> is no lane manifest and no Linear issue, so nothing rebinds this row automatically. It is
> bound after merge by the same `ops:proof-generate --merge-sha` path any bundle uses.

Tier: reserved (merge-authority, production-containment, auth-and-authorization)
Lane type: governance
Proof profile: static
Branch: claude/rma-v1-risk-scoped-merge-authority
PR: https://github.com/griff843/Unit-Talk-v2/pull/1491
result: pass

## Summary

RMA/v1 moves merge authorization from "what tier was this lane admitted at?" to "what does
this diff touch?". Under the tier model every PR resolved to T1, so a typo fix and a
production migration demanded the same human relay — which is the same as reserving
nothing, because it prices the real decisions at zero attention.

This bundle covers the ratified change plus the three P1 findings an independent Codex
review raised against it, all of which were real:

1. **The gate could not bootstrap itself.** Merge Gate and Executor Result Validation load
   the classifier from the PR's BASE checkout. On the one PR that first introduces that
   classifier, base does not have it, the `require()` throws, and the failure was recorded
   as an internal error — a condition no label and no verdict can clear. RMA was landable
   only by a repo-owner override of a required check, which is the single dependency a
   merge-authority control must not have.
2. **A rename escaped the boundary.** GitHub reports a rename as `filename` (destination)
   plus `previous_filename` (source). Only the destination was classified, so
   `git mv .github/CODEOWNERS notes.txt` deleted the ownership boundary in a diff that, read
   by destination alone, touched nothing reserved and classified as `auto`.
3. **The surface list was too narrow.** It reserved six surfaces and left auth/authz
   authority, the distribution gating decision, and the worker delivery implementation on
   the `auto` side.

Finding 3 is resolved by risk, not by restoring the historical Tier C list. Pure logic that
CI can actually judge — `packages/domain`, `packages/contracts`, the lifecycle repositories,
ordinary API services — stays `auto` deliberately, and the policy now records that choice as
a `scopeNote` so a later reader does not reintroduce Tier C under a new name.

## ASSERTIONS:

- [x] The bootstrap degrades to `human`, the MOST restrictive classification — not to
      `auto`, and not to an unclearable internal error. A diff that would classify as `auto`
      is BLOCKED while the classifier is absent from base.
- [x] The bootstrap is clearable by the ordinary reserved-surface artifacts — a CODEOWNERS
      `griff-approved` label AND a head-SHA-bound `pm-verdict/v1` APPROVED comment. No admin
      override of a required check is involved at any point.
- [x] The label alone does not clear the bootstrap; both artifacts are required, exactly as
      for any other reserved diff.
- [x] Only `MODULE_NOT_FOUND` enters the bootstrap path. A malformed or unreadable policy
      still fails closed as an internal error, so corrupting the classifier is not a route to
      a path with weaker checks.
- [x] The bootstrap is one-time and self-limiting: re-entering PHASE 1 requires deleting
      `scripts/ops/merge-authority.cjs` from main, which is itself a change to the
      merge-authority surface and therefore already requires a human.
- [x] Executor Result Validation takes the same bootstrap path and REQUIRES a proof bundle
      when it cannot classify, rather than excusing one — the strictest reading of the
      absence. This bundle exists because that rule applies to this PR.
- [x] Renaming a reserved file to an unreserved name is reserved; renaming an unreserved
      file INTO a reserved path is reserved; an ordinary rename between two unreserved paths
      stays `auto`. Content rules are evaluated against the previous path too, so a `.sql`
      file cannot escape the destructive-SQL scan by being renamed to `.txt`.
- [x] Both required gates pass `previous_filename` to the classifier — asserted against the
      workflow files themselves, not only against the module.
- [x] Auth/authz authority, member-delivery gating (including the distribution decision),
      and the worker delivery implementation are reserved.
- [x] A worker TEST file is NOT reserved. Reserving the worker's tests would price writing a
      regression test at the same attention as changing the delivery path.
- [x] `packages/domain`, `packages/contracts`, the lifecycle repositories and ordinary API
      services remain `auto`, asserted explicitly so a later widening is a visible test
      change rather than a quiet one.
- [x] Three mutation controls reproduce each defect independently.
- [x] `pnpm lint`, `pnpm type-check` and `pnpm test:ops` are green on the execution SHA.

## EVIDENCE:

The defect this bundle's first finding names, measured on this PR rather than inferred —
three consecutive Merge Gate evaluations, every one of them unclearable:

```
$ gh pr view 1491 --json comments
**MERGE GATE: BLOCKED**
- Internal error: Cannot find module
  '/home/runner/work/Unit-Talk-v2/Unit-Talk-v2/scripts/ops/merge-authority.cjs'
```

Targeted suites on the execution SHA:

```
$ pnpm exec tsx --test scripts/ops/merge-authority.test.ts
# tests 43
# pass 43
# fail 0

$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
# tests 74
# pass 74
# fail 0
```

The bootstrap tests are not string assertions about the YAML. They extract the
`github-script` body from `merge-gate.yml`, compile it, and run it against a mocked Octokit
with `require('./scripts/ops/merge-authority.cjs')` throwing `MODULE_NOT_FOUND` — the exact
condition the runner hits — then read the conclusion off the resulting check run.

Mutation control 1 — restore the pre-fix rename behavior (`filePaths` returns only
`file.filename`):

```
$ pnpm exec tsx --test scripts/ops/merge-authority.test.ts
not ok 32 - renaming a reserved file to an unreserved name is still reserved
not ok 34 - renaming the gate workflow out of .github/workflows is reserved
not ok 36 - a content rule is evaluated against the previous path too
# pass 40
# fail 3
```

Mutation control 2 — restore the pre-fix bootstrap behavior (rethrow instead of entering
PHASE 1):

```
$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
not ok 69 - RMA bootstrap: a base checkout without the classifier reserves the merge as human, it does not release it
not ok 70 - RMA bootstrap: the CODEOWNERS label plus a head-bound verdict clears it — no admin override needed
not ok 71 - RMA bootstrap: the label alone does not clear it
not ok 72 - RMA bootstrap: only MODULE_NOT_FOUND takes the bootstrap path
# pass 70
# fail 4
```

Mutation control 3 — remove the `auth-and-authorization` surface from the shipped policy:

```
$ pnpm exec tsx --test scripts/ops/merge-authority.test.ts
not ok 37 - auth and authorization authority is reserved
# pass 42
# fail 1
```

Each control fails on the condition its assertion names and on no other, so no one of the
three fixes is carrying another's coverage.

Classification dry-run over every open PR, run through the real classifier against real
`pulls.listFiles` payloads — the widened policy in practice:

```
 1497 auto   -                                        docs(mission): reconcile the plan
 1496 human  secrets                                  feat(deploy): deploy the operator console
 1495 auto   -                                        fix(verify-semaphore): claim the slot
 1494 human  destructive-sql                          harden(command-center): management token
 1493 auto   -                                        fix(command-center): a dot in the path
 1492 auto   -                                        harness: recalibrate the agent environment
 1491 human  merge-authority,destructive-sql          governance: RMA/v1
 1488 human  auth-and-authorization                   UTV2-1824: resolve capper identity
 1485 auto   -                                        UTV2-1825: bind the pre-merge placeholder
 1484 auto   -                                        feat(ops): UTV2-1773 canonical reference
 1479 auto   -                                        UTV2-1815: refuse unknown stake
 1477 human  production-ddl-and-data,destructive-sql  UTV2-1811: shared rate-limit DB contract
 1474 auto   -                                        UTV2-1789: Command Center env auth
 1451 human  production-ddl-and-data,destructive-sql  UTV2-1736: offer_history partitioning
 1429 auto   -                                        chore(governance): de-pin subagent models
```

That table was produced before `apps/command-center/src/middleware.ts` was added to the auth
surface. Re-run at the execution SHA:

```
1474 human auth-and-authorization
1488 human auth-and-authorization
1492 auto  -
```

so the shipped policy is 8 auto / 7 human across the open board. Both movers are the
substance of the third finding: #1488 (capper identity resolution) and #1474 (Command
Center deployed-environment authentication) were each authorizable on green CI before this
change, and neither is a diff whose correctness a test suite can vouch for — the tests that
would catch a weakened authz check are the same tests such a change edits.

## Verification

- [x] `pnpm lint`: pass (silent)
- [x] `pnpm type-check`: pass (silent)
- [x] `pnpm test:ops`: 2871 tests, 2871 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/merge-authority.test.ts`: 43 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts`: 74 pass, 0 fail
- [x] Both workflow files parse as YAML after editing (`yaml.safe_load`)
- [ ] `pnpm verify` end-to-end: not obtainable off-CI — the final `test:live-db` step is
      refused by the fail-closed staging guard on a host with no staging identity. The
      authoritative receipt is the required `verify` context on this PR head.

## Runtime Verification

This is a `static`-profile governance change. It alters merge authorization only: no runtime
service, no database, no migration, no deployment surface, no delivery path is touched.
There is no live-DB behaviour to observe, and the writable-DB receipt is produced inside the
required `verify` context rather than asserted from proof text.

The behaviour that IS in scope — what the gate does when it cannot load its classifier — is
measured by executing the real workflow script under that exact condition, not by reading it.

## Containment

No production DDL, database mutation, deployment, ingestion, delivery, provider
resubscription or branch-protection change.

No gate is loosened. Every change here is in the restrictive direction: the bootstrap turns
an unclassifiable diff into a `human` reservation rather than an internal error, renames now
reserve on two paths instead of one, ERV demands proof where it previously could not decide,
and the surface list grew. The one intentional relaxation is the ratified premise of RMA
itself — that a diff touching no reserved surface is authorized on green CI — which is what
this PR is for and what the human approval on it authorizes.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1491
Approved PR head: pending merge
Execution SHA: fadd598e8c66495207c28e47bd0d70cd9b086853
