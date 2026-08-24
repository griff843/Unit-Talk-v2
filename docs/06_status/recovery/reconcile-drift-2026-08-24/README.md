# Orchestration reconcile drift — captured 2026-08-24

Raw output of `pnpm ops:orchestration-reconcile --current --json`, preserved verbatim in
`raw-reconcile-output.json`, plus a per-issue deduplication in `deduplicated-by-issue.json`.

This is preservation only. **No lane state was mutated.** Each issue below requires its own
preservation and `safe_to_apply` decision before any action.

## Counts, measured

- failing check rows: **33**
- unique issue IDs: **17**

The two numbers differ because several issues fail multiple distinct checks — `UTV2-1619`
alone accounts for 9 rows. A count taken from failing rows overstates the number of lanes
needing a decision; a count taken from a truncated display understates it.

## Per-issue decision table

| Issue | Failing checks | reconcile safe_to_apply | Distinct reasons |
|---|---|---|---|
| UTV2-1383 | 2 | `True` | Active lease has no active lane manifest<br>Merged PR is 3493m old but Linear state is Blocked Internal |
| UTV2-1451 | 1 | `True` | Merged PR is 23630m old but Linear state is Blocked Internal |
| UTV2-1543 | 1 | `False` | Open PR exists but lane manifest is missing the matching PR URL |
| UTV2-1550 | 1 | `False` | Open PR exists but lane manifest is missing the matching PR URL |
| UTV2-1612 | 2 | `False` | Merged PR is 38709m old but Linear state is Blocked Internal<br>Open PR exists but lane manifest is missing the matching PR URL |
| UTV2-1619 | 9 | `False` | Merged PR is 18731m old but Linear state is Blocked Internal<br>Merged PR is 24241m old but Linear state is Blocked Internal<br>Merged PR is 24267m old but Linear state is Blocked Internal<br>Merged PR is 25600m old but Linear state is Blocked Internal<br>Merged PR is 26140m old but Linear state is Blocked Internal<br>Merged PR is 26930m old but Linear state is Blocked Internal<br>Merged PR is 27219m old but Linear state is Blocked Internal<br>Open PR exists but lane manifest is missing the matching PR URL |
| UTV2-1627 | 1 | `True` | Merged PR is 22441m old but Linear state is Ready to Close |
| UTV2-1641 | 2 | `True` | Merged PR is 32836m old but Linear state is Ready to Close<br>Merged PR is 32895m old but Linear state is Ready to Close |
| UTV2-1646 | 2 | `True` | Merged PR is 32847m old but Linear state is Blocked Internal<br>Merged PR is 32860m old but Linear state is Blocked Internal |
| UTV2-1648 | 2 | `True` | Merged PR is 32730m old but Linear state is Blocked Internal<br>Merged PR is 32775m old but Linear state is Blocked Internal |
| UTV2-1651 | 1 | `False` | Linear In Codex has no active lease or lane manifest |
| UTV2-1652 | 1 | `False` | Open PR exists but the matching lane manifest is missing |
| UTV2-1659 | 4 | `False` | Linear In Claude has no active lease or lane manifest<br>Merged PR is 32343m old but Linear state is In Claude<br>Merged PR is 32458m old but Linear state is In Claude<br>Open PR exists but lane manifest is missing the matching PR URL |
| UTV2-1691 | 1 | `False` | Open PR exists but lane manifest is missing the matching PR URL |
| UTV2-1701 | 1 | `True` | Merged PR is 16068m old but Linear state is Ready to Close |
| UTV2-1724 | 1 | `True` | Active lease has no active lane manifest |
| UTV2-1729 | 1 | `False` | Open PR exists but lane manifest is missing the matching PR URL |

## Notes

- `safe_to_apply: false` entries were refused by the reconciler itself, mostly because a lease
  is `stale_reclaim_required`; those are not cleanup candidates without a decision.
- Ages are in minutes as reported. The oldest merged-but-unclosed lane is roughly 27 days stale.
- `UTV2-1740` does **not** appear here and was not in the reconciler's selected set. Its closeout
  passed `ops:truth-check` with 44 checks and 0 failures.
