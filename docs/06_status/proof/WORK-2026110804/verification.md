# PROOF: WORK-2026110804

MERGE_SHA: pending merge

> Scaffolded by `ops:lane-start`. Nothing below has been run. Record each command
> actually executed and its real result before review. `post-merge-lane-close.yml`
> binds the merge SHA; never write one here by hand.

Issue: WORK-2026110804
Tier: T1
result: not_run

## ASSERTIONS:

- [x] AC1: with `OPERATING_MODEL` unset or not `lean`, every touched workflow runs its legacy path (tests: bootstrap: with the flag unset the module is never loaded (lazy) and legacy runs unchanged; gate matrix: legacy T1 is evaluated by the unchanged legacy logic (flag=legacy / flag unset); Risk Class / Independent Review: not applicable for legacy).
- [x] AC2: lazy, `MODULE_NOT_FOUND`-guarded load; any other load error fails closed (tests: bootstrap: every require of operating-model.cjs is lazy and MODULE_NOT_FOUND-guarded; bootstrap (adversarial): base without operating-model.cjs + OPERATING_MODEL=lean => pure legacy in every workflow; bootstrap: a module that exists but throws for another reason fails closed).
- [x] AC3: Standard allow-list, everything else Protected, sticky `RISK-CLASS: PROTECTED` (tests: classify (adversarial): every sensitive or unknown path is Protected; classify: every merge-risk.ts Tier C exact path and prefix is Protected (parity); escalation: RISK-CLASS: PROTECTED from a trusted reviewer is sticky across heads and sources).
- [x] AC4: Independent Review passes only on the anchored head-bound clean summary; a P0/P1 at a head blocks that head (tests: review: passes only on the anchored connector summary bound to the exact head; review (adversarial P1-c): a bare bot review object never passes; review (adversarial P1-d): any finding at head H blocks H).
- [x] AC5: lean Protected still needs `t1-approved` plus a head-bound `pm-verdict/v1` (tests: lean gate: Protected (or any unknown class) additionally needs t1-approved and a head-bound pm-verdict; gate matrix: lean Protected requires t1-approved and a head-bound pm-verdict in addition to review).
- [x] AC6: runbook present; this lane sets no repository variable and changes no branch protection (only references to `vars.LEAN_MODE_ACTIVATED_AT` and docs exist in the diff).
- [x] AC7: focused tests and `test:ops` pass on the lane head.

## EVIDENCE:

Head under test: 212c813ea44574fdce9e49910b765caa679e05cf (lane worktree, branch `claude/work-2026110804-lean-mode`). Commits were ported from local `scratch/lean-impl` (`76efb7df6`, `98c9bf6a8`, `bf126e4ab`) onto `main` at `a82fd3b16` by clean cherry-pick, with no conflicts.

`npx tsx --test scripts/ops/operating-model.test.ts` totals:

```
# tests 32
# pass 32
# fail 0
```

`npx tsx --test scripts/ops/operating-model-workflows.test.ts` totals:

```
# tests 34
# pass 34
# fail 0
```

`npx tsx --test scripts/ops/workflow-hardening.test.ts` totals:

```
# tests 99
# pass 99
# fail 0
```

`pnpm test:ops` totals:

```
# tests 3855
# suites 21
# pass 3845
# fail 0
# cancelled 0
# skipped 10
# todo 0
```

## Verification

- `npx tsx --test scripts/ops/operating-model.test.ts`: 32/32 pass, exit 0
- `npx tsx --test scripts/ops/operating-model-workflows.test.ts`: 34/34 pass, exit 0
- `npx tsx --test scripts/ops/workflow-hardening.test.ts`: 99/99 pass, exit 0
- `pnpm test:ops`: 3855 tests, 3845 pass, 0 fail, 10 skipped, exit 0
- `pnpm lint`: exit 0
- `pnpm type-check`: exit 0
- `pnpm ops:preflight WORK-2026110804 --tier T1 ...`: VERDICT PASS (42 checks). PB1 `pnpm type-check` and PB2 `pnpm test` passed on `main` + the work order. PT1 reported BLOCKED_BY_CONTAINMENT, and the token records `t1_live_db_precondition: deferred_to_ci` under the ratified PT1 route B (`docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md`).
- Not run locally: `pnpm test:db` and runtime proof. This lane has no runtime or DB path. The live-DB precondition is deferred to exact-head CI under route B.

### `pnpm verify` (2026-11-11, after syncing main)

Run on 42b345f69311bf86aca19f68934d6363f0b80f90, which merges origin/main 0033d3a1e9ab9cdc8c221d7bf3743c242c7744f6 into the lane head d75e1d8cbcea48c79d13d3246b6dee6148275341 via `ops:merge-wrapper git-merge-main` (no rebase, no history rewrite).

- env check, lint, type-check and build: passed.
- Unit tests: 8232 tests, 8219 pass, 0 fail (the remaining 13 are skipped or todo).
- `verify:commands`: the command manifest checked 14 definitions; 139 migration versions, no duplicates; migration lint, 138 files, no findings.
- `test:live-db`: refused locally, as designed: `[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.` Because of that refusal, `pnpm verify` exited 1. This step runs only against staging through the staging-ci GitHub environment, and the exact-head CI staging DB proof (concurrency group `staging-ci-db`) covers it.
- The Smart Form e2e step was skipped (`UNIT_TALK_SMART_FORM_E2E` not set). This lane does not touch Smart Form.

### Review fixes (2026-11-11, Codex P1 and P2)

Code commit: 7c381405c36bbd59322f750fb30fbdbf6a721417 (parent 62e3062230044427c37cfa27eac8ff409f2d8074). Commands run locally on that tree:

- P1: in armed lean mode, `required-check-refresh.yml` treats a trusted reviewer's `RISK-CLASS: PROTECTED` issue comment as a refresh signal and reruns Merge Gate, Executor Result Validation, Risk Class (new `risk` target, `risk-class.yml`) and Independent Review. Trust uses `isTrustedReviewerEscalation` from `operating-model.cjs`, the same predicate `reviewerRequestsProtected` applies during classification. Untrusted commenters trigger nothing. Legacy and unset modes do not load the module and behave as before.
- P2: `REVIEW_THREADS_QUERY` reads `pageInfo { hasNextPage }` on each thread's nested comments. When a thread has another page, or pageInfo is missing, `collectIndependentReviewInputs` throws, so classification, Independent Review and Merge Gate all fail closed.
- `npx tsx --test scripts/ops/operating-model.test.ts`: 34/34 pass, exit 0
- `npx tsx --test scripts/ops/operating-model-workflows.test.ts`: 38/38 pass, exit 0
- `npx tsx --test scripts/ops/workflow-hardening.test.ts`: 99/99 pass, exit 0
- `pnpm test:ops`: 3861 tests, 3851 pass, 0 fail, exit 0
- `pnpm lint`: exit 0
- `pnpm type-check`: exit 0

Follow-up commit 7275cc470aa0783f7fb0ffe3fbdc91362edad7de (notes 1 and 2):

- Note 1: in lean mode, a completed Independent Review workflow_run now reruns Independent Review, Merge Gate, Executor Result Validation and Risk Class, in that order. Before this change it reran only the first two, so an escalation in a review body or review-thread comment left Executor Result Validation and Risk Class stale. Legacy and unset modes are unchanged; that signal is still a no-op there.
- Note 2: escalation-comment targets now run in the order Merge Gate, Executor Result Validation, Independent Review, Risk Class. Risk Class is still required, so a missing run still fails the job closed, but only after every other rerun has been requested.
- `npx tsx --test scripts/ops/operating-model.test.ts`: 34/34 pass, exit 0
- `npx tsx --test scripts/ops/operating-model-workflows.test.ts`: 39/39 pass, exit 0
- `npx tsx --test scripts/ops/workflow-hardening.test.ts`: 99/99 pass, exit 0
- `pnpm test:ops`: 3862 tests, 3852 pass, 0 fail, 10 skipped, exit 0
- `pnpm lint`: exit 0
- `pnpm type-check`: exit 0

Follow-up commit 61aefdf82f04de51a31b285c2c36eb960da0a134 (review-input event audit):

- Inline review-thread comments (`pull_request_review_comment` created, edited, deleted) now run the read-only Independent Review workflow. In lean, its `workflow_run` reruns Independent Review, Merge Gate, Executor Result Validation and Risk Class.
- Issue comments now also subscribe to `deleted`. In lean, editing or deleting a comment authored by a trusted reviewer login reruns the same four checks. Legacy mode ignores deletions.
- Review-thread resolve/unresolve has no Actions event, so it is documented as a known limit in `LEAN_MODE_ACTIVATION.md`.
- `npx tsx --test scripts/ops/operating-model.test.ts`: 35/35 pass, exit 0
- `npx tsx --test scripts/ops/operating-model-workflows.test.ts`: 43/43 pass, exit 0
- `npx tsx --test scripts/ops/workflow-hardening.test.ts`: 99/99 pass, exit 0
- `pnpm test:ops`: 3867 tests, 3857 pass, 0 fail, 10 skipped, exit 0
- `pnpm lint`: exit 0
- `pnpm type-check`: exit 0

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 212c813ea44574fdce9e49910b765caa679e05cf
