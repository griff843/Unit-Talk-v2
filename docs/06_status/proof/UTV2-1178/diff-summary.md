# Diff Summary — UTV2-1178 (INIT-2.3.X)

Merge SHA: 61c88fd68aee4a7ce19f039d5c37a8a15b139600

## Summary

Governance lane closing CERT-BLK-002, CERT-BLK-003, and CERT-BLK-005 by implementing
E-2 and G-6 bypass enforcement in the invariant engine.

## Files changed

| File | Change |
|------|--------|
| `packages/invariants/src/engine.ts` | +108 lines: E-2 diagnostic emission, G-6 `validateGovernanceException()`, injectable constructor, two new exported diagnostic types |
| `packages/invariants/src/engine.test.ts` | +220 lines: adversarial tests (4 E-2 + 6 G-6), updated imports |
| `packages/invariants/src/certification/bypass-audit.md` | +10/-11 lines: E-2 and G-6 reclassified Enforced; deferred list updated |
| `docs/06_status/proof/UTV2-1178/evidence.json` | New file: T1 evidence bundle |
| `docs/06_status/proof/UTV2-1178/verification.md` | New file: pnpm verify + test:db proof |
| `docs/06_status/proof/UTV2-1178/diff-summary.md` | New file: this document |

## Scope

Strictly scoped to `packages/invariants/src/` and `docs/06_status/proof/UTV2-1178/`.
No runtime delivery, no DB migrations, no schema changes.

## Risk

Low. Changes are additive — new exported types and a new method on `InvariantEngine`.
No existing behavior removed or altered. The E-2 path previously did `continue` silently;
now it emits an event before `continue`. The G-6 path adds a new opt-in method callers
must invoke; no existing call sites are affected.
