# PROOF: UTV2-1848 — enforce the deferred T1 live-DB precondition at closeout

MERGE_SHA: pending merge
Execution SHA: e8c51d0aa

`docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md` Part 2 has two halves. One adds a
fail-closed closeout obligation; the other changes which lanes may open. Only the second is
reserved. This lane lands the first, so the reserved decision becomes a review of a two-line diff
against protection that already exists and is already tested.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Verified source SHA: e8c51d0aa

`sha_binding.merge_sha` is `null` pre-merge. `verified_source_sha` is `e8c51d0aa`, the last commit
on this branch changing any file outside `docs/06_status/proof/UTV2-1848/`. The binding is written
after merge by `ops:proof-generate --merge-sha`; no manual append is made here.

## ASSERTIONS:

- [x] **A1 — The field has exactly one legal value, and an unrecognised value is refused rather
      than ignored.** `validateManifest` errors on any value other than `"deferred_to_ci"`. Reading
      an unrecognised value as "no deferral" would convert a typo into a silently dropped closeout
      obligation, which is the exact failure the field exists to prevent.
- [x] **A2 — The field is legal only at `T1`.** `validateManifest` errors when it is present on a
      lane of any other tier. The precondition it defers exists only at T1.
- [x] **A3 — It is a one-member union, not a boolean.** A second deferral basis must be named and
      reviewed, not expressed by flipping a flag.
- [x] **A4 — `G6` skips when the field is absent**, which is every lane on `main`. The check is
      inert today and changes no outcome.
- [x] **A5 — `G6` passes only when both receipt contexts are green at the merge SHA**, and the
      passing detail names the contexts it verified rather than asserting a conclusion.
- [x] **A6 — `G6` fails when the receipt is not green.** The deferral is not self-satisfying: a
      lane cannot record that it moved its live-DB evidence to CI and then close without that
      evidence.
- [x] **A7 — Every uncertain input is a refusal, never a pass and never a skip.** An unreadable
      check list, an absent merge SHA and an unrecognised field value are all `fail`. Unverifiable
      evidence is not absent evidence.
- [x] **A8 — Both receipt contexts are asserted directly.** `verify` already declares
      `needs: staging-db-proof` with a fail-closed guard, so asserting `verify` alone would
      arguably suffice — but that is an inference about workflow wiring.
      `T1_DEFERRAL_RECEIPT_CONTEXTS` names `Writable DB proof (staging only)` alongside it, so a
      later edit loosening the `needs:` relationship cannot silently satisfy this gate.
- [x] **A9 — `G6` is wired into the run, not merely exported**, and cannot be routed around. It is
      evaluated after the `G1`–`G4` block, and both earlier exits that skip it — no GitHub token
      (`verdict: infra_error`, exit 3) and no `pr_url` (`verdict: fail`, exit 1) — already end the
      run without a passing verdict.
- [x] **A10 — This lane admits nothing.** No token field is written, no manifest field is written,
      and `resolveVerdict` is untouched. The admission half is written out in full as a diff in
      `PT1_CONTAINMENT_ADMISSION_DECISION.md` §6a and deliberately not applied.
- [x] **A11 — No reserved surface is touched.** `git diff origin/main --name-only -- .github/` is
      empty: no workflow, no CODEOWNERS, no branch-protection change, no tier semantics, no
      approval artifact, no change to what `verify` requires.

## Verification

How the assertions above were established, so the evidence table reads as measurement rather than
description.

- **Executed, not inspected.** Every behavioural claim comes from tests run on this branch; the
  counts are in "Commands run".
- **Both directions are asserted.** A1/A2 assert what `validateManifest` refuses; the two companion
  tests assert that the absent field and the one legal value at `T1` both produce no error, so the
  refusals are not vacuous.
- **A9 is the load-bearing structural claim** and is asserted against the source of
  `truth-check-lib.ts` itself, because without it every other assertion here would still pass with
  the check unreachable — the failure recorded for the executor-result validator, where the tested
  copy was not the copy that gated anything. It is also the third mutation below.
- **The control that must keep failing** is A6: the receipt-not-green case. Mutation M1 makes it
  unreachable and that test goes red.
- **A10 is verified by absence** against the diff, not by argument: no token field, no manifest
  write, no `resolveVerdict` change.

## EVIDENCE:

| Assertion | Evidence |
|---|---|
| A1, A2 | `scripts/ops/shared.ts` `validateManifest`; tests *"refuses an unrecognised t1_live_db_precondition rather than ignoring it"*, *"refuses a deferral on a non-T1 lane"*, and their two companion accept-cases |
| A3 | `T1_LIVE_DB_PRECONDITION_DEFERRED` / `T1LiveDbPrecondition` in `scripts/ops/shared.ts` |
| A4 | test *"G6 skips when the lane recorded no deferred live-DB precondition"* |
| A5, A8 | `T1_DEFERRAL_RECEIPT_CONTEXTS`; test *"G6 passes when the deferred receipt is green at the merge SHA"*, which asserts the detail names every context |
| A6 | test *"G6 fails when the deferred receipt is not green"*; mutation M1 |
| A7 | tests *"...could not be read"*, *"...no merge SHA..."*, *"...unrecognised precondition value..."*; mutation M2 |
| A9 | test *"G6 is wired into the truth-check run, not merely exported"*; mutation M3 |
| A10, A11 | the diff scope below and `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md` §6a |

### Commands run

```
pnpm lint                                             # exit 0
pnpm type-check                                       # exit 0
pnpm test                                             # exit 0 — tests 6131, pass 6131, fail 0
pnpm verify                                           # exit 1 at test:live-db only; see below
pnpm exec tsx --test scripts/ops/shared.test.ts        # exit 0 — tests 105, pass 105, fail 0
pnpm exec tsx --test scripts/ops/truth-check-lib.test.ts
                                                      # exit 0 — tests 139, pass 139, fail 0
npx tsx scripts/ci/r-level-check.ts --issue UTV2-1848
                                                      # Verdict: PASS · Changed files: 9
                                                      #   Rules matched: (none)
```

`pnpm verify` exits 1 locally and not because anything failed. Every stage through
`verify:commands` passed — `env:check`, `lint`, `type-check`, `build` and the full suite at
6131/6131. It then reaches `test:live-db`, whose `ci:assert-staging` step refuses with
`host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx`: the containment placeholder doing
exactly what containment mandates, which is the condition this lane's subject matter is about. No
local `pnpm verify` PASS is claimed; the required `verify` check on this PR is the authoritative
result.

### Mutation evidence

A control is only proven by making it fail on the condition it names. All three mutations were
applied to the real source, executed, and reverted byte-for-byte.

| Mutation | Command | Result |
|---|---|---|
| M1 — `if (!input.receiptChecks.passed)` made unreachable, so a red receipt reaches the `pass` return | `pnpm exec tsx --test scripts/ops/truth-check-lib.test.ts` | `# pass 138 / # fail 1` — *"G6 fails when the deferred receipt is not green"* |
| M2 — `if (!input.receiptChecks)` made unreachable, so unreadable checks are treated as fine | same | `# pass 137 / # fail 2` — the unreadable-checks test and the not-green test |
| M3 — `addCheck(g6.id, g6.status, g6.detail)` replaced with `void g6`, leaving the evaluator exported but unwired | same | `# pass 138 / # fail 1` — the wiring assertion |

M3 is the one that matters. Before it, the entire check could have been deleted from the run with
every behavioural test in this bundle still passing.

The first attempt at M1 silently no-oped on an indentation mismatch and reported `# fail 0`. That
was a failed mutation, not a passing control, and it was re-run with an asserted single match rather
than recorded as evidence.

### Diff scope

```
 docs/05_operations/LANE_MANIFEST_SPEC.md           |  19 +++
 docs/05_operations/TRUTH_CHECK_SPEC.md             |  30 +++++
 .../PT1_CONTAINMENT_ADMISSION_DECISION.md          |  84 ++++++++++++++
 scripts/ops/shared.test.ts                         |  64 ++++++++++
 scripts/ops/shared.ts                              |  50 ++++++++
 scripts/ops/truth-check-lib.test.ts                | 103 ++++++++++++++++
 scripts/ops/truth-check-lib.ts                     | 129 +++++++++++++++++++++
 7 files changed, 479 insertions(+)
```

Measured with `git diff --stat origin/main...HEAD` excluding this lane's own manifest, sync file and
proof directory. The deleted `.gitkeep` is inside that excluded directory.

## What this lane does not claim

- It does **not** claim that a T1 lane can now open under containment. It cannot. `resolveVerdict`
  is untouched and `blocked_by_containment` still resolves to `INFRA`.
- It does **not** claim the admission decision is made, recommended into effect, or bookkeeping.
  Admitting a lane that could not open before is a change to lane admission and is reserved to PM.
- It does **not** claim `G6` has ever fired on a real lane. It cannot have: no manifest carries the
  field. Every claim about its behaviour comes from direct invocation of the evaluator with
  constructed inputs, plus the source assertion that it is wired into the run.
- It does **not** claim to unblock UTV2-1842. That is unblocked by route A0 or route B in
  `PT1_CONTAINMENT_ADMISSION_DECISION.md` §5, both of which remain the owner's decision.
- It does **not** claim `pnpm build` exercised new application source. This diff compiles no
  application code; `pnpm type-check` covers the TypeScript project references.
