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
- [x] `pnpm test:ops`: 2884 tests, 2884 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/merge-authority.test.ts`: 51 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts`: 77 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/pre-merge-authorization.test.ts`: 49 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/executor-result-validate.test.ts`: 29 pass, 0 fail
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

## Independent review round 2

Four defects closed at this head. Each is stated as what would happen without the fix,
because a control that names no failure it prevents asserts nothing.

- [x] **The ERV bootstrap deadlock (found while verifying, not in review).** The required
      `Executor Result Validation` context is created only by `issue_comment` /
      `workflow_dispatch` runs, and GitHub executes the workflow file for those events from
      the DEFAULT BRANCH — not from the PR head. The PR that first lands RMA is therefore
      judged by main's pre-RMA validator, which rejects any branch outside
      `(claude|codex)/(utv2|uni)-NNN`. Observed live on this PR: *"Invalid Issue ID:
      `<missing>`" / "Invalid branch: claude/rma-v1-risk-scoped-merge-authority"*. No label,
      comment or verdict clears it, and the PR carrying the fix cannot install it before
      being judged by it. `pull_request` is the one event whose workflow file comes from the
      head, so while `scripts/ops/merge-authority.cjs` is absent from the trusted base
      checkout, that run takes the required identity. Once the classifier is on main the
      guard is false forever after and UTV2-1550's one-authoritative-identity rule is
      restored in full.
- [x] **P1 — the sanctioned merge wrapper double-gated the RMA decision.**
      `pre-merge-authorization.ts` resolved a lane-manifest tier and required a pm-verdict
      unless it read T2/T3. An `auto` diff that Merge Gate cleared was still refused at the
      final step, and a mission branch — no tracker id, so no manifest to look up — was
      refused permanently. Merge authority is now decided in exactly one place: a green
      `Merge Gate` on the exact head IS the RMA decision, because the gate itself required
      the CODEOWNERS label and the head-bound verdict before going green. The tier is still
      resolved and recorded in the receipt; it no longer decides anything. This function
      cannot be more permissive than the required check it defers to.
- [x] **P1 — a truncated changed-file list classified as a clean diff.** GitHub's
      List-pull-request-files endpoint stops at 3,000 files however far you paginate, so on
      a larger PR a reserved file can simply be absent from the response and the visible
      subset classify as `auto` in Merge Gate and waive proof in ERV. Both gates now pass
      the PR's own `changed_files` total, and a short list reserves as `unclassifiable`.
- [x] **P2 — a patchless rename skipped content inspection.** GitHub omits `patch` both for
      a 100%-similarity rename (nothing to scan) and for a rename whose accompanying edit is
      too large to return; only the change counts tell those apart. Added `DROP TABLE` in a
      renamed file could therefore reach `auto` when neither path was otherwise reserved. A
      rename is now skipped solely when it reports zero additions and zero deletions;
      anything else, including missing counts, is unclassifiable.

**Declined, on the record: "Keep human approval on every declared Tier C path."** The
ratified instruction for this work is the opposite — *"Do not automatically preserve every
historical Tier C path. The goal is risk-scoped authority, not old tiers under new names."*
`packages/domain`, `packages/contracts` and the lifecycle repositories stay `auto`, asserted
in both directions by test, with the rationale recorded in the policy's `scopeNote`. Every
boundary the PM did name is reserved.

### The bootstrap needed a re-trigger that does not restart CI

Observed on this PR rather than reasoned about. A PHASE 1 run owns the required
`Executor Result Validation` identity and fires on the same `pull_request` event as
`ci.yml`, so it always evaluates while `verify` is still queued: *"CI check is queued, not
completed."* Close/reopen does not resolve it — `reopened` restarts `verify` too, so the
loop cannot converge. Two attempts produced two cancelled CI runs and the same message.

`ci.yml` uses the DEFAULT `pull_request` types, which exclude `labeled`. Adding
`labeled`/`unlabeled` to the ERV workflow gives the required check a re-evaluation trigger
that does not restart CI. The test asserts both halves — ERV listens for it, `ci.yml` does
not — because the escape holds only while `ci.yml` stays on the defaults.

## Independent review round 3

Two P1s, both accepted. Both sit squarely inside the boundary the PM named
("merge authority"); neither is a restoration of historical tiers.

- [x] **Any workflow could mint a required check.** Branch protection binds CONTEXT NAMES,
      not workflows, and a same-repository PR runs its own copy of any workflow it edits.
      With `checks: write` that copy can create a newer, successful check run named `verify`,
      `Executor Result Validation`, `Merge Gate` or `P0 Protocol` — satisfying the very
      contexts that judge it. Reserving only the three workflows that legitimately produce
      those contexts left every other workflow, `ci.yml` included, as a way in.
      `.github/workflows/**` and `.github/actions/**` are now reserved.
- [x] **The sanctioned merge wrapper was `auto`.** The trusted wrapper would therefore merge
      a change that makes the NEXT wrapper return an unconditional authorization, or skip the
      merge mutex, for every subsequent PR. `pre-merge-authorization.ts`, `merge-wrapper.ts`,
      `ops-merge-wrapper.ts`, `merge-mutex.ts`, `truth-check-lib.ts` and
      `executor-result-validate.ts` are now reserved.

`package.json` is deliberately NOT reserved wholesale. Almost every PR edits it to wire a
new test into `test:ops`; reserving the file would make RMA meaningless. A content rule
reserves only lines that define or repoint the merge commands, and a test asserts ordinary
`test:ops` wiring stays `auto`.

### Mutation controls

Each control was applied to the shipped source, the suite run, and the source restored.
Each was caught, and each failed only its own assertions — so no fix carries another's
coverage.

| Mutation | Result |
|---|---|
| truncation guard disabled (`if (false && ...)`) | CAUGHT — 2 fail |
| patchless rename skipped again (`status === 'renamed'` alone) | CAUGHT — 1 fail |
| verdict never required (`return false`) | CAUGHT — 11 fail |
| ERV bootstrap identity removed (event never matches) | CAUGHT — 1 fail |
| only the 3 gate workflows reserved | CAUGHT — 1 fail |
| merge-wrapper-entrypoint content rule removed | CAUGHT — 1 fail |

## Independent review round 4

Three P1s, all accepted. Each is the same defect class: a diff that removes a control
without touching a file the classifier reserves.

- [x] **The required check ran a PR-controlled script.** `.github/workflows/ci.yml:264`
      runs `pnpm verify:static` inside the required `verify` job, resolved from the PR's
      OWN `package.json`. A diff repointing `verify:static` to `true` skipped
      lint / type-check / build / test and still produced a green required context, while
      classifying `auto`. The aggregator keys that job reaches — `verify:static`, `test`,
      `lint`, `type-check`, `build`, `test:command-center`, `ci:db-client-boundary`,
      `env:check` and the rest of the `verify:static` chain — are now frozen by the
      `ci-required-check-entrypoints` content rule.

      The leaf `test:<group>` keys are deliberately NOT frozen: wiring a new test file into
      a group is the ordinary case, and reserving it would make every harness PR a human
      relay. A second rule, `neutered-test-group`, reserves a group redefined to a value
      that invokes no runner at all (`true`, `echo skipped`, `exit 0`). The residual is
      stated rather than hidden: a diff can still delete individual files from a runner's
      argument list and stay `auto`. That change is legible in the diff itself; an emptied
      aggregator is not.

      **Scoping correction.** The unit tests passed on the first draft of these two rules,
      but replaying the last 40 merged PRs through the classifier did not: PR #1469 extends
      `apps/smart-form`'s `test` key with new test files and adds
      `"test:e2e": "playwright test ..."`, and the draft reserved it — freezing exactly the
      ordinary wiring RMA exists to keep automatic. `ci-required-check-entrypoints` is now
      scoped to the ROOT `package.json`, the file the required job actually reads, and the
      complement rule (`neutered-workspace-script`) covers every workspace package with a
      runner allowlist that recognises playwright, vitest, mocha, next and turbo rather than
      `tsx` alone. After the correction #1469 classifies on `auth-and-authorization` alone,
      and 20 of the 40 sampled PRs stay `auto` — the round-4 rules add no human load across
      that sample while still reserving the attack.
- [x] **JSON escapes evaded the entrypoint rule.** `"ops\u003amerge-wrapper"` decodes to
      the key pnpm actually runs, but a regex over the raw patch text sees no colon and
      matches nothing. Content rules now accept `decodeJsonEscapes`, and every added line
      is tested in both its literal and its escape-decoded form.
- [x] **The reserved chain depended on an unreserved file.** `pre-merge-authorization.ts`
      imports `emitJson` from `scripts/ops/shared.ts` and hands it the receipt object
      before deriving the exit code from that same mutable object — so an edit confined to
      `shared.ts` could rewrite an authorization decision while classifying `auto`.
      `scripts/ops/shared.ts` is now part of the `merge-authority` surface.

### Mutation controls (round 4)

| Mutation | Result |
|---|---|
| `decodeJsonEscapes` handling disabled | CAUGHT — 1 fail |
| `ci-required-check-entrypoints` rule removed | CAUGHT — 2 fail |
| `neutered-workspace-script` rule removed | CAUGHT — 2 fail |
| `scripts/ops/shared.ts` unreserved | CAUGHT — 1 fail |
| root entrypoint rule widened past the root package.json | CAUGHT — 1 fail |
| `playwright` dropped from the runner allowlist | CAUGHT — 1 fail |

Each was applied to the shipped source, the suite run, the source restored. Each was
caught, and each failed only its own assertions.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1491
Approved PR head: pending merge
Execution SHA: 2f76b00c72fb23b4757ef9fe9f7e2209ccca6085
