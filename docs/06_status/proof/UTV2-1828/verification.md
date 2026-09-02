# PROOF: UTV2-1828 — rebind diff-summary.md on the closeout path

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the ratified pre-merge value; the Execution SHA
> row carries the verified implementation identity. `post-merge-lane-close.yml` rebinds
> merge authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1828
Tier: T2
Lane type: governance
Proof profile: static
Branch: claude/utv2-1828-rebind-diff-summary
PR: https://github.com/griff843/Unit-Talk-v2/pull/1490
result: pass

## Summary

A merged lane whose proof bundle ships a `diff-summary.md` could not be closed. The
manifest bound correctly, every other gate passed, and `ops:truth-check` failed on P3 and
C4 — the two checks that scan the whole proof directory — because every rebinder on the
closeout path covered exactly `evidence.json` and `verification.md`. `rebindRepairedLaneProof`
now offers `diff-summary.md` to the rebinder on both of its branches, and the attested
branch reads the file back afterwards and refuses rather than reporting a partial rebind as
a complete one.

## ASSERTIONS:

- [x] The GitHub-attested static re-attestation path rebinds `diff-summary.md` in the same
      run as `evidence.json` and `verification.md`, and the returned receipt names the file
      — so a partial rebind can no longer be reported as a complete one.
- [x] Surrounding authored content in `diff-summary.md` survives byte-for-byte; only the
      merge-SHA anchor is rewritten, and the stale value does not survive.
- [x] A `diff-summary.md` carrying no bindable anchor now refuses, naming the file, instead
      of succeeding and leaving the lane to fail later at truth-check P3/C4.
- [x] The tolerant ordinary path offers the same file, and its ABSENCE stays legal: a
      bundle without a `diff-summary.md` rebinds exactly as before and reports `missing`
      rather than refusing or inventing an artifact.
- [x] The strict planner in `scripts/ops/proof-rebind.ts` is deliberately not reused: it
      requires a `## Merge SHA Binding` section that a canonically generated
      `diff-summary.md` (`buildDiffSummary`) does not have.
- [x] Two mutation controls reproduce the defect on each branch independently.
- [x] `pnpm type-check`, `pnpm lint`, `pnpm build` and `pnpm test` are green on the
      execution SHA.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` returns
      PASS with no R-level artifacts required for this diff.

## EVIDENCE:

The live failure this lane fixes, measured on UTV2-1826 (merged as `ef27ab62c90d8fb9bd6ee6d7688c836411a0753b`,
PR #1486) by running the gate rather than inferring it:

```
$ pnpm ops:truth-check UTV2-1826
fail (39 checks, 2 failures)
  [FAIL] P3  proof files missing merge SHA reference
             docs/06_status/proof/UTV2-1826/diff-summary.md
  [FAIL] C4  proof artifacts missing required SHA binding
             docs/06_status/proof/UTV2-1826/diff-summary.md

$ # after the one anchor in that file is set
$ pnpm ops:truth-check UTV2-1826
pass (39 checks, 0 failures)
```

Why no automated path reached that file. `post-merge-lane-close.yml` is the sanctioned
recovery, and on `workflow_dispatch` it skips proof generation entirely:

```
if [ "$EVENT_NAME" = "workflow_dispatch" ]; then
  echo "::notice title=post-merge-lane-close::Deferring proof mutation to GitHub-attested lane-close repair."
  exit 0
fi
```

Binding is delegated to `ops:lane-close --repair-merged`, i.e. to `rebindRepairedLaneProof`,
whose two branches listed:

```
scripts/ops/lane-close.ts:1239   [structuralCandidate!.evidencePath, structuralCandidate!.verificationPath]
scripts/ops/proof-generate.ts    rebindMergeSha -> evidence.json, verification.md
```

`ops:proof-generate` does already list `diff-summary.md` (`STANDARD_PROOF_FILES`), which is
exactly why the push-triggered path was never seen to fail — and why the dispatch replay
could never fix it.

Baseline — the full `scripts/ops/lane-close.test.ts` suite on the execution SHA:

```
$ pnpm exec tsx --test scripts/ops/lane-close.test.ts
# tests 178
# pass 178
# fail 0
```

Mutation control 1 — revert the attested branch to the two-file list
(`diffSummaryPath: null`):

```
$ pnpm exec tsx --test scripts/ops/lane-close.test.ts
not ok 176 - UTV2-1828: the attested recovery rebinds diff-summary.md, not just evidence.json and verification.md
not ok 177 - UTV2-1828: a diff-summary.md with no bindable anchor refuses instead of closing on a partial rebind
# pass 176
# fail 2
```

Mutation control 2 — revert the tolerant branch to the two-file list (delete the
`rebindVerificationMdSha` call):

```
$ pnpm exec tsx --test scripts/ops/lane-close.test.ts
not ok 24  - repair mode rebinds proof from the repair PR SHA to the implementation PR merge SHA
not ok 27  - rebindRepairedLaneProof keeps profileless evidence on the tolerant ordinary path even when PR truth is available
not ok 28  - rebindRepairedLaneProof tolerates a lane with no canonical evidence bundle even when PR truth is available
not ok 29  - rebindRepairedLaneProof binds a declared model-routing.json sidecar in addition to evidence/verification
not ok 40  - rebindRepairedLaneProof is unaffected for a lane with no required model-routing sidecar (ordinary closeout behavior unchanged)
not ok 178 - UTV2-1828: the tolerant ordinary path also offers diff-summary.md, and its absence stays legal
# pass 172
# fail 6
```

Each branch is proven independently: neither mutation is caught by the other branch's
tests, so neither line of the fix is load-bearing for the other's control.

Full suite on the execution SHA:

```
$ pnpm verify
# tests 5574
# pass 5574
# fail 0
```

R-level compliance on this diff:

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```

Automation coverage:

```
$ pnpm ops:automation-coverage-check
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] baseline tests=119/119 capabilities=18/18
```

The single warning is the pre-existing baselined `WIRING_GLOB_SHADOWED` finding under
`apps/qa-agent`, untouched by this lane.

## Verification

- [x] `pnpm type-check`: pass (silent)
- [x] `pnpm lint`: pass (silent)
- [x] `pnpm build`: pass (silent)
- [x] `pnpm test`: 5574 tests, 5574 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/lane-close.test.ts`: 178 pass, 0 fail
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS
- [ ] `pnpm verify` end-to-end: not obtainable off-CI. Every step through `verify:commands`
      passed; the final `test:live-db` step is refused by the fail-closed staging guard —
      `[assert-staging] REFUSED: target identity could not be resolved from its URL
      (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.` The
      authoritative receipt is the required `verify` context on this PR head, which runs
      against the run-scoped staging database.

## Runtime Verification

This is a `static`-profile governance lane. It changes lane-closeout tooling only: no
runtime service, no database, no migration, no deployment surface is touched. There is
therefore no live-DB behaviour to observe, and the writable-DB receipt is produced and
verified by CI inside the required `verify` context rather than asserted from proof text.

The behaviour that IS in scope — what the rebinder does to a real bundle on disk — is
measured above by executing it against real files in a temporary git repository and reading
the bytes back, not by inspecting the source.

## Containment

No production DDL, database mutation, deployment, ingestion, delivery, provider
resubscription or branch-protection change. No implementation code outside
`scripts/ops/lane-close.ts` is touched. Neither validator is bypassed and no gate is
loosened: the change adds a file to a rebinder's coverage and adds a refusal, so its only
effect on closeout is to bind more and to fail closed more often.

## Known follow-up

- `rebindMergeSha` in `scripts/ops/proof-generate.ts` still carries the two-file list
  itself. That file is inside UTV2-1825's active file scope lock (PR #1485, open), so the
  list is extended from the `lane-close.ts` call site rather than at its definition. Moving
  it into `rebindMergeSha` belongs to a lane that owns that file.
- `CANONICAL_PROOF_ARTIFACTS` in `scripts/ops/proof-rebind.ts` is unchanged, for the
  structural reason recorded above rather than as an oversight.
- This fix alone does not close UTV2-1826. That bundle's `diff-summary.md` anchor reads
  `MERGE_SHA: pending merge`, and the pre-merge anchor pattern in `proof-generate.ts` matches
  `pending`, not `pending merge` — so the anchor is not yet bindable. PR #1485 (UTV2-1825)
  fixes exactly that. With this lane in place the failure is now a named refusal from the
  closeout tool instead of a P3/C4 failure after the fact; with both, UTV2-1826 closes
  through the sanctioned `workflow_dispatch` replay.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1490
Approved PR head: pending merge
Execution SHA: 066d65ed4699b71e5018d8a828c3ac755522cf7f
