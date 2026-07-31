# UTV2-1423 — recovered pre-squash proof

Added under **UTV2-1635**. **Nothing in this bundle was modified or removed.** The files
already present (`verification.md`, `diff-summary.md`, `evidence.json`) are untouched and
remain the bundle of record for what landed on `main`.

## What happened

This lane's proof was hand-written on the branch and then overwritten by
`ops:proof-generate` **before** the squash merge, so `main`'s history never contained the
originals. This is the case the UTV2-1631 proof-scaffold audit classified as C1 —
"only resolvable from GitHub's retained PR commit list, not locally."

GitHub retained the pre-squash branch commits of PR
[#1169](https://github.com/griff843/Unit-Talk-v2/pull/1169), so it was resolvable.

| Branch commit | Effect |
|---|---|
| `c003a5529962a1aeb77f38d926f6b22170fa1710` | added both files, hand-written |
| `ac82663dad` | replaced both with `ops:proof-generate` output |
| (squash) `ae203a4e16…` | only the generated version reached `main` |

## What is in `recovered/`

Retrieved via `gh api repos/griff843/Unit-Talk-v2/contents/<path>?ref=c003a5529962a1aeb77f38d926f6b22170fa1710`
and written **byte-identically** — no header, footer, or annotation was added to the
recovered content itself, so that byte-identity stays verifiable.

| File | Lines / bytes | git blob SHA (matches GitHub's `.sha`) |
|---|---|---|
| `recovered/verification.md` | 48 L / 2,255 B | `83ca97f7ddfcd9e8d93193e43df13cab3646c9f5` |
| `recovered/diff-summary.md` | 71 L / 4,218 B | `a3adc064bb6e248ff8c214c30470d96728fb6b71` |

Verify at any time with:

```bash
git hash-object docs/06_status/proof/UTV2-1423/recovered/verification.md
gh api "repos/griff843/Unit-Talk-v2/contents/docs/06_status/proof/UTV2-1423/verification.md?ref=c003a5529962a1aeb77f38d926f6b22170fa1710" --jq .sha
```

## What was lost, concretely

The recovered `verification.md` records `pnpm verify:quick` PASS, `pnpm verify:parallel`
PASS, and `pnpm test:db` PASS against live Supabase with a literal TAP block
(`# tests 7 / # pass 7 / # fail 0`), plus issue-specific grep verification across the six
edited governance docs. What reached `main` instead was `result: not_run` and
`- [ ] pnpm type-check: not run by proof-generate`.

The recovered files are historical evidence of the branch state. They are **not** SHA-bound
to the merge commit and should not be treated as a merge-SHA-bound proof bundle; the
merge-SHA binding lives in the existing `verification.md` / `evidence.json`.

## Recovery is not certification

Recovering a claim byte-identically establishes **what the branch said**, not that the run
happened as described. This file is presented as retrieved evidence, not as a verdict.

Two specific cautions on the recovered `verification.md`:

- It asserts `pnpm test:db` PASS 7/7 against "live Supabase" for a **docs-only governance
  lane**, run from `.out/worktrees/claude__utv2-1423-canonical-merge-authority`. That
  worktree no longer exists, so whether it held database credentials cannot now be
  verified.
- The lane merged 2026-07-08, before `pnpm ci:assert-staging` landed in `a55de402`
  (2026-07-30). At that time `test:db` from a developer checkout ran against the
  **production** project, not staging. The claim is therefore coherent with its era but
  describes a path that is now prohibited, and its TAP block is not reproducible under the
  current standard.

Compare UTV2-1604, whose bundle asserted a `test:db` run sourcing production credentials
from the main checkout and was corrected before merge. The failure mode being catalogued
is not only "proof was destroyed" but also "proof asserted a run that could not have
happened as described" — a bundle can survive intact and still be unproven.

Full context: [`../UNPROVEN_BUT_SHIPPED.md`](../UNPROVEN_BUT_SHIPPED.md) and
[`../UTV2-1631/proof-scaffold-audit.md`](../UTV2-1631/proof-scaffold-audit.md).
