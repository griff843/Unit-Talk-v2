# UTV2-1495 Verification

## Verification

- Branch head at time of this update: `34b5cecb76d5b3bcaca2ecf8b21f77ae3f040774` (the exact merge-SHA binding for `main` is recorded post-merge by `ops:proof-generate --merge-sha`, per `LANE_MANIFEST_SPEC.md`; this reference exists to satisfy the runtime-verifier gate's SHA-binding requirement pre-merge).
- `pnpm type-check` - PASS
- `npx tsx --test scripts/ci/file-scope-guard.test.ts` - PASS (14/14; now also registered in `test:ops`, see Notes)
- `npx tsx --test scripts/ops/workflow-hardening.test.ts` - PASS
- `pnpm exec tsx scripts/ci/file-scope-guard.ts --branch codex/utv2-1495-hard-file-scope-lock-enforcement --base origin/main --head HEAD --manifest-source git --output-json .out/file-scope-local.json` - PASS
- `pnpm test` - PASS
- `pnpm verify` - PASS
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` - PASS (`Rules matched: (none)`)
- `pnpm test:db` - PASS (live Supabase, re-run after the PM review-round fixes; see full TAP output below)

### `pnpm test:db` TAP output

```
> @unit-talk/v2@0.1.0 test:db
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# skipped 0
# todo 0
```

## Manifest scope correction

`ops:lane-start`'s `--files` flag only captures the single token immediately following each occurrence (`scripts/ops/shared.ts` `parseArgs`); passing multiple space-separated paths after one `--files` silently drops all but the last. The initial `UTV2-1495` lane-start invocation declared three files but the committed manifest (`e6bd04bf` / pushed as `0c0c788b`) retained only `.github/workflows/file-scope-lock-check.yml`, dropping `scripts/ci/file-scope-guard.ts` and `scripts/ci/file-scope-guard.test.ts` — exactly the two files this lane exists to create.

This was caught and corrected before Codex began implementation (commit `06c1160f`, pushed as `b4c86d8e`), by editing `docs/06_status/lanes/UTV2-1495.json` directly to add the two dropped paths, matching what `--files` was actually invoked with. The lane manifest schema's `additionalProperties: true` allows this without a schema change.

The trusted-manifest resolution added by this PR (`resolveTrustedManifests` in `scripts/ci/file-scope-guard.ts`) locks a newly-introduced lane manifest to its first-committed content, specifically to prevent a later commit in the same PR from silently widening `file_scope_lock`. Since both corrections above are exactly that shape (later commits widening the manifest — first to add the two script files, then to add `package.json` for the `test:ops` registration required by this same PM review round), they would otherwise fail this lane's own new CI check. The manifest therefore carries a `scope_override` block (the documented override path required by this issue's acceptance criteria) recording who approved the widening, why, and where the evidence is — this section.

## Notes

- The new issue-specific test file is registered in the root `test:ops` explicit file list (`package.json`), so `pnpm test` / `pnpm verify` now actually execute it — it was previously only run directly via `tsx --test` (Codex P2 finding on PR #1182).
- The guard intentionally permits `expected_proof_paths` and the lane's own control-plane scaffold in addition to `file_scope_lock` so required lane proof and manifest files do not violate hard implementation file-scope enforcement.
- The CI workflow now extracts and executes the base-branch (`origin/main`) copy of `scripts/ci/file-scope-guard.ts` rather than the PR's own copy, and resolves manifest content via `--manifest-source git` (`resolveTrustedManifests`), so a PR cannot pass its own scope-violation check by simultaneously modifying the guard script or widening its own manifest (Codex P1 finding on PR #1182). The one intentional exception is this introducing PR itself, where the base branch has no prior copy of the guard to trust yet (falls back to the PR's own copy, logged as a workflow warning); every subsequent PR is evaluated against whatever copy is on `main`.
- Live DB verification passed as part of `pnpm verify`; one bounded-dedup live proof skipped its window-content assertion because provider data is older than the 72h lookback window, while the command exited successfully.
