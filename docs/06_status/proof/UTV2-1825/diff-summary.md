# DIFF SUMMARY: UTV2-1825 — bind the pre-merge placeholder the pre-merge contract mandates

MERGE_SHA: pending merge

Issue: UTV2-1825
PR: https://github.com/griff843/Unit-Talk-v2/pull/1485
Execution SHA: d8b1af9be76b01f86ecd57e82c149576aa36cf85

## Why anything changed

UTV2-1822 merged as `1817eddc17ae4954cdd5876372763e1524e427fd` and then could not be
closed. `post-merge-lane-close` run 33644231049 failed at "Bind proof artifacts to merge
SHA" with `unbindable_proof_artifact`, the lane manifest stayed `in_progress` with
`sha_binding.merge_sha: null` on a merged lane, and the retained merge mutex release
failed behind it.

Two rules inside `scripts/ops/proof-generate.ts` had never been reconciled:

* Pre-merge, `normalizePreMergeVerificationMarkdown` rewrites the top-level anchor to the
  literal `pending merge`, and `scripts/ci/proof-binding-validator.ts` requires exactly
  that value — a real SHA there is rejected, because a branch SHA is not merge authority.
* Post-merge, `rebindMergeShaAnchorsInMarkdown` substitutes a value only when it matches
  `FULL_SHA_TOKEN_PATTERN` (40 hex) or the accepted-value pattern. That pattern listed
  the bare word `pending` and is `^…$`-anchored, so `pending merge` never matched.

A bundle that followed the ratified pre-merge contract was therefore unbindable after
merge. `planExistingProofArtifact` refused to guess — correctly; it must never overwrite
authored evidence — and the only remaining remedies were hand-editing `main` or opening a
second PR against another lane's proof, which is precisely what
`scripts/ops/proof-repair.ts` exists to make unnecessary.

The predecessor lane, UTV2-1783, escaped this only by accident: its proof carried a real
40-hex branch SHA in that row, which the rebinder substitutes.

## What changed

### `scripts/ops/proof-generate.ts`

| Change | Effect |
|---|---|
| the rebinder's accepted-value pattern is now built with `new RegExp`, its first alternative escaped from the merge-authority placeholder constant `proof-schema.ts` exports | the rebinder accepts exactly the placeholder the pre-merge path writes, and the two ends of the contract are the same literal rather than two copies |
| new `escapeRegExpLiteral` helper | the constant is embedded in a pattern safely if it ever gains a metacharacter |
| six hardcoded `'pending merge'` literals now read that same exported constant | one literal, one source; generated output is byte-identical |

No behaviour outside placeholder recognition is touched. In particular:

* `planExistingProofArtifact` still throws `unbindable_proof_artifact` rather than
  overwriting an authored value;
* fenced blocks are still excluded, so quoted command output is never rewritten;
* `Approved PR head:` is still left alone — a different fact, one this function is never
  given. Writing the merge SHA there would be a fabricated value rather than a stale one.
  `ops:proof-rebind` owns that row and takes `--approved-head` explicitly;
* `sha_binding.merge_sha` remains `null` pre-merge.

### `scripts/ops/proof-generate.test.ts`

Four regressions, every fixture produced by `normalizePreMergeVerificationMarkdown` rather
than hand-typed — a hand-typed copy of the placeholder would keep passing if the writer
and the reader drifted apart, which is the failure this lane exists to prevent.

## What did not change

No production DDL, database mutation, deployment, ingestion, delivery, or
branch-protection change. No other lane's proof bundle is touched by this PR;
UTV2-1822's closeout is completed afterwards through the sanctioned
`post-merge-lane-close` path.
