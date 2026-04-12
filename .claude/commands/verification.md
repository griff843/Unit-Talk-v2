# /verification

Run tier-aware verification before any merge claim. Apply whenever you are about to declare work ready for merge, ready for truth-check, or ready for PM review.

**Canonical specs:**
- `docs/05_operations/EXECUTION_TRUTH_MODEL.md` (tier matrix)
- `docs/05_operations/TRUTH_CHECK_SPEC.md` (static vs runtime proof)
- `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` (T1 bundle shape)

---

## When this skill applies

Apply automatically when:
- a lane is approaching `status: merged` or `ops:lane:close`
- preparing a T1 evidence bundle
- reviewing another lane's claimed completion
- a Codex lane has returned and you are about to run `codex:receive`
- PM asks "is this verified?"
- any time you catch yourself about to say "tests pass" without having just run them

---

## Core principle

**Verification is fail-closed and tier-aware.** If a required check is missing, uncertain, or stale, the verdict is FAIL — not "probably fine." Report the gap; do not paper over it.

Static proof alone is never sufficient for T1. Runtime proof alone is never sufficient either. Both are required for T1.

---

## Tier matrix

| Tier | Scope | Required Verification | Required Proof | Merge Authority |
|---|---|---|---|---|
| **T1** | migrations, shared contracts, runtime routing, scoring/promotion/lifecycle, governance | `type-check` + `test` + `test:db` + tier-specific runtime proof | Evidence bundle v1 (static + runtime), SHA-tied, `evidence:validate` passes | PM label `t1-approved` on PR |
| **T2** | isolated logic/refactor, service-internal, non-shared routes | `type-check` + `test` + issue-specific verification | Diff summary + verification log in manifest | Orchestrator merges on green after diff review |
| **T3** | docs, isolated UI, typos, config-only, comments | `type-check` + `test` | Green CI on merge SHA | Orchestrator merges on green |

**Tier is a Linear label**, snapshot into the manifest at lane start. If tier is unclear, it is **not** T3 by default — escalate to PM.

---

## Static proof vs runtime proof

**Static proof** is verifiable without running the merged code:
- `pnpm type-check` output
- `pnpm test` output (unit tests against in-memory repos)
- `pnpm lint` output
- diff summary against base branch
- schema validation of artifacts
- grep guards (import boundaries, phase-boundary invariants)
- CI check runs on the merge commit

**Runtime proof** requires the merged code to have run against real infrastructure:
- `pnpm test:db` against live Supabase (not in-memory)
- row counts / states queried from Supabase after a real run
- distribution_outbox rows, receipts, audit_log entries
- delivery outcomes from the worker
- materializer output visible in `market_universe`
- scanner runs producing `pick_candidates` rows
- no new `failed` / `dead_letter` rows within the merge window

**T1 requires both.** Neither substitutes for the other. A passing unit-test suite against in-memory repositories is not runtime proof.

---

## Pre-merge verification checklist

Before claiming a lane is ready for merge (or for `ops:truth-check`), run and capture:

**All tiers:**
- [ ] `pnpm type-check` — green
- [ ] `pnpm test` — green, test count did not decrease unexpectedly
- [ ] diff reviewed for scope bleed, accidental deletions, unrelated edits
- [ ] files changed are within `file_scope_lock`
- [ ] CI on the PR is green (not the branch, the PR)

**T2 additions:**
- [ ] issue-specific verification command(s) from the task packet — captured in manifest verification log
- [ ] diff summary written

**T1 additions:**
- [ ] `pnpm test:db` against live Supabase — green
- [ ] runtime proof captured (row counts, receipts, audit entries — tied to merge SHA after merge)
- [ ] evidence bundle generated via `pnpm evidence:new UTV2-###`
- [ ] evidence bundle validated via `pnpm evidence:validate <path>`
- [ ] bundle has both `static_proof` and `runtime_proof` sections populated
- [ ] verifier identity recorded and distinct from implementing agent
- [ ] phase-boundary invariants hold (if Phase 2: no writes to `picks` from candidate layer, `shadow_mode` remains `true`, etc.)

**Migrations specifically:**
- [ ] migration number is serial (no collision with a concurrent lane)
- [ ] `pnpm supabase:types` regenerated
- [ ] Supabase advisors checked for new issues
- [ ] rollback note documented

---

## What "I ran the tests" must mean

A verification claim is valid only if:

1. **You ran the command in the current session**, against the current code state, **just now**.
2. **You captured the output** — either in the manifest, in the evidence bundle, or in a verification log.
3. **You checked the output** — not just the exit code, but the counts, the new rows, the absence of warnings.
4. **Stale test runs do not count.** A test run from before your last commit is not verification.

If any of these are not true, the claim is unverified. State that clearly — do not launder uncertainty into false confidence.

---

## Fail-closed reporting

When verification fails or is uncertain, report it mechanically. Never soften.

**Allowed verdicts:**
- `PASS` — specific commands ran, outputs captured, all green
- `FAIL` — specific check failed; name the check and the output
- `INCOMPLETE` — a required check could not run; name the missing input (credentials, dependency, environment)
- `STALE` — proof exists but does not tie to the current merge SHA

**Forbidden verdicts:**
- "probably fine"
- "should pass"
- "I think tests are green"
- "nothing looks broken"
- "verification complete" without enumerating what ran

If the command did not execute, the verdict is not PASS. If the output was not captured, the verdict is not PASS.

---

## Red flags — stop if you see these

- A T1 claim with no `runtime_proof` section
- A proof file `mtime` older than the merge commit timestamp
- An evidence bundle where `verifier.identity` matches the implementing agent
- A merge claim where the only evidence is "tests pass" with no timestamp or SHA
- `test:db` skipped because "credentials weren't handy"
- Verification run against the branch but not against the merge commit on `main`
- A Codex return merged before `codex:receive` scope-diff ran
- `lint` or `type-check` errors being described as "pre-existing"
- Warnings in verification output being ignored instead of explained

Report the gap. Do not merge. Do not claim Done.

---

## Output format (when invoked explicitly)

```
## Verification Report

### Lane
Issue: UTV2-###
Tier: [T1 | T2 | T3]
Merge SHA: [sha or "pre-merge"]

### Static proof
- type-check: PASS / FAIL / NOT RUN — [timestamp]
- test: PASS / FAIL / NOT RUN — [N passing, M failing, timestamp]
- lint: PASS / FAIL / NOT RUN
- diff reviewed: YES / NO
- scope bleed: NONE / FOUND ([file])
- CI on merge SHA: GREEN / RED / PENDING / N/A

### Runtime proof (T1 required; T2 optional; T3 skipped)
- test:db: PASS / FAIL / NOT RUN — [timestamp]
- row-count checks: [details or N/A]
- audit log entries: [details or N/A]
- no new failed/dead_letter rows: YES / NO / N/A

### Phase-boundary invariants (if applicable)
- [name]: HOLDS / VIOLATED ([location])

### Evidence bundle (T1 only)
- path: [path]
- schema_version: [1 / missing]
- static_proof populated: YES / NO
- runtime_proof populated: YES / NO
- verifier.identity: [identity] (distinct from implementer: YES / NO)
- evidence:validate: PASS / FAIL

### Verdict
PASS — ready for merge / truth-check
— or —
FAIL — [specific check IDs and outputs]
— or —
INCOMPLETE — [missing inputs]
— or —
STALE — [which artifact, which SHA mismatch]
```
