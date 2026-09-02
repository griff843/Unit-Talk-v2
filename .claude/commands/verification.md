# /verification

Verify before any merge claim. Fail-closed: if a check is missing, uncertain, or stale, the verdict
is FAIL.

Verification depth follows **risk** — what the diff touches — not a tier label and not how the work
was admitted. The authority is `.github/workflows/merge-gate.yml` (Risk-Scoped Merge Authority,
RMA/v1). If this skill and that workflow diverge, the workflow wins and this skill is stale.

**Policy:** `docs/05_operations/RESERVED_RISK_SURFACES.json` · **Classifier:** `scripts/ops/merge-authority.cjs`

---

## Step 0 — classify the diff

```bash
node scripts/ops/merge-authority.cjs --base origin/main --head HEAD
```

| Classification | What it means | What is required |
|---|---|---|
| `auto` | touches no reserved surface | green CI is the whole gate — `verify`, `P0 Protocol`, `Executor Result Validation` |
| `human` | touches a reserved surface | the above **plus** a `griff-approved` label **and** a head-SHA-bound `pm-verdict/v1` APPROVED comment from CODEOWNERS — both, neither alone |

Fail-closed: an unreadable policy, an unavailable diff, or anything unclassifiable reserves the
merge. `governance:pause` is a hard block regardless.

A `human` classification does not mean the work was wrong or that it stops. It means one specific
change waits for one specific person, while everything else continues.

---

## Verification checklist

**Every change:**
- [ ] `pnpm verify` green on the PR (env:check + lint + type-check + build + test)
- [ ] test count did not decrease
- [ ] diff reviewed for scope bleed — every file traces to the stated goal
- [ ] required CI checks green on the SHA that will actually merge, not a stale branch head

**Changes runtime behavior:**
- [ ] a test exists that **fails if the change is reverted** — name it in the PR
- [ ] the behavior is verified by execution, not by reading the code

**Touches DB read/write paths** (`supabase/migrations/**`, `packages/db/**`, `apps/api/src/**-service.ts`):
- [ ] `pnpm test:db` against live Supabase — green, output pasted in the PR
- [ ] runtime evidence captured where the claim is about persisted state (row counts, receipts, audit entries)

**Migrations:**
- [ ] serial migration number (no collision)
- [ ] `pnpm supabase:types` regenerated
- [ ] rollback note documented
- [ ] merges alone — never two migrations in one deploy

**Reserved surface (`human`):**
- [ ] the PR body names the surface, the production effect, and how it is reversed
- [ ] `griff-approved` label present
- [ ] `pm-verdict/v1` APPROVED comment bound to the current head SHA

**Legacy — only when a proof bundle actually exists:** an R-level lookup
(`tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`) and the evidence-bundle steps
(`pnpm evidence:new` / `pnpm evidence:validate`) belong to the prior operating model. They are not
required for ordinary work. When a bundle exists it must still be true — see `/proof-authoring`.

---

## Proof rules

- **Static proof** = verifiable without running merged code (CI, diffs, schema validation, grep guards)
- **Runtime proof** = requires merged code against real infra (test:db, row counts, receipts, audit entries)
- **A runtime claim requires runtime proof.** Static proof never substitutes for it.
- Evidence must bind to the code it describes. Evidence produced against a different SHA is invalid.
- A verification claim requires: ran in current session, output captured, output checked. Stale runs don't count.

---

## Verdicts

- `PASS` — commands ran, outputs captured, all green
- `FAIL` — specific check failed (name it)
- `INCOMPLETE` — required check could not run (name missing input)
- `STALE` — proof doesn't tie to current merge SHA

---

## PM verdict format (required only for a `human`-classified diff)

A reserved diff needs both the `griff-approved` label and this comment; neither alone is sufficient,
and the comment must bind the current head SHA. An `auto` diff needs no verdict at all. When posting
a PM verdict comment, use exactly this format — `parseVerdict()` in merge-gate.yml requires minimum 3 lines and `Issue:` on line 3:

```
PM_VERDICT: APPROVED
schema: pm-verdict/v1
Issue: UTV2-NNN
```

Replace `APPROVED` with `CHANGES_REQUIRED` to block. The `Issue:` line is required by the parser
(minimum 3 lines, `Issue:` on line 3); where no issue exists, the PR number is the identifier.
Full schema: `docs/05_operations/schemas/pm-verdict-v1.md`.

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
| "Tests pass, so it's done" | Tests passing is necessary, not sufficient. Name the test that fails without the change. |
| "CI is green on the branch" | A branch behind `main` is graded by old rules against old code. Verify the SHA that merges. |
| "I ran this last session" | Stale verification is not verification. Re-run in the current session or don't claim. |
| "It's low risk, I can skip the checklist" | `auto` means no human is required. It does not mean no verification is required. |
| "The proof file exists" | Existence ≠ validity. Evidence nothing checks is not evidence. |
| "It's blocked on approval, so I'm blocked" | One change is. Everything touching no reserved surface still moves. |
