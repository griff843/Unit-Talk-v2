# Diff summary — UTV2-1839

MERGE_SHA: d35b82217aabc5efeac6b27e47b21f8029d19967

> Pre-merge the merge row is the ratified `pending merge` anchor; the Execution SHA row
> below carries the verified implementation identity. `post-merge-lane-close.yml` rebinds
> it once GitHub supplies the merged-PR attestation.

Issue: UTV2-1839
Branch: `claude/utv2-1839-carry-forward-c5-c6`
Tier: T2
Lane type: governance

Extends the approval carry-forward verifier so that it can tell **unchanged
reviewed content** apart from **incoming approved main changes**. UTV2-1836
shipped C1–C4, which together are a *structural proxy* — "no new authored
commit, all first-parent merges, every moved path on a five-pattern allowlist".
They never look at content.

**This changes no gate.** `.github/workflows/merge-gate.yml` is not touched, and
`grep -rl 'carry-forward' .github/` returns nothing. The merge-gate integration
is written as a proposal in `verification.md` for a separate reserved decision.

## Files changed

| File | What |
|---|---|
| `scripts/ops/approval-carry-forward.ts` | C5, C6 and C7 added; C1 widened; deny list extended. Still pure and read-only — every fact is injected. |
| `scripts/ops/carry-forward-collect.ts` | Produces the new evidence from git; two withdrawal-detection gaps closed. |
| `scripts/ops/approval-carry-forward.test.ts` | 35 → 52 tests. |
| `scripts/ops/carry-forward-collect.test.ts` | 20 → 29 tests, four of them driving a real git repository. |

No file outside `scripts/ops/**` and this lane's own artifacts is touched.

## The conditions added

**C5 — no merge carried content of its own.** For every merge on the
first-parent chain, `git diff-tree --cc -r --name-only <sha>` must report
nothing beyond its SHA header. A merge commit's tree is not obliged to be a
function of its parents; `--cc` reports exactly the paths where the result
differs from *every* parent, which is the definition of content nobody reviewed.
Fail-closed on an unmeasured merge: not measured is not clean.

**C6 — incoming content is literally main's.** For every path in
`git diff --name-only A H`, the blob at the head must equal the blob at the
comparison anchor, with absent-on-both-sides counting as identical. C3 asks
whether a path is *permitted*; C6 asks whether what arrived there is *main's
bytes*.

**C7 — the PR's own diff is unchanged.** `git patch-id --stable` over
`git diff $(git merge-base origin/<base> X) X`, computed at the approved SHA and
at the head. The headline claim, deliberately not the enforcement: `patch-id`
normalises renames and mode changes away, so an *unequal* id is decisive but an
*uncomputable* one must not refuse on its own. C6 holds the line.

## The comparison anchor is not `origin/main`'s tip

The issue text says "`git rev-parse H:p` must equal `git rev-parse origin/main:p`".
Implemented against `git merge-base <headSha> origin/<base>` instead, and the
difference is deliberate: `main`'s tip moves on its own — the readiness ledger
writes to it on a schedule — so a correctly synced branch would be refused for a
commit it has never seen, making C6 an always-refuse control. The anchor is
itself on main (asserted separately by `mainAnchorIsOnMain`), so "identical to
the anchor" is still "identical to main"; it is only a statement about *which*
commit of main.

## C1's widening, and a premise in the issue that is false

Scope item 3 reads: "A merge whose second parent is on main can still carry,
through *its* ancestry, commits that are not." **That is false for a two-parent
merge** — everything reachable from an ancestor of main is an ancestor of main.
It is recorded here rather than quietly implemented around, because the
condition was justified by it.

What *is* reachable, and was genuinely unchecked, is a merge with **three or
more parents**: the shipped code read `parents[1]` and nothing beyond. That is
now checked for every merged parent, and reverting only that change admits a
real octopus merge whose third parent is off main (measured — see
`verification.md`, mutation M5).

The `rev-list A..H --not origin/main` cross-check is also implemented, and is
recorded as **redundancy, not an independently firing control**: no scenario
could be constructed in which it is the only refusing condition. Its comment in
the source says so.

## Withdrawal detection

Two gaps, both of which failed *open*:

1. **Edited comments.** Only `created_at` was read. A comment posted before the
   approval and edited afterwards to say `CHANGES_REQUIRED` carried an old
   timestamp and was skipped entirely. The effective time is now
   `max(created_at, updated_at)` — the timestamp must describe the same moment
   as the body being read.
2. **Dismissed reviews.** Only `CHANGES_REQUESTED` counted. When such a review
   is dismissed GitHub *replaces* its state with `DISMISSED`, so anyone with
   write access could erase a standing objection. `DISMISSED` now counts as a
   withdrawal — the fail-closed reading, costing a round trip only in the case
   where a human has already intervened.

## Deny-list completeness

`packages/db/**` and `apps/api/src/controllers/**` are named explicitly so the
deny list and `.github/CODEOWNERS` agree by construction rather than by both
happening to be right. `supabase/**` and `deploy/**` were widened from
`supabase/migrations/**` for the same reason. All were already caught by C2 and
by C3's deny-by-default; enumerating them means a future widening of
`ALLOW_PATTERNS` cannot admit an owned surface by accident.

## Risk

None to any gate. The module is pure and read-only, the collector performs no
write, and nothing in `.github/` calls either. The only behavioural change
reachable today is that an operator running `carry-forward-collect` by hand gets
three more conditions and two more withdrawal signals, all in the refusing
direction.
