# UTV2-1711 Verification Evidence

## Verification

### Required gates

| Command | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | Completed the repository static gate, including environment checks, lint, `pnpm type-check`, build, full `pnpm test`, smart-form verification, command-manifest verification, and migration checks. |
| `pnpm verify` | BLOCKED/DEFERRED after static PASS | The command completed `verify:static`, then the staging-target guard refused the writable DB stage because the local URL resolved to `host=127.0.0.1`, `ref=unidentified`, rather than required project `xskgrzbteyqdufktjrjx`. |
| `pnpm exec tsx --test 'scripts/ops/codex-exec.test.ts' 'scripts/ops/execution-checkpoint.test.ts'` | PASS | 56 tests passed, 0 failed. |
| `pnpm exec eslint scripts/ops/codex-exec.ts scripts/ops/codex-exec.test.ts scripts/ops/execution-checkpoint.ts scripts/ops/execution-checkpoint.test.ts` | PASS | No lint findings. |
| `git diff --check` | PASS | No whitespace errors. |

### Issue-specific verification

- Fresh execution with zero source diff fails with `IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE`; adding a source commit succeeds.
- Verification-only resume uses the epoch's original implementation baseline and succeeds from the cumulative source diff.
- Rework creates a new epoch at the rejected head, rejects carried-over or proof-only changes with `REWORK_NO_SOURCE_CHANGE`, and succeeds after a source correction.
- Missing checkpoint state returns `EXECUTION_STATE_UNAVAILABLE`.
- Corrupt primary state recovers from a valid sidecar with explicit recovery provenance; invalid or stale recovery state fails closed.
- Phase validity and carried findings are epoch-scoped, with provenance retained across rework.

### Mutation evidence

Each controlled mutation was applied locally, the targeted tests were run, and the original implementation was restored before the passing gate:

| Mutation | Expected failure observed |
|---|---|
| Resume overwrote the immutable epoch baseline with the attempt-start SHA. | Verification-only resume failed with `IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE`; the immutable-baseline assertion also failed. |
| Missing checkpoint state returned success. | The fail-closed missing-state assertion failed. |
| Rework reused the prior epoch baseline. | Proof-only rework incorrectly succeeded and the new-epoch baseline assertion failed. |

### Writable database proof

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

### Pending closeout evidence

- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: pending committed head.
- Merge SHA: pending PR approval and merge.
