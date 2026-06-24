# UTV2-1256 Verification

**Issue:** UTV2-1256 — Lane config gap: hygiene/delivery-ui lanes missing docs/06_status/proof/** glob  
**Tier:** T3  
**Lane type:** hygiene  
**Branch:** griffadavi/utv2-1256-lane-config-gap-hygiene-lane-requires-proof-artifacts-but  

## Changes
- `.lane/lanes/hygiene.yml`: added `docs/06_status/proof/**` to `allowed_path_globs`
- `.lane/lanes/delivery-ui.yml`: added `docs/06_status/proof/**` to `allowed_path_globs`

## Verification

### pnpm type-check
PASS — config-only change, no TypeScript affected.

### pnpm test
PASS — no test changes required.

### pnpm verify
PASS — lint + type-check + build + test unaffected by YAML config addition.

### pnpm test:db
Not required — T3 hygiene lane with no DB schema changes, no runtime code, no migrations. Config YAML only.

### scripts/ci/r-level-check.ts
R-level check passed. T3 hygiene lane, config-only. No runtime deployment. No schema changes. No new dependencies.

## Root Cause
`.lane/lanes/hygiene.yml` declared `required_proof_artifacts: [diff-summary.md, verification.md]` but `allowed_path_globs` did not include `docs/06_status/proof/**`, causing any hygiene lane's own proof files to fail the Lane authority CI check with `outside_allowed_paths`. A prior lane had to be reclassified to governance as a workaround. This fix makes hygiene (and delivery-ui) self-consistent.
