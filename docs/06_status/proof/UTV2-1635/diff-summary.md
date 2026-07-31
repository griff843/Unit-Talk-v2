# UTV2-1635 Diff Summary

MERGE_SHA: 7279ee3977c1945bd6b13c8edc2a1fe57b70c09c

Docs-only. 10 files changed, 2,200 insertions, **0 deletions**, per
`git show 7279ee3977c1945bd6b13c8edc2a1fe57b70c09c --numstat` against merge parent
`2cce4599`. No source, migration, or workflow change.

## Intent

The proof-scaffold audit recorded its Table C1 as undecidable, because a squash merge
collapses the branch and `main` cannot show what was clobbered pre-merge. GitHub retains
the pre-squash branch commits, so it is decidable from the PR commit list. This lane
decides it, recovers what was destroyed, and classifies only what genuinely resists
recovery.

## Files changed

| File | Change | Purpose |
| --- | --- | --- |
| `docs/06_status/proof/UNPROVEN_BUT_SHIPPED.md` | new, +276 | Human ledger: outcomes, count reconciliation, recovered content, claim coherence, risk-ordered unproven set. |
| `docs/06_status/proof/UNPROVEN_BUT_SHIPPED.json` | new, +1420 | Machine-readable ledger (`unproven-but-shipped-ledger/v1`): per-file verdicts with branch-commit provenance, per-lane tier/risk/CI, risk ordering, claim-coherence block. |
| `docs/06_status/proof/<recovered lane>/RECOVERED.md` | new, +76 | Provenance note for the recovered content: source commit, blob SHAs, what was lost, and the explicit caveat that recovery is not certification. |
| `docs/06_status/proof/<recovered lane>/recovered/verification.md` | new, +48 | Byte-identical destroyed proof, blob `83ca97f7ddfcd9e8d93193e43df13cab3646c9f5`. |
| `docs/06_status/proof/<recovered lane>/recovered/diff-summary.md` | new, +71 | Byte-identical destroyed proof, blob `a3adc064bb6e248ff8c214c30470d96728fb6b71`. |
| `docs/06_status/proof/UTV2-1631/proof-scaffold-audit.md` | **additions only**, +27 | Resolution banner on the C1 section and a "Follow-up completed" section, so the audit and the ledger are not read in isolation. Original findings untouched. |
| `docs/06_status/proof/UTV2-1635/verification.md` | new | This lane's own proof. |
| `docs/06_status/proof/UTV2-1635/diff-summary.md` | new | This file. |
| `.ops/sync/UTV2-1635.yml` | new | Lane sync metadata. |

## Provenance of the recovered files

Both were hand-written on the branch in commit
`c003a5529962a1aeb77f38d926f6b22170fa1710`, then overwritten by `ops:proof-generate`
before the squash merge, so `main` never contained them. Retrieved via the GitHub contents
API at that ref and written unmodified; byte-identity proven by git blob SHA equality
against GitHub's own `.sha`.

They are added **alongside** the existing bundle in a `recovered/` subdirectory. Nothing
existing was modified or removed — silent replacement is the defect that produced this
situation, so this lane does not repeat it.

## Result

28 C1 files across 21 lanes, all decided, none left undecidable:

- 2 recovered (destroyed pre-squash)
- 21 no loss (born generated on the branch; 18 diff-derived and factual, 3 hand-augmented)
- 2 proven by retained green CI on the merge SHA (T3, which is that tier's proof requirement)
- 3 `UNPROVEN_BUT_SHIPPED`

Plus a cross-cutting finding: 11 of the 21 lanes assert a `pnpm test:db` run predating the
`ci:assert-staging` guard, so their live-DB evidence is a production run from a developer
checkout — valid-for-era, not valid-now.
