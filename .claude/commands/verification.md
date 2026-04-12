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
- A verification claim requires: ran in current session, output captured, output checked. Stale runs don't count.

---

## Verdicts

- `PASS` — commands ran, outputs captured, all green
- `FAIL` — specific check failed (name it)
- `INCOMPLETE` — required check could not run (name missing input)
- `STALE` — proof doesn't tie to current merge SHA
