# PROOF: UTV2-1690

MERGE_SHA: 6d9f06a4d243b1257e89144b7c73537ab87c5585

Verified implementation SHA: `6d9f06a4d243b1257e89144b7c73537ab87c5585`

Pre-merge this anchor identifies the verified implementation commit. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

## Summary

UTV2-1690 closes terminal lifecycle gaps across coordination release, repair admission, runtime-evidence applicability, and PR binding. Terminal transitions release canonical control-checkout leases transactionally; repair refuses invalidated or wrong-base PR inference; R1/R2 applicability comes from the authoritative PR file list; and issue-bearing branches that are not the registered lane branch leave the binding workflow green as a clean no-op.

## ASSERTIONS:

- [x] Linked worktrees resolve lease and merge-mutex coordination state from the control checkout.
- [x] Terminal manifest persistence cannot synchronously fail while leaving the canonical lease released; exact prior bytes are restored.
- [x] Successful closeout cannot persist a done manifest while retaining an active or stale-reclaim-required lease.
- [x] Repeated cleanup does not rewrite surrendered leases or append synthetic history.
- [x] An already-done finalize replay releases terminal artifacts before reconciliation.
- [x] M8 reports a done lane that still holds control-checkout scope and names the executable repair path.
- [x] `--repair-merged` returns named `pr_base_mismatch` without inference when the manifest carries `pr-base-mismatch`, and refuses an inferred PR whose base is wrong or unresolved.
- [x] R1/R2 can be `not_applicable` only when GitHub's paginated PR file list classifies every changed path as control-plane; mixed, missing, and ambiguous scope fail closed.
- [x] Lane PR binding exits 0 without mutation when a branch names an issue but does not match that issue manifest's registered lane branch.

## EVIDENCE:

- Control-root regressions resolve the common Git directory from both the control checkout and a linked-worktree shape.
- Filesystem runtime regressions prove the lease is released before terminal manifest persistence, a manifest-write failure restores the exact prior bytes, a successful write leaves the release durable, and replay adds no history.
- Finalize regressions prove a hosted close followed by local finalize releases terminal artifacts before reconciliation, even with a completed journal.
- Truth-check regressions prove M8 fails `done + active`, passes `done + released`, and keeps pre-terminal `merged` eligible for the close transition.
- Repair regressions prove the base-mismatch blocker stops before inference and wrong/unresolved inferred bases stop before reachability or mutation.
- Applicability regressions prove paginated repository file discovery, the control-plane-only R1/R2 skip, and mixed/ambiguous fail-closed behavior while preserving T1 tier semantics.
- A workflow regression keeps the registered-branch comparison before `bind=true` and preserves the trusted `--branch`/`--base` identity checks.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | DB-client boundary, sync/alignment, environment, lint, `pnpm type-check`, build, `pnpm test`, Smart Form verification, and command verification completed with exit 0. |
| `pnpm verify` | EXPECTED DEFERRED AFTER STATIC PASS | The complete static gate passed again; `test:live-db` then reached `pnpm test:db` and the staging-isolation guard refused the local `host=127.0.0.1 ref=unidentified` target before DB access. PR CI owns the required staging execution. |
| `pnpm exec tsx --test 'scripts/ops/lane-close.test.ts' 'scripts/ops/lane-finalize.test.ts' 'scripts/ops/lease-registry.test.ts' 'scripts/ops/truth-check-lib.test.ts'` | PASS | 322 tests passed, 0 failed, 0 skipped. |
| `pnpm type-check` | PASS | Completed as part of `pnpm verify:static` with exit 0. |
| `pnpm test` | PASS | Root aggregate completed as part of `pnpm verify:static` with exit 0. |
| `pnpm test:db` | BLOCKED / DEFERRED | The staging-isolation guard refused the local target before creating a DB client: observed `host=127.0.0.1 ref=unidentified`; the packet-mandated disposition is recorded below. |
| Filesystem runtime proof | PASS | Transaction ordering, byte-exact rollback, durable commit, idempotent replay, control-root identity, and the terminal M8 invariant execute against temporary real files rather than mocks. |
| Repository-derived R1/R2 applicability | PASS | GitHub PR-file pagination feeds a deterministic classifier; control-plane-only scope records `not_applicable` with the classified list, while mixed, missing, or ambiguous scope remains fail-closed. |

Focused TAP summary:

```text
# tests 322
# pass 322
# fail 0
# skipped 0
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

The required PR T1 Proof Gate supplies those credentials and runs the writable smoke suite against the isolated staging project. No environment file was copied or modified locally.

### Scope and R-level disposition

The implementation changes only control-plane workflow and `scripts/ops/**` coordination tooling/tests. `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` passed with 15 changed files and no matching rules, so no R-level artifacts are required. No Tier C source path, application runtime, migration, contract, generated database type, or production row is touched.

`pnpm verify` was run after the complete proof bundle was committed. Its static half passed and its live-DB half produced the governed staging deferral recorded above.
