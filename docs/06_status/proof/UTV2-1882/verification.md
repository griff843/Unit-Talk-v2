# PROOF: UTV2-1882

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-10T22:22:05.000Z
Issue: UTV2-1882
Tier: T1
Lane type: runtime
Branch: claude/utv2-1882-erv-work-namespace
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1560
Head SHA: 53eecffab9de8a4185534c26556741e656147423
result: pass

## ASSERTIONS:

- [x] Both copies of the identifier rules admit `WORK-###` / `work-` alongside `UTV2`/`UNI`, and the drift tests still bind them byte-identically.
- [x] A valid `WORK-###` issue ID and a `codex/work-###-*` branch pass, asserted end to end through `validateExecutorResultFields`.
- [x] Malformed identifiers remain rejected, each asserted against the specific rule it breaks: `WORK`, `WORK-`, `WORK-abc`, `WORK-12a`, `xWORK-12`, `WORKS-12`, `FOO-123`, `""`; branches `codex/work-x`, `codex/work`, `codex/works-1-x`, `foo/work-1-x`, `work-1-x`, `x/codex/work-1`.
- [x] An **absent** issue ID still fails — the widening admits a namespace, not an omission.
- [x] The three binding controls still fail on the condition each names: `Branch:` == PR head ref, declared PR == actual PR, declared head SHA == current head.
- [x] No change to required-check configuration, branch protection, CODEOWNERS, the merge gate, tier semantics or approval policy.
- [x] The widening is non-vacuous in both directions: something is newly admitted **and** something is still refused.

## EVIDENCE:

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
exit 0

$ pnpm test
100 test files reported "# fail 0"; 0 test files reported a failure

$ pnpm exec tsx --test scripts/ops/executor-result-validate.test.ts
# tests 35
# pass 35
# fail 0

$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
# pass 66
# fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff

$ mutation drill (each mutation applied alone, then reverted)
revert ONLY the workflow inline copy (the copy that gates merges) -> # pass 34 # fail 1
revert ONLY the exported script copy                              -> # pass 31 # fail 4
over-widen to /^([A-Z0-9]+)-\d+$/i so FOO-1 is admitted           -> # pass 32 # fail 3
delete the Branch == head-ref binding                             -> # pass 33 # fail 2
baseline (unmutated)                                              -> # pass 35 # fail 0
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: 100 test files green, 0 failed
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS
- [x] `pnpm verify`: completed by CI on this PR. It cannot exit 0 on a contained workstation because `ci:assert-staging-target` refuses the containment placeholder; the required `verify` check on PR #1560 is the authority, and `Writable DB proof (staging only)` supplies the T1 live-DB evidence deferred by `t1_live_db_precondition: deferred_to_ci`.

## Runtime Verification

This lane changes CI validator identifier rules only. No file under `apps/**` or `packages/**`
is touched, so no deployed service behaviour changes and no runtime surface is exercised.
Containment is unaffected: `SYNDICATE_MACHINE_MODE` stays `parked`, member-facing delivery stays
disabled, and every Track Only guard is unchanged.

The behavioural claim that *is* runtime-relevant — that the required `Executor Result Validation`
check admits `WORK-###` after this lands — is deliberately **not** asserted here, because it
cannot be true until this is on `main`. The validator runs from trusted `main` by design
(checkout pinned to `github.event_name == 'pull_request' && github.event.pull_request.base.sha ||
github.sha`). Its non-secret success criterion is stated on the PR: re-dispatching
`Executor Result Validation` on PR #1556 produces a green required context with no other change
to that PR.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1560
Approved PR head: pending merge
Execution SHA: 53eecffab9de8a4185534c26556741e656147423
