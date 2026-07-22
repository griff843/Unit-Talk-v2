# PROOF: UTV2-1574

| Field | Value |
| --- | --- |
| Issue | UTV2-1574 |
| Tier | T1 |
| Branch | claude/utv2-1574-sole-owner-governance-ratification |
| Commit SHA(s) | pending (bound post-merge) |

MERGE_SHA: pending

(Rebound to the true merge SHA by `ops:proof-generate --merge-sha` during post-merge lane-close reconciliation.)

## Verification

## Summary

Records griff843's ruling on `docs/06_status/SOLE_OWNER_GOVERNANCE_CONVERGENCE_PROPOSAL.md` §7's nine
Griff-decision rows, per his direct chat instruction to "ratify the nine Sole-Owner decisions." Rows 1-7 and 9
are ratified as their "Converged rec." exactly as written in the convergence proposal -- these are the rows
where Claude's independent analysis and Codex's independent adversarial review, run separately, arrived at the
same resolution. Row 8 (acceptable annualized probability of a bad merge reaching production) has no proposed
value in the convergence proposal -- it is a request for a number, not a recommendation -- and is explicitly
deferred per griff843's direct instruction, since the convergence proposal's own §9 states row 8 is required
only for PR5's cutover, not PR1's start.

This document amends, and does not replace, `docs/06_status/T1M_DELEGATION_FINAL_PM_DECISION.md` (the existing
binding baseline), per the convergence proposal's own §8 supersession plan.

## What this authorizes

Per convergence proposal §9, PR1 of the five-PR migration (§5) can begin once rows 1-4 and 9 are ratified.
Those rows are ratified here. This document authorizes starting PR1 only -- least-privilege executor/reviewer
GitHub Apps and production/canary environment protection. PR2-5 each have their own prerequisites in the
convergence proposal §5 and are not authorized to start by this document.

## ASSERTIONS:

- [x] All nine rows accounted for -- eight ratified (1-7, 9), one explicitly deferred (8), none silently skipped
- [x] Ratified rows match the convergence proposal's "Converged rec." column verbatim, not a paraphrase that could drift
- [x] Row 8's deferral is stated as a deferral, not filled with a fabricated or inferred number
- [x] Does not edit `T1M_DELEGATION_FINAL_PM_DECISION.md` directly -- amends by reference per the convergence proposal's own supersession plan, so the existing binding baseline is never silently overwritten
- [x] Explicitly scopes authorization to PR1 only, not a blanket green light for PR2-5
- [x] No branch protection, workflow file, or product/runtime code touched by this diff
- [x] `pnpm verify` PASS (full local run)
- [x] `r-level-check` PASS, no artifacts required for this diff (pure documentation)

## EVIDENCE:

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 1
Rules matched: (none) — no R-level artifacts required for this diff
```

```text
$ pnpm verify
...
# fail 0
(zero "not ok" lines across the entire run)
```
