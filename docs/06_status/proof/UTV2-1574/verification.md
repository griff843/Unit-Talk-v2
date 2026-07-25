# PROOF: UTV2-1574

| Field | Value |
| --- | --- |
| Issue | UTV2-1574 |
| Tier | T1 |
| Branch | claude/utv2-1574-sole-owner-governance-ratification |
| Commit SHA(s) | `18de0721cd5a8577de18147bbeb18bef8fc43d77` (merge SHA) |
| Implementation PR | #1298 |

MERGE_SHA: 18de0721cd5a8577de18147bbeb18bef8fc43d77

This is the authoritative implementation merge SHA for PR #1298, bound post-merge
by `ops:proof-generate --merge-sha`. It is unchanged by this proof-only repair.

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
- [x] `pnpm test:db` PASS against live Supabase (project `zfzdnfwdarxucxtaojxm`) -- 7/7, 0 fail

## Proof-only historical repair note

This proof bundle was updated on 2026-07-25 to add the mandatory T1 runtime-evidence
this lane's evidence.json was originally missing (`runtime_proof.queries` /
`row_counts`), which blocked ordinary post-merge closeout (truth-check R1/R2).
The authoritative implementation record remains **PR #1298**, merge SHA
`18de0721cd5a8577de18147bbeb18bef8fc43d77`, merged 2026-07-22T15:03:43Z. This
repair changes only the two proof files (`evidence.json`, `verification.md`,
plus the auto-regenerated `diff-summary.md`) -- it does not alter any of the
nine ratified Sole-Owner governance decisions, does not touch product code or
workflow files, and does not claim the governance document itself has
runtime-observable behavior. The `pnpm test:db` run below satisfies the
mandatory T1 runtime-evidence policy; it does not assert this diff changed
runtime behavior.

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

```text
$ pnpm test:db
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# pass 7
# fail 0
# skipped 0

Monitored-table row counts captured 2026-07-25T03:47:00Z (project zfzdnfwdarxucxtaojxm):
picks=101737 pick_lifecycle=145277 distribution_outbox=10191 audit_log=244298 settlement_records=34956
```
