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
- [x] Every load-bearing control is mutation-proven: 14 of 14 mutations that disable or fail-open a control are killed by a production-path regression.
- [x] The trusted `--pr` repair path refuses a wrong or unresolved PR base, and still accepts a matching one.
- [x] A `scripts/**` path is classified control-plane only when it neither constructs nor imports a database client, directly or one hop through a local helper; unreadable files and unresolvable local imports fail closed.
- [x] Prose naming a database client is not use of one, and no import syntax that reaches a database is skipped: side-effect imports, re-exports, `require()`, `import x = require()`, and dynamic `import()` are all followed. A file that does not parse cleanly fails closed.
- [x] Lane PR binding no-ops when a branch names an issue that has no lane manifest at all, not only when the manifest names a different branch.

## EVIDENCE:

- Control-root regressions resolve the common Git directory from both the control checkout and a linked-worktree shape.
- Filesystem runtime regressions prove the lease is released before terminal manifest persistence, a manifest-write failure restores the exact prior bytes, a successful write leaves the release durable, and replay adds no history.
- Finalize regressions prove a hosted close followed by local finalize releases terminal artifacts before reconciliation, even with a completed journal.
- Truth-check regressions prove M8 fails `done + active`, passes `done + released`, and keeps pre-terminal `merged` eligible for the close transition.
- Repair regressions prove the base-mismatch blocker stops before inference and wrong/unresolved inferred bases stop before reachability or mutation.
- Applicability regressions prove paginated repository file discovery, the control-plane-only R1/R2 skip, and mixed/ambiguous fail-closed behavior while preserving T1 tier semantics.
- An independent review of the reviewed head rejected four controls that were present but did not do what they claimed, all four since corrected: (1) the runtime-data allowlist classified every `scripts/{ci,ops}` file as control-plane, so a T1 change to a live settlement-repair script that writes `settlement_records` would have skipped R1/R2 entirely; (2) `validateTrustedPostMergeRepair` never compared the candidate PR's base to `manifest.base_branch`, so the explicit `--pr` path could bind a wrong-base merge; (3) the finalize plan is built before the merge mutex is acquired; (4) the binding workflow no-opped only when a manifest named a different branch, and still hard-failed when no manifest existed at all.
- A second independent review rejected the first correction of the classifier and reproduced four fail-open bypasses against it: side-effect imports (`import './x.js'`), `require()`, dynamic `import()`, and a comment-stripper that erased real code between a `/*` inside a string literal and a later genuine block comment, hiding an actual client construction. The `require()` shape is present in this repository today at `scripts/ops/pre-merge-authorization.ts:63`. All four were reproduced before being accepted.
- The classifier was rewritten to read module specifiers from the TypeScript AST. This closes all four bypasses at once and removes the comment-stripping hack entirely: comments and string contents are simply not module specifiers. Re-exports and `import x = require()` are covered by the same traversal. A file whose parse produces diagnostics fails closed, because a recovered tree can silently drop the import being searched for.
- Across all 244 files under `scripts/{ci,ops}`: 200 classify control-plane, 44 database-reaching, 0 indeterminate. This lane's own four changed sources classify control-plane; `fix-settlement-utv2-665.ts`, which writes `settlement_records`, classifies database-reaching.
- A second mutation battery of 6 mutations covering the earlier corrections killed 5 immediately; the survivor (an unresolvable local import treated as clean) was a genuine fail-open and now has a regression. A third battery of 9 mutations against the AST classifier killed all 9. 23 of 23 mutations across the three batteries are killed.
- A mutation battery of 8 mutations was run against the load-bearing controls. Six were killed on the first pass. Two survived and were genuine assertion gaps in fail-closed behavior that was implemented correctly but never asserted: (a) a genuine non-idempotent lease-release failure could be downgraded from a throw to a warning, letting a lane close while still holding capacity; (b) `indeterminate` runtime-data applicability was produced correctly by the classifier but nothing asserted the done-gate refuses on it, so it could be downgraded from `fail` to `skip` at the consumption layer. Both regressions were added, plus coverage proving omitted applicability defaults to `required`. All 8 mutations are now killed.
- A workflow regression keeps the registered-branch comparison before `bind=true` and preserves the trusted `--branch`/`--base` identity checks.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | DB-client boundary, sync/alignment, environment, lint, `pnpm type-check`, build, `pnpm test`, Smart Form verification, and command verification completed with exit 0. |
| `pnpm verify` | EXPECTED DEFERRED AFTER STATIC PASS | The complete static gate passed again; `test:live-db` then reached `pnpm test:db` and the staging-isolation guard refused the local `host=127.0.0.1 ref=unidentified` target before DB access. PR CI owns the required staging execution. |
| `pnpm exec tsx --test 'scripts/ops/lane-close.test.ts' 'scripts/ops/lane-finalize.test.ts' 'scripts/ops/lease-registry.test.ts' 'scripts/ops/truth-check-lib.test.ts'` | PASS | 333 tests passed, 0 failed, 0 skipped. |
| `pnpm type-check` | PASS | Completed as part of `pnpm verify:static` with exit 0. |
| `pnpm test` | PASS | Root aggregate completed as part of `pnpm verify:static` with exit 0. |
| `pnpm test:db` | BLOCKED / DEFERRED | The staging-isolation guard refused the local target before creating a DB client: observed `host=127.0.0.1 ref=unidentified`; the packet-mandated disposition is recorded below. |
| Filesystem runtime proof | PASS | Transaction ordering, byte-exact rollback, durable commit, idempotent replay, control-root identity, and the terminal M8 invariant execute against temporary real files rather than mocks. |
| Repository-derived R1/R2 applicability | PASS | GitHub PR-file pagination feeds a deterministic classifier; control-plane-only scope records `not_applicable` with the classified list, while mixed, missing, or ambiguous scope remains fail-closed. |

Focused TAP summary:

```text
# tests 333
# pass 333
# fail 0
# skipped 0
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

The required PR T1 Proof Gate supplies those credentials and runs the writable smoke suite against the isolated staging project. No environment file was copied or modified locally.

### Known limitations

- Database reachability is followed one import hop. Depth 0 catches a file that constructs or imports a client itself; depth 1 catches a file whose work is done by a local helper that does. A reach of two or more hops is classified control-plane. Following the full closure was measured and rejected: `lane-close.ts` reaches the shared db package only at three hops, through proof-harvest tooling it never invokes, so full closure sweeps in every lifecycle module and makes the R1/R2 waiver unusable rather than more accurate.
- Module specifiers are read from the TypeScript AST, not from source text. An earlier text-scanning implementation was rejected in review with four reproduced fail-open bypasses; see the review record below. The governed `scripts/ci/privileged-db-client-inventory.json` remains the authoritative record of client construction sites, and is a narrower set (it tracks direct construction only).
- Classification is by module specifier, not by data-flow. A file handed an already-constructed client as a parameter, or reaching a database through a package not named in the specifier list, is classified control-plane.
- `.github/workflows/lane-pr-binding.yml` has no mechanical test coverage; both of its no-op branches are verified by inspection only. This is unchanged by this lane and is recorded rather than claimed as proven.

### Scope and R-level disposition

The implementation changes only control-plane workflow and `scripts/ops/**` coordination tooling/tests. `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` passed with 15 changed files and no matching rules, so no R-level artifacts are required. No Tier C source path, application runtime, migration, contract, generated database type, or production row is touched.

`pnpm verify` was run after the complete proof bundle was committed. Its static half passed and its live-DB half produced the governed staging deferral recorded above.
