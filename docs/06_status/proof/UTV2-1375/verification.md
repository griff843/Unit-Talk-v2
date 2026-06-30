# UTV2-1375 Verification

## Verification

### pnpm type-check
Passed as part of `pnpm verify:static` run by Codex during implementation.

### pnpm test
All unit tests passed including `scripts/ops/preflight.test.ts` and all existing ops test files.

Test suites exercised:
- `test:apps` — passed
- `test:verification` — passed
- `test:domain-*` (all domain packages) — passed
- `test:ops` — passed (includes `preflight.test.ts`, `shared.test.ts`, and 60+ other ops tests)
- `test:t1-proof:local` — passed

### pnpm test:db
Database smoke test (`apps/api/src/database-smoke.test.ts`) passed against live Supabase project `zfzdnfwdarxucxtaojxm`.

### Issue-specific verification
The `runGateEquivalentChecks` function:
- PX1 invokes `pnpm verify:quick` and surfaces failures directly in the preflight output
- PX2 invokes `pnpm ops:branch-discipline` for early cross-reference detection
- PX3/PX4 are proof-gate checks gated on proof dir existence (skip when no proof dir present)
- PX5 is a T1-only proof dir presence check

All existing preflight tests continue to pass — the new checks are additive only. The `fastBaselineAllowed` function, `isLaneRegistryPath` function, and `readConfiguredEnvValue` usage are all still present as expected by the test assertions.

### R-level check
R1–R5 checks: governance lane, no new packages, no DB schema changes, no migration added, no T1 runtime path touched.
