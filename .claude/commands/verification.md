# /verification

Run tier-aware verification before any merge claim or `ops:truth-check`. Fail-closed: if a check is missing, uncertain, or stale, the verdict is FAIL.

**Specs:** `EXECUTION_TRUTH_MODEL.md` (tier matrix), `TRUTH_CHECK_SPEC.md` (static vs runtime), `EVIDENCE_BUNDLE_TEMPLATE.md` (T1 bundle)

---

## Tier matrix

| Tier | Required Verification | Required Proof | Merge Authority |
|---|---|---|---|
| **T1** | `type-check` + `test` + `test:db` + runtime proof | Evidence bundle v1 (static + runtime), SHA-tied | `t1-approved` label **and** `pm-verdict/v1` APPROVED comment from CODEOWNERS |
| **T2** | `type-check` + `test` + issue-specific | Diff summary + verification log | any ONE of: `pm-verdict/v1` APPROVED comment from CODEOWNERS, a GitHub PR review approval, or an `executor-result/v1` self-attestation comment from an authorized reviewer |
| **T3** | `type-check` + `test` | Green CI on merge SHA | Green CI + valid executor result — no PM verdict |

Merge Authority is defined mechanically by `.github/workflows/merge-gate.yml` (ratified 2026-05-18, UTV2-979). This table must always match that workflow — if they diverge, the workflow wins and this table is stale.

**T2 has three accepted approval artifacts, not two** (`merge-gate.yml`, T2 branch):

1. a `pm-verdict/v1` APPROVED comment from a CODEOWNERS member;
2. a GitHub PR review approval; or
3. an `EXECUTOR_RESULT: READY_FOR_REVIEW` / `schema: executor-result/v1` comment from an authorized reviewer (UTV2-1523).

Path 3 exists because **the orchestrator cannot always self-approve**: when the PR author and the reviewing identity are the same GitHub account, GitHub rejects the review outright, so `gh pr review --approve` is not a reliable T2 path. Do not assume orchestrator self-approval satisfies the gate — when it is refused, post the `executor-result/v1` comment instead. Comment format and required fields: `docs/05_operations/schemas/executor-result-v1.md`.

---

## Verification scope

Choose additional behavioral checks from changed paths and concrete failure risks. Required tier, R-level, CI, and proof obligations below still apply; this skill grants no waiver. Do not add a second verification pass solely because work was delegated. Preserve independent review where policy requires it. Stop optional testing once acceptance evidence is sufficient.

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
- [ ] `verifier.identity` distinct from implementing agent

**Migrations:**
- [ ] serial migration number (no collision)
- [ ] `pnpm supabase:types` regenerated
- [ ] rollback note documented

---

## Proof rules

- **Static proof** = verifiable without running merged code (CI, diffs, schema validation, grep guards)
- **Runtime proof** = requires merged code against real infra (test:db, row counts, receipts, audit entries)
- **T1 requires both.** Neither substitutes for the other.
- Proof must reference the merge SHA. Stale proof (pre-merge mtime or wrong SHA) is invalid.
- A verification claim requires inspectable output, provenance, and valid source/environment/SHA binding under the current proof policy. A session change alone does not invalidate evidence. Re-run when relevant inputs changed, freshness expired, or a required gate demands it.

---

## Verdicts

- `PASS` — commands ran, outputs captured, all green
- `FAIL` — specific check failed (name it)
- `INCOMPLETE` — required check could not run (name missing input)
- `STALE` — proof doesn't tie to current merge SHA

---

## PM verdict format (T1 merge gate; one of three T2 artifacts)

Required for every T1 merge. For T2 it is one of the three accepted approval artifacts listed in the tier matrix above; a `pm-verdict/v1` comment is needed only when neither a GitHub PR review approval nor an `executor-result/v1` self-attestation is used. When posting a PM verdict comment, use exactly this format — `parseVerdict()` in merge-gate.yml requires minimum 3 lines and `Issue:` on line 3:

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

**Required instead:** state the result, cite the evidence and applicable SHA, and disclose limitations. Keep raw logs in the proof artifact; include only excerpts needed to explain a failure or decision.

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
| "I ran this last session" | Inspect the recorded evidence and its binding. Reuse it only if applicable policy and unchanged inputs permit it. |
| "It's only T3, I can skip the checklist" | T3 still requires type-check + test + green CI. No tier skips verification. |
| "The proof file exists" | Existence ≠ validity. Check the header SHA matches the merge SHA. |
