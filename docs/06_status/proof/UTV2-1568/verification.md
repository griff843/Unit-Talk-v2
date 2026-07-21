# PROOF: UTV2-1568

MERGE_SHA: 2924f327b531a3e9fa3b3df0dc43180861fa440e

(This is this branch's actual head at the time this proof was written --
see the accompanying executor-result/v1 comment for confirmation this
matches the PR's current head.)

## Summary

Bounded Fable 5 pilot (8 qualifying tasks or 30 days, advisory-only) -- revised from an earlier
permanent-reinstatement draft per direct PM instruction. See `diff-summary.md` for the full file
list and rationale.

## ASSERTIONS:

- [x] Pilot terms are explicit and bounded: 8 qualifying real tasks or 30 calendar days, whichever comes first
- [x] Advisory only -- Fable output is never a merge authority, never a `pm-verdict/v1` substitute, and never counts as a vote in any T1-M quorum
- [x] Rule 9 and Griff's T1-H authority are untouched -- every existing escalation trigger fires exactly as before; authority-touching changes stay Rule 9 regardless of what Fable concludes
- [x] Reviewer independence preserved: Fable receives the artifact unedited, never an author-curated framing; the authoring identity is never the certifying identity
- [x] Usage budget, per-task metrics, one-line rollback, and a final permanent YES/NO/EXTEND gate at pilot end are all specified in `OPERATING_MODEL_SONNET5.md` §1
- [x] `three-brain.md`'s routing table and `OPERATING_MODEL_SONNET5.md`'s §1/§7/§8 are mutually consistent (verified by direct read, not assumed)
- [x] `pnpm verify` PASS on this exact head

## EVIDENCE:

```text
$ pnpm verify
env:check ... PASS
lint ... PASS
type-check ... PASS
build ... PASS
test (including live-DB suites) ... PASS
(exit code 0)
```

## Known gaps (stated honestly, not omitted)

- This pilot framing (as opposed to the earlier permanent-reinstatement draft) has not itself been
  through independent adversarial review. The prior BLOCK→PASS review cycle covered the permanent
  framing only.
- Mechanical enforcement of the pilot's own 8-task/30-day/budget limits does not exist yet --
  tracked as UTV2-1569 (T2, Backlog). Until it lands, the limits are enforced by discipline and this
  document, not by code.

## Owner boundary

T1 governance-critical, authority-touching change. Requires the `t1-approved` label and a
Griff-authored `pm-verdict/v1` APPROVED comment bound to the reviewed head before merge. This proof
supplies neither.
