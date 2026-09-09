# PROOF: UTV2-1688 diff summary

MERGE_SHA: 949459feaaadf2a54bd7eeee0a8755a9dca3415b
Execution SHA: b2cfd6d2132e8f1e07510e4afb3b148939f5c8d4

Widen the executor-result validator to recognize the `bootstrap/` branch namespace in **both**
copies of its field-validation rules, and make the duplication self-policing so it cannot drift
again.

| File | Change |
|---|---|
| `scripts/ops/executor-result-validate.ts` | Extract `EXECUTOR_RESULT_ISSUE_ID_RE` and `EXECUTOR_RESULT_BRANCH_RE` as exported constants; add `bootstrap` to the branch alternation; update the refusal message. No binding rule changed. |
| `.github/workflows/executor-result-validator.yml` | Add `bootstrap` to the inline `branchRe` — this is the copy that actually gates merges — and record why the duplication exists and what now polices it. |
| `scripts/ops/executor-result-validate.test.ts` | Six tests: one passing case, three controls that must still fail, and two that read the workflow and assert both inline literals are byte-identical to the exported ones. |
| `docs/mission/plan.md` | Correct the cutover's "highest-value hunk" claim, which named a script the required check does not run; record the PL3/L3 inversion and the fourth leaked lease. |

**What is deliberately not here.** No `work/` branch namespace and no `WORK-###` issue ID. Widening
the required check to admit a repo-minted identity changes what a required check *requires* and is
reserved (`intent.md` reserved decision 7); it is prepared for review, not applied.
