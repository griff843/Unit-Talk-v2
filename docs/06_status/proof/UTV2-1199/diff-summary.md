# Diff Summary — UTV2-1199 D-CONST-8

**Merge SHA:** facf60f292b6c76ed403ae0e6bacfe3ce8c0129e
**Sprint:** SPRINT-D-CONST-8-FAIL-CLOSED-DOC-RECONCILIATION
**Lane type:** governance
**Tier:** T2

## Change Summary

Documentation-only sprint. No code changed.

| File | Change |
|---|---|
| `packages/db/CLAUDE.md` | Corrected "Unregistered fields are fail-open" → fail-closed; added Fail-Closed Invariants section |
| `packages/contracts/CLAUDE.md` | Added Fail-Closed Authority Contract section |
| `docs/00_constitution/CERTIFICATION_GAP_REGISTER.md` | D-CONST-8 OPEN → RESOLVED |
| `docs/00_constitution/CONSTITUTIONAL_DRIFT_AUDIT.md` | D-CONST-8 row updated to RESOLVED |
| `docs/00_constitution/CONSTITUTION_IMPLEMENTATION_MATRIX.md` | §8 note corrected |
| `.lane/lanes/governance.yml` | Added `docs/00_constitution/**` and `packages/db/CLAUDE.md` to allowed_path_globs |

Full proof bundle: `docs/06_status/proof/SPRINT-D-CONST-8-FAIL-CLOSED-DOC-RECONCILIATION/`

## Closes

D-CONST-8 — documentation now accurately describes the fail-closed behavior that was already present in `packages/db/src/writer-authority.ts`.
