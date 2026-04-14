> **⚠️ SUPERSEDED** — This schema was superseded on 2026-04-11 by [`docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md`](../05_operations/EVIDENCE_BUNDLE_TEMPLATE.md) (UTV2-532). New evidence bundles must use the canonical template. This file is retained for audit trail of issues gated under UTV2-157.

# Proof Bundle Schema

**Status:** RATIFIED 2026-03-29
**Lane:** claude (governance)
**Issue:** UTV2-157
**Authority:** Standard format for all sprint close proof bundles from Wave 1 hardening onward.

---

## Purpose

Proof bundles are the durable evidence record for a sprint close. They answer one question: **was the work independently verified to be correct and complete?**

Prior proof bundles (M11–M13, Weeks 7–21) used ad-hoc formats. This schema standardizes future bundles so:
- Evidence is comparable across milestones
- Claims are auditable against repo state
- Verification status is unambiguous
- Future Claude sessions can quickly determine what was proven

---

## Schema

Every proof bundle is a markdown file named:
```
docs/06_status/proof_bundle_<milestone_or_wave>_<YYYY-MM-DD>.md
```

Example: `docs/06_status/proof_bundle_wave1_2026-04-05.md`

### Required Sections

```markdown
# Proof Bundle — <Milestone/Wave Name>

**Date:** YYYY-MM-DD
**Issue:** <Linear issue ID or N/A>
**Verifier:** claude (independent verification lane)
**Branch/Commit:** <git ref at time of verification>

---

## 1. Scope

What work is being verified in this bundle.
- List each issue/PR included
- List each issue/PR explicitly excluded (if partial close)

---

## 2. Gate Results

| Gate | Result | Notes |
|------|--------|-------|
| `pnpm test` | PASS / FAIL | Test count: N/N |
| `pnpm type-check` | PASS / FAIL | |
| `pnpm lint` | PASS / FAIL | |
| `pnpm build` | PASS / FAIL | |
| `pnpm test:db` | PASS / FAIL / SKIPPED | (requires live Supabase) |

All gates must PASS for a bundle to be valid. If any gate is SKIPPED, state why.

---

## 3. Runtime Verification

For each item in scope, verify against the preferred order:
1. Live DB query (Supabase MCP / `pnpm test:db`)
2. Operator surface (`GET /api/operator/snapshot`)
3. API response
4. Worker log (last resort)

| Item | Verification Method | Evidence | Result |
|------|---------------------|----------|--------|
| <feature/fix> | <method> | <DB row ID / API response snippet> | PASS / FAIL / PARTIAL |

---

## 4. Schema Consistency

| Check | Result |
|-------|--------|
| All migrations in `supabase/migrations/` are applied to live DB | PASS / FAIL |
| `database.types.ts` is current (`pnpm supabase:types` matches source) | PASS / FAIL |
| No hand-edits to `database.types.ts` | PASS / FAIL |

---

## 5. Audit Trail

Confirm audit log rows exist for all state transitions covered by this bundle:
- List expected audit actions
- List actual audit row IDs found (from live DB query)

---

## 6. Prior Artifacts Unmodified

Confirm no unintended mutations to prior work:
- Settlement records: original rows not mutated
- Audit log: no rows deleted or updated
- Prior receipts: idempotency keys unchanged

---

## 7. Open Items

Anything that was found but is NOT blocking the close:
- Known limitations with `(issue ID)` filed
- Accepted tech debt with rationale

---

## 8. Verdict

**PASS** / **FAIL** / **PARTIAL**

If PASS: this bundle serves as the close artifact for <milestone/wave>.
If FAIL: list blockers. Do not mark milestone closed.
If PARTIAL: list what is proven and what remains open.
```

---

## Historical Proof Bundles

Pre-schema proof artifacts exist for Weeks 7–16 and M11–M13. They are not retroactively conformed — they are marked as pre-schema artifacts:

| Period | Artifact | Status |
|--------|----------|--------|
| Weeks 7–16 | `docs/06_status/week_*_proof_template.md` | Pre-schema (historical only) |
| M11 | inline in `docs/06_status/week_11a_closeout_checklist.md` | Pre-schema |
| M12 | inline in `docs/06_status/PROGRAM_STATUS.md` | Pre-schema |
| M13 | inline in `docs/06_status/PROGRAM_STATUS.md` | Pre-schema |
| Wave 1 | `docs/06_status/proof_bundle_wave1_*.md` (TBD) | **Conforms to this schema** |

---

## Notes

- The bundle is produced by the Claude (verification) lane — never by Codex (implementation) lane.
- A bundle is NOT a summary of what was built. It is evidence that what was built works.
- "Verified" means independently confirmed against live state, not inferred from implementation intent.
- If Supabase MCP is unavailable during verification, note it and use the next method down the preference order.
