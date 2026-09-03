# PROOF: UTV2-1825 — bind the pre-merge placeholder the pre-merge contract mandates

MERGE_SHA: 5ed005a6da848917a355c4c0ee5e7d8f5513713b

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1825
Tier: T1
Lane type: governance
Proof profile: static
Branch: claude/utv2-1825-rebind-pending-merge-placeholder
PR: https://github.com/griff843/Unit-Talk-v2/pull/1485
result: pass

## ASSERTIONS:

- [x] The placeholder the pre-merge path writes is the placeholder the post-merge
      rebinder binds. The regression builds its fixture by calling
      `normalizePreMergeVerificationMarkdown` and asserts the produced row is present
      before rebinding, so it cannot pass vacuously if the writer changes.
- [x] The `## Merge SHA Binding` section body rebinds along with the top-level row, and
      the `Execution SHA:` row — a different fact — survives the rebind unchanged.
- [x] An authored, non-placeholder merge-SHA value is still refused: the rebinder returns
      byte-identical content, which is what makes `planExistingProofArtifact` raise
      `unbindable_proof_artifact` instead of overwriting measured evidence.
- [x] A placeholder inside a fenced evidence block is still left untouched; quoted command
      output is a measurement, not an anchor.
- [x] `Approved PR head:` is deliberately not rebound here. This function is never given
      an approved head, and writing the merge SHA into that row would be a fabricated
      value rather than a stale one. `ops:proof-rebind` owns that row via `--approved-head`.
- [x] The accepted placeholder is derived from the single merge-authority placeholder
      constant `proof-schema.ts` exports, and the six previously hardcoded copies of the
      literal in `proof-generate.ts` now read that same constant, so the pre-merge writer
      and the post-merge reader cannot drift apart again.
- [x] Two mutation controls fail the regressions, each catching the defect it names and
      only that defect — the placeholder-acceptance tests do not fire on the over-broad
      mutation, and the refusal control does not fire on the removal mutation.
- [x] `pnpm type-check`, `pnpm lint` and `pnpm test` are green on the execution SHA.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` returns PASS
      with no R-level artifacts required for this diff.

## EVIDENCE:

Baseline — the full `scripts/ops/proof-generate.test.ts` suite on the execution SHA:

```
$ pnpm exec tsx --test scripts/ops/proof-generate.test.ts
# pass 105
# fail 0
```

Mutation control 1 — restore the shipped pattern, removing the ratified placeholder from
the accepted alternation. This is the exact defect the lane fixes:

```
$ python3 - scripts/ops/proof-generate.ts   # restore the shipped regex literal, whose alternation omits the two-word ratified placeholder
MUTATION APPLIED: accepted placeholder removed from the alternation
$ pnpm exec tsx --test scripts/ops/proof-generate.test.ts
not ok 102 - UTV2-1825: the placeholder the pre-merge path writes is the one the rebinder binds
not ok 103 - UTV2-1825: the Merge SHA Binding section body rebinds along with the top-level row
not ok 105 - UTV2-1825: a placeholder inside a fenced evidence block is left untouched
# pass 102
# fail 3
```

Test 104 — the refusal control — correctly does NOT fail here: it asserts that an authored
value is left alone, which this mutation does not affect. Its independence is proved by the
second mutation.

Mutation control 2 — widen the pattern to accept any value, which would make the rebinder
overwrite authored evidence:

```
$ python3 - scripts/ops/proof-generate.ts   # widen the accepted-value pattern to /^.*$/i
MUTATION 2 APPLIED: pattern accepts any value
$ pnpm exec tsx --test scripts/ops/proof-generate.test.ts
not ok 104 - UTV2-1825: an authored non-placeholder value is still refused, not overwritten
# pass 104
# fail 1
```

Restored source, re-measured:

```
$ cp /tmp/pg-good.ts scripts/ops/proof-generate.ts
restored
$ pnpm exec tsx --test scripts/ops/proof-generate.test.ts
# pass 105
# fail 0
```

Repository-wide test suite on the execution SHA — 98 node:test files:

```
$ pnpm test
tests=5438 pass=5438 fail=0 skipped=0
not-ok lines: 0
```

`pnpm type-check` and `pnpm lint`, both silent on success:

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
```

R-level compliance:

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 5
Rules matched: (none) — no R-level artifacts required for this diff
```

The originating failure this lane repairs, from `post-merge-lane-close` run 33644231049:

```
{
  "ok": false,
  "code": "unbindable_proof_artifact",
  "message": "Refusing to overwrite authored proof ...: it carries no merge-SHA anchor to
rebind to 1817eddc17ae4954cdd5876372763e1524e427fd, and does not already name it."
}
```

## Verification

- [x] `pnpm type-check`: pass (silent)
- [x] `pnpm lint`: pass (silent)
- [x] `pnpm test`: 5438 tests, 5438 pass, 0 fail, 0 skipped across 98 files
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS
- [x] `pnpm exec tsx --test scripts/ops/proof-generate.test.ts`: 105 pass, 0 fail
- [ ] `pnpm verify` end-to-end: not obtainable off-CI. Its `test:live-db` step refuses to
      run outside the staging environment — `[assert-staging] REFUSED: target identity
      could not be resolved from its URL (host=127.0.0.1)`. Every preceding step passed
      locally; the authoritative receipt is the required `verify` context on this PR head,
      which runs against the run-scoped staging database.

## Runtime Verification

This is a `static`-profile governance lane. It changes proof-tooling logic only: no
runtime service, no database, no migration, no deployment surface is touched. There is
therefore no live-DB behaviour to observe, and the writable-DB receipt is produced and
verified by CI inside the required `verify` context rather than asserted from proof text.

The runtime behaviour that IS in scope — what the rebinder does to a real bundle — is
measured above by executing the code path, not by inspecting it.

## Merge SHA Binding

Merge SHA: 5ed005a6da848917a355c4c0ee5e7d8f5513713b
PR: https://github.com/griff843/Unit-Talk-v2/pull/1485
Approved PR head: 542a9850d6760e4f645bc46709e2175e3f333d07
Execution SHA: d8b1af9be76b01f86ecd57e82c149576aa36cf85

Anchor: `d8b1af9be76b01f86ecd57e82c149576aa36cf85` is the last non-proof commit on this
branch and the head every measurement above was captured against. Only proof-path commits
follow it.
