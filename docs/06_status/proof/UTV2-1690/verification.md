# PROOF: UTV2-1690

MERGE_SHA: 2a6aecac2765af61b22a42493831e95a26d24b6d

Verified implementation SHA: `6d9f06a4d243b1257e89144b7c73537ab87c5585`

Pre-merge this anchor identifies the verified implementation commit. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

## Summary

UTV2-1690 closes terminal lifecycle gaps across coordination release, merge-SHA finalization, repair admission, finalize serialization, and PR binding. Terminal transitions release canonical control-checkout leases transactionally; a merged PR with no merge SHA is refused before it can be bound; repair refuses invalidated or wrong-base PRs on both the inferred and the trusted `--pr` path; the already-closed finalize replay no longer surrenders the mutex it runs inside nor deletes a tracked sync record; and issue-bearing branches that are not the registered lane branch leave the binding workflow green as a clean no-op.

**Scope change (PM decision, recorded on PR #1423).** The R1/R2 runtime-evidence applicability classifier is descoped from this lane and removed in full — code, tests, mutations, and proof claims. Three independent reviews rejected three successive implementations (a directory-prefix allowlist, a text scan, and an AST walk), each sound against the threat it was built for and fail-open against one it was not. Static classification of "does this change touch a database surface" is a design problem in its own right and now belongs to a post-zero-touch reliability lane. It does not block bounded autonomy. R1/R2 behaviour in this lane is therefore identical to `main`: unchanged, not newly waived.

## ASSERTIONS:

- [x] Linked worktrees resolve lease and merge-mutex coordination state from the control checkout.
- [x] Terminal manifest persistence cannot synchronously fail while leaving the canonical lease released; exact prior bytes are restored.
- [x] Successful closeout cannot persist a done manifest while retaining an active or stale-reclaim-required lease.
- [x] Repeated cleanup does not rewrite surrendered leases or append synthetic history.
- [x] An already-done finalize replay releases terminal artifacts before reconciliation, without surrendering the mutex the plan holds and without deleting the tracked `.ops/sync/<issue>.yml` record.
- [x] A merged PR reporting no merge SHA is refused before reachability, on the trusted `--pr` path: a manifest never binds a merge that no commit backs.
- [x] The trusted `--pr` repair path refuses a wrong or unresolved PR base, and still accepts a matching one.
- [x] M8 reports a done lane that still holds control-checkout scope and names the executable repair path.
- [x] `--repair-merged` returns named `pr_base_mismatch` without inference when the manifest carries `pr-base-mismatch`, and refuses an inferred PR whose base is wrong or unresolved.
- [x] Lane PR binding exits 0 without mutation when a branch names an issue but does not match that issue manifest's registered lane branch, and also when no lane manifest exists for that issue at all.
- [x] Every load-bearing control is mutation-proven: 20 of 20 mutations that disable or fail-open a shipped control are killed by a production-path regression.
- [x] The trusted `--pr` repair path refuses a wrong or unresolved PR base, and still accepts a matching one.
- [x] Lane PR binding no-ops when a branch names an issue that has no lane manifest at all, not only when the manifest names a different branch.

## EVIDENCE:

- Control-root regressions resolve the common Git directory from both the control checkout and a linked-worktree shape.
- Filesystem runtime regressions prove the lease is released before terminal manifest persistence, a manifest-write failure restores the exact prior bytes, a successful write leaves the release durable, and replay adds no history.
- Finalize regressions prove a hosted close followed by local finalize releases terminal artifacts before reconciliation, even with a completed journal.
- Truth-check regressions prove M8 fails `done + active`, passes `done + released`, and keeps pre-terminal `merged` eligible for the close transition.
- Repair regressions prove the base-mismatch blocker stops before inference and wrong/unresolved inferred bases stop before reachability or mutation.
- Independent review rejected an earlier head on four controls; the three that remain in scope are corrected here: the trusted `--pr` path never compared the candidate PR's base to `manifest.base_branch`; the finalize plan is built before the mutex is acquired; and the binding workflow hard-failed when a branch named an issue with no manifest at all. The fourth was the applicability classifier, now descoped.
- A second independent review rejected the first correction of the classifier and reproduced four fail-open bypasses against it: side-effect imports (`import './x.js'`), `require()`, dynamic `import()`, and a comment-stripper that erased real code between a `/*` inside a string literal and a later genuine block comment, hiding an actual client construction. The `require()` shape is present in this repository today at `scripts/ops/pre-merge-authorization.ts:63`. All four were reproduced before being accepted.
- A later review found two P1 defects in the already-closed finalize replay, both fixed and mutation-proven here: the replay released the control-checkout mutex its own caller was holding, leaving the following reconciliation step unserialized; and it deleted the tracked `.ops/sync/<issue>.yml` record, leaving the control checkout dirty with a deletion that reconciliation never restores.
- Mutation batteries were run against every shipped control. 20 of 20 mutations that disable or fail-open a control are killed by a production-path regression, including both P1 fixes and the merge-SHA refusal.
- A workflow regression keeps the registered-branch comparison before `bind=true` and preserves the trusted `--branch`/`--base` identity checks.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | DB-client boundary, sync/alignment, environment, lint, `pnpm type-check`, build, `pnpm test`, Smart Form verification, and command verification completed with exit 0. |
| `pnpm verify` | EXPECTED DEFERRED AFTER STATIC PASS | The complete static gate passed again; `test:live-db` then reached `pnpm test:db` and the staging-isolation guard refused the local `host=127.0.0.1 ref=unidentified` target before DB access. PR CI owns the required staging execution. |
| `pnpm exec tsx --test 'scripts/ops/lane-close.test.ts' 'scripts/ops/lane-finalize.test.ts' 'scripts/ops/lease-registry.test.ts' 'scripts/ops/truth-check-lib.test.ts'` | PASS | 324 tests passed, 0 failed, 0 skipped. |
| `pnpm type-check` | PASS | Completed as part of `pnpm verify:static` with exit 0. |
| `pnpm test` | PASS | Root aggregate completed as part of `pnpm verify:static` with exit 0. |
| `pnpm test:db` | BLOCKED / DEFERRED | The staging-isolation guard refused the local target before creating a DB client: observed `host=127.0.0.1 ref=unidentified`; the packet-mandated disposition is recorded below. |
| Filesystem runtime proof | PASS | Transaction ordering, byte-exact rollback, durable commit, idempotent replay, control-root identity, and the terminal M8 invariant execute against temporary real files rather than mocks. |

Focused TAP summary:

```text
# tests 324
# pass 324
# fail 0
# skipped 0
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

The required PR T1 Proof Gate supplies those credentials and runs the writable smoke suite against the isolated staging project. No environment file was copied or modified locally.

### R1/R2 disposition — one-time PM-recorded exception

R1/R2 are dispositioned by an explicit one-time exception recorded by the PM on PR #1423, not by any rule this lane ships and not by executor self-declaration.

The exception was conditioned on manual confirmation that the final diff touches no database or runtime-data surface. That confirmation was performed against every changed file: eight TypeScript sources, each checked for construction or import of a database client directly and one import hop out, all clean; the remaining seven files are a GitHub workflow, a lane sync record, a lane manifest, and four proof documents. No changed file constructs or imports a database client.

This disposition applies to this lane alone. It establishes no rule and no reusable waiver, and the general applicability question moves to a post-zero-touch reliability lane.

### Known limitations

- The R1/R2 runtime-evidence applicability rule is not in this lane. R1/R2 behaviour is unchanged from `main`; this lane neither widens nor narrows the existing waiver.

- `.github/workflows/lane-pr-binding.yml` has no mechanical test coverage; both of its no-op branches are verified by inspection only. This is unchanged by this lane and is recorded rather than claimed as proven.

### Scope and R-level disposition

The implementation changes only control-plane workflow and `scripts/ops/**` coordination tooling/tests. `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` passed with 15 changed files and no matching rules, so no R-level artifacts are required. No Tier C source path, application runtime, migration, contract, generated database type, or production row is touched.

`pnpm verify` was run after the complete proof bundle was committed. Its static half passed and its live-DB half produced the governed staging deferral recorded above.
