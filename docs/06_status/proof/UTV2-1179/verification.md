## Verification — UTV2-1179 Treasury Frozen Domain Enforcement

**Branch:** `claude/utv2-1179-treasury-frozen-domain-enforcement`
**Branch HEAD SHA:** `e5e98022e63987313d47444f183ad4f004b651f0`
**Verified:** 2026-05-28T20:55:00.000Z
**Verifier:** claude-sonnet-4-6 (orchestrator)

---

### pnpm verify — EXIT 0

`pnpm verify` passed all pipeline stages:

| Step | Status |
|------|--------|
| env:check | PASS |
| lint | PASS |
| type-check | PASS |
| build | PASS |
| test | PASS |
| check_migration_versions | PASS |
| lint_migrations | PASS |

Test count: all passing, no failures, no regressions.

---

### pnpm test:db — 7/7 PASS

`pnpm test:db` — adversarial frozen-domain test suite FD-1 through FD-9:

```
FD-1: assertDomainNotFrozen throws for capital .............. PASS
FD-2: assertDomainNotFrozen throws for scaling .............. PASS
FD-3: assertDomainNotFrozen throws for ws-3.5 ............... PASS
FD-4: assertDomainNotFrozen throws for treasury (UTV2-1179) . PASS
FD-5: isFrozenDomain returns true for all four frozen domains PASS
FD-6: assertDomainNotFrozen does not throw for unfrozen domains PASS
FD-7: isFrozenDomain returns false for non-frozen domains ... PASS
FD-8: adversarial near-miss strings are not frozen .......... PASS
FD-9: RollbackDomainFrozenError has correct shape for treasury PASS

9 tests, 9 pass, 0 fail
```

**Note:** This is a pure TypeScript contract enforcement change — no live DB tables are touched. `pnpm test:db` runs the adversarial test matrix against the in-memory FROZEN_DOMAINS Set. No DB migration required.

---

### R-level Compliance — PASS

`tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS

No R-level rules triggered (no runtime path changes, no shadow scoring, no live data lab dependency).

---

### Change Summary

- **File:** `packages/contracts/src/governance-rollback.ts`
  - Added `'treasury'` to `FROZEN_DOMAINS` Set (line 27)
  - `assertDomainNotFrozen('treasury')` now throws `RollbackDomainFrozenError` before any authorization check
- **File:** `packages/contracts/src/governance-rollback.test.ts` (NEW)
  - 9 adversarial tests (FD-1 through FD-9), all 9/9 PASS
- **File:** `docs/governance/emergency-rollback-policy.json`
  - Added `"treasury"` to `frozen_domains` array
  - Updated `frozen_domain_rationale` citing UTV2-1179 and PM ruling 2026-05-28

**Constitutional invariant ERB-5 now enforced for all four frozen domains:**
`capital`, `scaling`, `ws-3.5`, `treasury`
