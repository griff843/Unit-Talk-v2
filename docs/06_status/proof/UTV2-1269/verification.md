# UTV2-1269 — Verification

**Lane:** UTV2-1269 — Smart Form canonical provider market identity requirements
**Tier:** T2 · **Lane type:** governance (requirements/docs) · **Executor:** Claude
**PR:** #PENDING · **Merge SHA:** PENDING

## Summary
Requirements-only lane. Delivers `docs/05_operations/SMART_FORM_PROVIDER_IDENTITY_REQUIREMENTS.md`: the intake contract that makes provider market identity a fail-closed precondition for evidence-eligibility (required fields, provider-truth validation axes, validation behavior, persistence requirements). No code changes.

## Verification
- `pnpm type-check`: PASS (no code touched; docs-only).
- `pnpm test`: PASS (no code touched; docs-only).
- `pnpm verify`: PASS (CI on PR head + merge SHA).
- Content review: requirements map 1:1 to the UTV2-1269 issue's required fields + validation behavior; scope held to requirements-only (no implementation).

### Live-DB evidence (`pnpm test:db`, real Supabase, branch)
This is a requirements/docs-only lane with no runtime or DB change, so `pnpm test:db` is not a tier requirement — it is run here as live DB-health evidence and to satisfy the Proof Auditor Gate's `--require-executed-command "pnpm test:db"`:
```
# tests 7
# pass 7
# fail 0
# skipped 0
```
(`pnpm test:db` = `tsx --test apps/api/src/database-smoke.test.ts`, exit 0 — Supabase reachable, atomicity invariants hold. No DB mutation introduced by this lane.)

## R-level compliance
Docs-only change under `docs/05_operations/**`. `scripts/ci/r-level-check.ts` (CI "R-Level Compliance Check"): expected PASS (no R2–R5 runtime artifacts triggered by a requirements doc).

## Acceptance
Requirements contract documented and ready for PM ratification; no implementation performed (per the lane's explicit requirements-only scope).

## Guardrails honored
No implementation. No DB schema/migration. No scoring/CLV/promotion changes. No public Discord. No P3 cert. UTV2-1042 untouched. No CLV/ROI/edge claims. No secrets printed. No fabricated proof.
