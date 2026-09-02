# DIFF SUMMARY: UTV2-1826 — resolve post-merge migration merge authority from the declared merge slot

MERGE_SHA: ef27ab62c90d8fb9bd6ee6d7688c836411a0753b

Issue: UTV2-1826
PR: https://github.com/griff843/Unit-Talk-v2/pull/1486
Approved PR head: 38433c681eac52e0784888825e3f20aa44667bb8
Execution SHA: cf3adef13a3f32ca841cbdc259961c4698149dfe

> Rebound to GitHub's merged-PR attestation for PR #1486. `ops:proof-rebind` and
> `ops:lane-close --repair-merged` rewrite only evidence.json and verification.md, so this
> file's merge anchor is set here through the governed repair branch rather than left
> stale — truth-check P3/C4 scan the whole bundle, diff-summary.md included.

## Why anything changed

UTV2-1822 merged as `1817eddc17ae4954cdd5876372763e1524e427fd` and could not be closed.
The sanctioned `post-merge-lane-close` recovery, dispatched with `pr=1482` (run
33652083109), got further than the push-triggered attempt: it deferred proof mutation to
`ops:lane-close --repair-merged`, which repaired the manifest and bound the proof
correctly. M1–M8, L1–L5, G1–G5, P1–P5, P7, P10, R3 and S1 all passed. Truth-check then
failed on five checks carrying one message:

```
sha_binding.verified_source_sha does not equal the GitHub-recorded merge SHA
```

The lane was merged, its proof was correctly bound, and it was unclosable.

Inside `scripts/ops/proof-schema.ts`, the migration profile's post-merge branch called
`verifyPostMergeMigrationReceiptBinding(receiptHead, verifiedSourceSha, …)`, which handed
that verified source to `resolveMergedPrAttestation`. That resolver requires whatever
value it is given to equal the GitHub-recorded merge SHA — it exists to check merge
authority.

Under the ratified identity contract those two fields are deliberately different:
`sha_binding.merge_sha` carries merge authority, and `sha_binding.verified_source_sha` is
the execution identity — a commit the PR itself contributed, which is exactly what the
receipts were captured at. So a migration bundle could satisfy the validator only by
writing the merge SHA into its execution identity, which the pre-merge validator rejects
and which would falsify what was actually verified. Every honest schema-v2 migration
bundle was structurally unclosable after merge.

`verifyDeclaredMergeSlotBinding` had already been moved onto the declared slot — that is
why P10 and R3 passed on the same bundle, in the same run, with
`verifier_provenance_bound_merge_slot`. This one caller was left behind.

## What changed

### `scripts/ops/proof-schema.ts`

| Change | Effect |
|---|---|
| `verifyPostMergeMigrationReceiptBinding` takes a `MigrationMergeAuthority` — a SHA plus the evidence field it came from — and resolves the attestation from it | merge authority is read from the field that actually carries it, and a mismatch names that field |
| the caller reads `readEvidenceMergeSlot(binding)` and prefers a declared slot, falling back to the verified source only when no slot is declared | bundles that predate the slot keep the pre-contract rule unchanged |
| a declared slot that is not a 40-character SHA post-merge fails as `migration_receipt_merge_slot_invalid` | an unbound slot after merge is reported as the contradiction it is instead of quietly falling back |
| when the slot carries authority and the verified source is not the merge commit, the verified source must be reachable from the attested PR head and absent from the base-side reference | execution identity keeps its own obligation; new status `source-not-in-pr`, surfaced as `migration_receipt_source_not_in_merged_pr` |

The check reuses `verifiedSourceIsContributedByAttestedPr`, the same helper the
external-verifier path already uses for this obligation, rather than adding a second
notion of "within the PR".

Nothing else moves. The attestation requirement is not relaxed, a branch SHA in an
authoritative merge field still fails, and the receipt-head ancestry rules — proof-only
ancestry, non-proof delta, unrelated history — are byte-for-byte unchanged.

### `scripts/ops/proof-schema.test.ts`

Five regressions on a purpose-built git fixture whose base tip, lane implementation
commit, proof-only PR head and two-parent merge commit are four distinct objects. The
pre-existing migration fixtures set the merge slot equal to the verified source, so they
could never have caught this; the new fixture makes the split identity the default.

## What did not change

No production DDL, database mutation, deployment, ingestion, delivery, implementation
code, or branch-protection change. No other lane's proof bundle is touched by this PR.
UTV2-1822's closeout is completed afterwards through the sanctioned
`post-merge-lane-close` path, with no hand-edit of `main` and no admin bypass.
