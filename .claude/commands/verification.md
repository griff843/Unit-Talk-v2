# /verification

Run tier-aware verification before any merge claim or `ops:truth-check`. Fail-closed: if a check is missing, uncertain, or stale, the verdict is FAIL.

**Specs:** `EXECUTION_TRUTH_MODEL.md` (tier matrix), `TRUTH_CHECK_SPEC.md` (static vs runtime), `EVIDENCE_BUNDLE_TEMPLATE.md` (T1 bundle)

---

## Tier matrix

| Tier | Required Verification | Required Proof | Merge Authority |
|---|---|---|---|
| **T1** | `type-check` + `test` + `test:db` + runtime proof | Evidence bundle v1 (static + runtime), SHA-tied | PM `t1-approved` label |
| **T2** | `type-check` + `test` + issue-specific | Diff summary + verification log | Orchestrator on green |
| **T3** | `type-check` + `test` | Green CI on merge SHA | Orchestrator on green |

---

## Pre-merge checklist

**Step 0 — R-level lookup (run before any other check, all tiers):**
- [ ] Read `docs/05_operations/r1-r5-rules.json`
- [ ] Identify which rules are triggered by the changed file paths (match `paths[]` globs)
- [ ] For each triggered rule: verify every artifact in `artifactRequirements[]` is present at the corresponding path in `artifactPaths`
- [ ] If any mandatory artifact is absent → verdict is **FAIL** (not INCOMPLETE — missing artifacts block merge)
- [ ] Items listed in `pmGated[]` are advisory warnings only — emit the warning, do NOT block on absence alone

**Step 0 execution (concrete command):**
```
Run: tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
If verdict is FAIL: generate the missing artifacts listed in the output, then re-run until PASS.
Do not proceed to ops:truth-check without a PASS from r-level-check.ts.
```

**Step 1 — merge readiness (run it; do not assert it):**
```
Run: pnpm ops:merge-ready <PR#>
```
Running this is mandatory before any merge-ready claim. A green checks list is not the same question: `mergeStateStatus` reflects the whole rollup rather than the required subset, so a PR can read `BLOCKED` on an unrelated non-required check, and a required context that was never created reads as absent rather than failing.

**All tiers:**
- [ ] `pnpm type-check` — green
- [ ] `pnpm test` — green, count did not decrease
- [ ] diff reviewed for scope bleed
- [ ] files changed within `file_scope_lock`
- [ ] CI on PR is green

**T2 additions:**
- [ ] issue-specific verification captured in verification log
- [ ] diff summary written

**T1 additions:**
- [ ] `pnpm test:db` against live Supabase — green
- [ ] runtime proof captured (row counts, receipts, audit entries — SHA-tied)
- [ ] evidence bundle generated: `pnpm evidence:new UTV2-###`
- [ ] evidence bundle validated: `pnpm evidence:validate <path>`
- [ ] both `static_proof` and `runtime_proof` populated
- [ ] `runtime_proof.queries` **and** `runtime_proof.row_counts` are non-empty — truth-check's R1/R2 fail on empty arrays even when `runtime_proof` itself exists, and this is the single most common cause of a lane that merges but cannot close
- [ ] `verifier.identity` distinct from implementing agent — **check this by reading it**, not by trusting truth-check's P10, which compares against `manifest.created_by` (an owner string like `claude`) and therefore passes even when the verifier is the implementing lane's own branch

**Migrations:**
- [ ] serial migration number (no collision)
- [ ] `pnpm supabase:types` regenerated
- [ ] rollback note documented

---

## Proof rules

- **Static proof** = verifiable without running merged code (CI, diffs, schema validation, grep guards)
- **Runtime proof** = requires merged code against real infra (test:db, row counts, receipts, audit entries)
- **T1 requires both.** Neither substitutes for the other.

### Remediation-path verification

**A refusal that names a remedy is not tested until the remedy has been executed and observed to succeed.**

Whenever a control refuses, blocks, or fails closed *and* tells the operator what to run instead, the prescribed command is part of the control. Testing that the refusal fires is only half the work; the escape hatch must be walked end to end:

```
induce the condition → the control refuses → run the command it named → confirm it resolves the condition
```

This is not hypothetical. `ops:merge-wrapper main-sync` correctly refuses on a diverged branch and names `git-merge-main` as the safe remedy. `git-merge-main` runs `git merge --ff-only`, so it fails with the identical error on every branch that reaches it — the remedy cannot work in the only state that prescribes it. That defect shipped through careful implementation, independent review, mutation testing and PM approval, because every one of those verified the refusal and none executed the remedy.

The failure mode it creates is worse than a broken command: an operator who trusts the message and finds it broken reaches for the destructive alternative the control was built to prevent.

Applies equally to repair scaffolds, `--repair-merged` packets, blocking CI comments, and any error string containing "run" or "re-run". If the remedy cannot be executed in a test, say so explicitly in the proof rather than implying it was verified.
- Proof must reference the merge SHA. Stale proof (pre-merge mtime or wrong SHA) is invalid.
- A verification claim requires: ran in current session, output captured, output checked. Stale runs don't count.

---

## Verdicts

- `PASS` — commands ran, outputs captured, all green
- `FAIL` — specific check failed (name it)
- `INCOMPLETE` — required check could not run (name missing input)
- `STALE` — proof doesn't tie to current merge SHA

---

## PM verdict format (required for T2/T1 merge gate)

When posting a PM verdict comment, use exactly this format — `parseVerdict()` in merge-gate.yml requires minimum 3 lines and `Issue:` on line 3:

```
PM_VERDICT: APPROVED
schema: pm-verdict/v1
Issue: UTV2-NNN
```

Replace `NNN` with the issue number. Replace `APPROVED` with `CHANGES_REQUIRED` to block. See full schema: `docs/05_operations/schemas/pm-verdict-v1.md`.

---

## Completion discipline

**Forbidden completion language** — never use these when claiming work is done:
- "should work", "probably", "seems to", "I believe", "looks good"

**Required instead:** state what you ran, paste the output, cite the SHA. Evidence, not confidence.

**When receiving review feedback:**
- Never respond with "Great point!", "You're absolutely right!", or "Thanks for catching that!"
- Verify the feedback against actual code before implementing — reviewers can be wrong
- Push back with technical reasoning if feedback is incorrect or unnecessary
- YAGNI check: if a reviewer suggests adding something, grep for actual usage first

---

## Rationalization resistance

| You might think… | But actually… |
|---|---|
| "Tests pass, so it's done" | Tests passing is necessary but not sufficient. truth-check requires SHA-tied proof. |
| "CI is green on the branch" | Branch CI ≠ merge CI. Proof must reference the merge SHA on `main`. |
| "I ran this last session" | Stale verification is not verification. Re-run in current session or don't claim. |
| "It's only T3, I can skip the checklist" | T3 still requires type-check + test + green CI. No tier skips verification. |
| "The proof file exists" | Existence ≠ validity. Check the header SHA matches the merge SHA. |
