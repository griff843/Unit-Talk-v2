# Diff Summary — UTV2-1082

**Merge SHA:** `95ecab3468623eecf07d74de9d3e581ff62ad9d2`

## Changes

### scripts/ops/runtime-contract-check.ts (new)
Pre-dispatch runtime health checker with 5 contracts:
- codex CLI exec subcommand present
- gh auth status passing
- Linear API reachable with valid token
- Node version >= 20
- codex version >= 0.1.0

Supports `--json` flag; exits 1 on any hard failure.

### scripts/ops/runtime-contract-check.test.ts (new)
5 unit tests: JSON output structure, check count, field shapes, node version pass, missing token fail.

### package.json
Added `ops:runtime-contract-check` script entry.
