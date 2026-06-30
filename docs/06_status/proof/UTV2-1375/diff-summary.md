# UTV2-1375 Diff Summary

## Issue
"Build pnpm ops:preflight — stop using CI as the discovery mechanism"

## Change
Added `runGateEquivalentChecks` to `scripts/ops/preflight.ts` — a new check group (PX1–PX5) that surfaces CI-equivalent failures locally at preflight time, before a lane is started and before CI runs.

### PX1 — `pnpm verify:quick`
Runs the quick static verification suite (sync-check, env, lint, type-check) locally so the operator discovers drift immediately rather than waiting for CI to fail.

### PX2 — Branch discipline
Runs `pnpm ops:branch-discipline` to validate that the branch name and any existing commits contain exactly one issue ID and no cross-issue references.

### PX3 — Proof auditor gate (conditional)
If a proof directory for this issue already exists, runs the proof-auditor-gate against it to confirm evidence is present and SHA-bound. Skips if no proof dir exists (normal at preflight time before implementation).

### PX4 — Runtime verifier gate (conditional)
Same conditional: if a proof dir exists, runs the runtime-verifier-gate. Skip if missing.

### PX5 — T1 proof dir presence (T1 only)
For T1 lanes, asserts the proof directory is already present at preflight time, catching early the most common T1 closeout failure.

### Output formatting
Added markdown table output to `writeOutput` so operators can scan a structured summary instead of a flat log line list.

## Files changed
- `scripts/ops/preflight.ts` — 103 lines added

## Verification
`pnpm verify:static` passed (all unit tests including `scripts/ops/preflight.test.ts` pass).
`pnpm test:db` (database smoke) passed against live Supabase.
