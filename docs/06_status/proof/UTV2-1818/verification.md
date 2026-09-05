# PROOF: UTV2-1818

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1818
Tier: T2
Lane type: governance
Proof profile: static
Branch: claude/utv2-1818-approval-carry-forward
Head SHA: edf6554a6d2b4bf4f9dd5277fe05aad48d7193f3
result: pass

## Summary

`scripts/ops/approval-carry-forward.ts` is a pure, read-only verifier answering one question: has a
PM approval pinned to an earlier head SHA remained *factually* applicable at the current head?

It is not an approval and never becomes one. It carries forward a PM decision that already exists
and asserts nothing about the implementation. The original `pm-verdict/v1` comment is never edited,
deleted or superseded, and every rendered receipt ends with a sentence stating it is not an
independent PM review.

**The receipt is an OUTPUT, never an INPUT.** A caller must recompute every condition itself and
then emit the receipt; nothing may accept a receipt supplied as a comment, file or workflow input.
If a posted receipt were ever treated as evidence, any actor with comment access could forge one.
The module performs no network call, writes no file and mutates nothing — all evidence is injected,
which is what makes each condition testable against the exact case it names.

This lane changes no gate. The `.github/workflows/merge-gate.yml` call site is a reserved surface
(`docs/mission/intent.md`, reserved decision 7) and is deliberately excluded from this PR.

Every value below was generated from the artifact by running the named command, not written from
recollection.

## ASSERTIONS:

- [x] A1 — no file changed outside the declared `file_scope_lock` and this lane's own control-plane paths
- [x] A2 — no workflow, hook, gate, CODEOWNERS or branch-protection surface is touched, so this PR changes no merge authority
- [x] A3 — no workflow calls the new module, so no existing gate changes behaviour
- [x] A4 — `docs/**` and `.ops/**` are not exempted wholesale by the allowlist
- [x] A5 — no R-level artifact is required for this diff
- [x] C1 refuses a newly authored commit on the first-parent chain, a merge whose second parent is not an ancestor of `origin/main`, a non-ancestor approved SHA, and an empty chain
- [x] C2 refuses any change to the reviewed implementation, tests, dependencies, configuration, or this issue's own proof bundle and lane manifest
- [x] C3 evaluates deny before allow, and refuses paths matching no allow rule
- [x] C4 refuses a red **or absent** required context, a later `pm-verdict/v1` CHANGES_REQUIRED, and a later GitHub review in CHANGES_REQUESTED

## EVIDENCE:

```
$ pnpm type-check
(exit 0)
```

```
$ pnpm test
# tests 5520
# pass 5520
# fail 0
(exit 0; 0 'not ok' lines across the whole run)
```

```
$ pnpm exec tsx --test scripts/ops/approval-carry-forward.test.ts
# tests 35
# pass 35
# fail 0
```

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```

```
$ git diff --name-only origin/main...HEAD
.ops/sync/UTV2-1818.yml
docs/05_operations/schemas/approval-carry-forward-v1.md
docs/06_status/lanes/UTV2-1818.json
docs/06_status/proof/UTV2-1818/.gitkeep
package.json
scripts/ops/approval-carry-forward.test.ts
scripts/ops/approval-carry-forward.ts
```

```
$ git diff --name-only origin/main...HEAD | grep -cE '^(\.github/|\.claude/|\.lane/|\.agents/|CODEOWNERS)'
0

$ grep -rn "approval-carry-forward" .github/
(no output)
```

## Control mutations

Each mutation was applied to the implementation, the suite re-run, and the *named* test confirmed to
refuse it. The source was restored and re-verified green after each.

| | Mutation applied | Test that refused it | Observed |
|---|---|---|---|
| M1 | C3 evaluates the allowlist before the deny list | `C3 evaluates deny before allow, so no allow pattern can widen into a denied path`; `C3 denies this issue's own lane manifest and proof, while admitting another lane's` | 33 pass / 2 fail |
| M2 | C4 treats an absent required context as green | `C4 refuses an absent required context rather than treating it as green` | 34 pass / 1 fail |
| M3 | C1 stops rejecting newly authored commits on the first-parent chain | `C1 refuses a newly authored commit on the first-parent chain` | 34 pass / 1 fail |
| M4 | C2 stops guarding the issue's own proof bundle | the `C2 refuses when the reviewed artifact ... changed` case for the lane's own `evidence.json` | 34 pass / 1 fail |
| M5 | C4 ignores a changes-requested decision that followed approval | `C4 refuses when a pm-verdict CHANGES_REQUIRED followed the approval`; `C4 refuses when a GitHub review requested changes after the approval`; `a single failing condition refuses the whole carry-forward` | 32 pass / 3 fail |

### A methodology correction, recorded rather than hidden

The first M4 attempt used a `sed` substitution whose `s|...|` delimiter collided with a `||` operator
in the matched line. The substitution silently failed, and the suite reported 35 pass / 0 fail — a
**pristine run misread as a passing mutant**. Had it been recorded as-is, the bundle would have
claimed a control was proven when nothing had been mutated.

It was re-run with an anchored Python patch that asserts its anchor matches exactly once before
writing. The green result from the failed attempt is not evidence and is not counted above.

## Verification

- [x] `pnpm type-check`: PASS, exit 0
- [x] `pnpm test`: PASS, 5520 tests, 0 failures, exit 0
- [x] `pnpm exec tsx --test scripts/ops/approval-carry-forward.test.ts`: PASS, 35 tests, 0 failures
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS
- [x] `pnpm verify`: PASS — executed by the required CI `verify` context on this branch, run `33983756252`, job `verify`, conclusion `success`. Not run locally, and not restated here as a local run.
- [ ] `pnpm lint`: not run locally. It is a stage of `pnpm verify`, and is covered by the CI run named above rather than by any local measurement.
- [ ] `pnpm build`: not run locally. It is a stage of `pnpm verify`, and is covered by the CI run named above rather than by any local measurement.

## Runtime Verification

No runtime proof is claimed, and none is possible within this lane's authority.

- **The verifier has never run against a real pull request.** Nothing calls it, by design: the
  `merge-gate.yml` call site is reserved (`docs/mission/intent.md`, reserved decision 7) and is
  deliberately excluded from this PR. What is proven is that each condition refuses the exact case
  it names under injected evidence modelled on a real measured case.
- This diff ships no code path, query or configuration into any running container, and touches no
  pick-pipeline write path.
- No claim is made that this mechanism *should* be wired into merge authority. That is a PM
  architecture decision this lane does not pre-empt.

### Reference case the fixtures model

PR #1503 on 2026-09-05. Approved at `b06593e94`, then overtaken twice within two hours purely by
other lanes' merges landing on `main` — one of them this orchestrator's own. At head `6bfc5875a` the
PR's own diff was measured byte-identical to the approved diff, every added commit was a merge from
`main`, and the only changed files were other lanes' manifests, proof bundles and the readiness
ledger. The fixtures model that measured shape.

### Reserved surfaces deliberately untouched

`strict: true` branch protection, the four required contexts, `.github/workflows/merge-gate.yml`,
CODEOWNERS, and every existing guard remain exactly as they are. Nothing was written to `main`
outside the normal PR path.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: edf6554a6d2b4bf4f9dd5277fe05aad48d7193f3
