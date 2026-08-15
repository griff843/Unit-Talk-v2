# PROOF: UTV2-1690

MERGE_SHA: 261a88dacb6cf123d654fd974576ab1d4cd54a2e

Verified implementation SHA: `261a88dacb6cf123d654fd974576ab1d4cd54a2e`

Pre-merge this anchor identifies the verified implementation commit. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

## Summary

UTV2-1690 closes the terminal-release gap between linked lane worktrees and the control checkout. A successful terminal transition now releases the canonical control-checkout lease transactionally, cleanup replay is idempotent, and truth-check refuses a done lane that still holds scope.

## Evidence

- Control-root regressions resolve the common Git directory from both the control checkout and a linked-worktree shape.
- Filesystem runtime regressions prove the lease is released before terminal manifest persistence, a manifest-write failure restores the exact prior bytes, a successful write leaves the release durable, and replay adds no history.
- Finalize regressions prove a hosted close followed by local finalize releases terminal artifacts before reconciliation, even with a completed journal.
- Truth-check regressions prove M8 fails `done + active`, passes `done + released`, and keeps pre-terminal `merged` eligible for the close transition.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | DB-client boundary, sync/alignment, environment, lint, `pnpm type-check`, build, `pnpm test`, Smart Form verification, and command verification completed with exit 0. |
| `pnpm verify` | EXPECTED DEFERRED AFTER STATIC PASS | The complete static gate passed again; `test:live-db` then reached `pnpm test:db` and the staging-isolation guard refused the local `host=127.0.0.1 ref=unidentified` target before DB access. PR CI owns the required staging execution. |
| `pnpm exec tsx --test 'scripts/ops/lane-close.test.ts' 'scripts/ops/lane-finalize.test.ts' 'scripts/ops/lease-registry.test.ts' 'scripts/ops/truth-check-lib.test.ts'` | PASS | 314 tests passed, 0 failed, 0 skipped. |
| `pnpm type-check` | PASS | Completed as part of `pnpm verify:static` with exit 0. |
| `pnpm test` | PASS | Root aggregate completed as part of `pnpm verify:static` with exit 0. |
| `pnpm test:db` | BLOCKED / DEFERRED | The staging-isolation guard refused the local target before creating a DB client: observed `host=127.0.0.1 ref=unidentified`; the packet-mandated disposition is recorded below. |
| Filesystem runtime proof | PASS | Transaction ordering, byte-exact rollback, durable commit, idempotent replay, control-root identity, and the terminal M8 invariant execute against temporary real files rather than mocks. |

Focused TAP summary:

```text
# tests 314
# pass 314
# fail 0
# skipped 0
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

The required PR T1 Proof Gate supplies those credentials and runs the writable smoke suite against the isolated staging project. No environment file was copied or modified locally.

### Scope and R-level disposition

The implementation changes only `scripts/ops/**` terminal coordination tooling and tests. `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` passed with 15 changed files and no matching rules, so no R-level artifacts are required. No Tier C source path, application runtime, migration, contract, generated database type, or production row is touched.

`pnpm verify` was run after the complete proof bundle was committed. Its static half passed and its live-DB half produced the governed staging deferral recorded above.
