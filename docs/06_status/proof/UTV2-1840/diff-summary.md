# PROOF: UTV2-1840 diff summary

MERGE_SHA: e4dcb59eef2fd80a5dfaa0174cc0fdbc88c55be2
Execution SHA: 0f78f3284bba06fd672f0d04fa9dec24c5d05f4f

## Summary

**Lane type:** governance · **Tier:** T2 · **Executor:** claude
**Branch:** `claude/utv2-1840-work-id-branch-discipline`

## What changed and why

The ratified tracker-independence correction (`docs/mission/intent.md` § "Execution must not depend
on the tracker") requires that an ordinary task run discovery → delegation → verification → PR →
closeout **without Linear access and without an issue ID**. A repo-minted `WORK-###` identifier was
introduced for exactly that, and `scripts/ops/shared.ts` was widened to accept it.

`scripts/ops/branch-discipline-guard.ts` kept its **own private copy** of the identifier alternation
and was never widened. `ops:preflight` runs that guard as **PX2**, and `ops:lane-start` refuses
without a validated preflight token — so a `WORK-###` task could not open a lane at all, even though
every Linear check correctly reported `skip`. The tracker was optional; its *identifier* was still
mandatory.

This lane removes the duplication rather than copying the fix into the second file.

## Files

| File | +/- | Change |
|---|---|---|
| `scripts/ops/shared.ts` | +14/-1 | Export `ISSUE_ID_NAMESPACES` (the single source of truth for which namespaces name a unit of work) and `issueIdScanPattern()`. `ISSUE_PATTERN` is now built from the same alternation. |
| `scripts/ops/branch-discipline-guard.ts` | +5/-5 | Import `issueIdScanPattern()` instead of re-declaring the regex; refusal messages now name all three namespaces. |
| `scripts/ops/branch-discipline-guard.test.ts` | +87/-0 | **New file.** The guard had no test at all, which is why the drift was invisible. 8 tests: namespace coverage, `WORK-###` end to end, and five controls that must still refuse. |
| `docs/mission/plan.md` | +45/-3 | Records the measured state of all five cutover exit conditions, the L3 closeout-state defect, the third leaked-lease occurrence, and the `--files`/`PG2` scope-widening cost. Moves the Wave 6 governance slot to this lane. |

## Why the two regexes were not simply merged

They are not interchangeable, and that difference is what justified the copy in the first place:

- `shared.ts` **anchors** (`^…$`) to validate that one string *is* an identifier.
- the guard **scans** (`\b…\b/gi`) free text for *every* identifier it contains.

So the shared thing is the **alternation**, not the pattern. `ISSUE_ID_NAMESPACES` is exported as
the list; each file builds the regex shape it needs from it. Adding a fourth namespace now requires
one edit, and the new test asserts the guard recognises every member of that list.

## Scope

`file_scope_lock` is `docs/06_status/proof/UTV2-1840/**`, `docs/mission/plan.md`, `scripts/ops/**`.
The lock is wider than the work (three files under `scripts/ops/`) for a mechanical reason recorded
in `plan.md`: `ops:lane-start --files` refuses a path that does not exist yet, pre-creating it fails
preflight `PG2` on an unclean tree, and only a trailing `/**` glob is legal — so declaring a
to-be-created test file forces the directory glob.

## Not in scope

No change to merge authority, the merge gate, its policy inputs, CODEOWNERS, or branch protection.
Items 8–11 of the cutover change set remain RESERVED and untouched. This lane closes exit
condition 1 only; it does not close the cutover.
