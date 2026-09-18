# PROOF: UTV2-1934

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries the
> verified implementation identity. `post-merge-lane-close.yml` rebinds merge authority only
> after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-18T14:25:00.000Z
Issue: UTV2-1934
Tier: T3
Lane type: governance
Branch: claude/utv2-1934-startup-context-containment-truth
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1605
Head SHA: bfed688855be2e0fc5d84076811cdc03cd6e6ff8
Execution SHA: bfed688855be2e0fc5d84076811cdc03cd6e6ff8
Diff base: 3a07f41b0a09fddb924e964e255e16b6c8e0a80b
result: pass

## ASSERTIONS:

Documentation-only lane. Every box below is a claim about the *content* of the diff, checkable by
reading the diff or re-running the measurement it cites.

- [x] `main` is `3a07f41b0`, not the `17b3f964f` the previous edition asserted.
- [x] Drift `deployed..main` is 11 commits / 36 files, not 6 / 32, and the text instructs the
      reader to re-run the command rather than quote the figure.
- [x] Open PRs is 10, not 11.
- [x] No lane manifest on `main` is in a non-terminal state. The three lanes the previous edition
      listed as "parked" have no manifest at all — they are tracker state, not lane state.
- [x] `ingestor_health` is genuine containment; `worker_outbox_health` is not. The two are
      described separately, with the mechanism for each.
- [x] The 32 stranded rows are explicitly recorded as not to be deleted, and the repair's owning
      lane is named.
- [x] The provider-sequencing directive is recorded, with the provider-dependent dimensions (2,
      3, 6, and one of Dimension 4's two metrics) separated from the provider-independent ones
      (1, 5, and Dimension 4's second metric).
- [x] §5 decision 2 is marked owner-deferred rather than left standing as a live ask.
- [x] Dimension 5's FAIL verdict is preserved while its stale reason is corrected.
- [x] No readiness threshold is introduced or altered anywhere in the diff.
- [x] No containment setting, workflow, kill switch, delivery target, schema or source file is
      touched. The diff is confined to `docs/` and `.ops/`.
- [x] `docs/mission/intent.md` — the Griff-owned file — is not in the diff.

## EVIDENCE:

```
$ pnpm verify
> verify:static  ..................................  PASS
  lint          eslint .                            exit 0, no output
  type-check    pnpm exec tsc -b tsconfig.json       exit 0, no diagnostics
  test          node:test + tsx --test
                # suites 23
                # pass 206
                # fail 0
                # cancelled 0
                # skipped 0
                # todo 0
> verify:commands ................................  PASS
  [command-manifest] Verified 14 command definition(s)
  [check-migration-versions] 136 migration file(s) verified - no duplicate versions.
  [lint-migrations] 135 migration file(s) checked - no findings.
> test:live-db  ..................................  REFUSED (expected)
  [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
  [assert-staging] REFUSED: target identity could not be resolved from its URL.
                   Writable DB verification requires xskgrzbteyqdufktjrjx.
```

`pnpm verify` cannot exit 0 from a developer checkout on this repository: `ci:assert-staging`
refuses any target that is not the staging project. That refusal is deliberate staging-isolation
containment, not a defect in this diff, and it is the correct local outcome. The authoritative
full-tree result is the required `verify` context on the PR, which runs inside the `staging-ci`
GitHub environment.

## Verification

| Command | Exit | Result |
|---|---|---|
| `pnpm lint` | 0 | pass — `eslint .`, no output |
| `pnpm type-check` | 0 | pass — `tsc -b tsconfig.json`, no diagnostics |
| `pnpm test` | 0 | pass — 23 suites, **206 pass / 0 fail**, 0 skipped |
| `pnpm verify` | 1 | `verify:static` and `verify:commands` pass; `ci:assert-staging` refuses a non-staging target, by design |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | 0 | `Verdict: PASS` — 5 changed files, `Rules matched: (none)` |

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 5
Rules matched: (none) - no R-level artifacts required for this diff
```

## Runtime Verification

Not applicable, and deliberately so. This lane changes no executing code, so there is no runtime
behaviour to prove. What it does change is what a *session* believes at startup, and that was
verified by measurement rather than by execution: every corrected figure in §1 was read from the
GitHub API, from the lane manifests on `main`, or from production, at this head. The measurements
and their sources are tabulated in `diff-summary.md`.

The one claim that could not be established by reading a document — that `worker_outbox_health`
is not containment — was established from the readiness ledger's own payload, which records the
worker heartbeat as succeeded in the same object as the dimension failure.

## STOP CONDITIONS ENCOUNTERED:

- **Dispatching a production deployment remains reserved.** The drift this lane re-measures is
  surfaced, not acted on.
- **The provider decision is owner-deferred, not blocked.** No work in this lane attempts to
  activate, verify, replace or route around the provider.

## Sign-off

Verifier Identity: Claude Opus 5 (1M context), acting as execution orchestrator
Date: 2026-09-18
Commit SHA(s): bfed688855be2e0fc5d84076811cdc03cd6e6ff8
Related PRs: https://github.com/griff843/Unit-Talk-v2/pull/1605

Merge authority for this T3 lane is green required CI on the merge SHA plus a valid executor
result. Nothing in this bundle self-certifies Done; the done-gate is `ops:truth-check`.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1605
Approved PR head: pending merge
Execution SHA: bfed688855be2e0fc5d84076811cdc03cd6e6ff8
