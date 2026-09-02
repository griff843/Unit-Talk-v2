# PROOF: UTV2-1826 — resolve post-merge migration merge authority from the declared merge slot

MERGE_SHA: ef27ab62c90d8fb9bd6ee6d7688c836411a0753b

> Pre-merge the merge row is intentionally the ratified pre-merge value; the Execution SHA
> row carries the verified implementation identity. `post-merge-lane-close.yml` rebinds
> merge authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1826
Tier: T2
Lane type: governance
Proof profile: static
Branch: claude/utv2-1826-migration-profile-merge-authority
PR: https://github.com/griff843/Unit-Talk-v2/pull/1486
result: pass

## ASSERTIONS:

- [x] A schema-v2 migration bundle whose declared merge slot is the attested merge SHA and
      whose verified source is a commit the PR contributed now passes post-merge
      validation. The fixture is a real git repository with four distinct commits — base
      tip, lane implementation, proof-only PR head, and a two-parent merge — so the two
      identity fields cannot accidentally be the same value.
- [x] A declared merge slot that is not the GitHub-recorded merge SHA still fails, and the
      failure names `sha_binding.merge_sha` rather than the execution identity.
- [x] Execution identity keeps its own obligation. With the merge slot carrying authority,
      a verified source that is on the base side of the merge — present in main before the
      PR existed — is refused as `migration_receipt_source_not_in_merged_pr`.
- [x] A declared merge slot still holding its pre-merge `null` after merge is reported as
      `migration_receipt_merge_slot_invalid`, not silently re-routed onto the legacy field.
- [x] A bundle that declares no merge slot is unchanged: its verified source must still
      equal the recorded merge SHA, and a mismatch still names
      `sha_binding.verified_source_sha`.
- [x] Receipt-head ancestry is untouched. The proof-only ancestry and non-proof-delta
      rules still decide whether a receipt head reaches the attested head.
- [x] The mutation control reproduces the live defect exactly: reverting the resolver call
      to the execution identity makes the passing regression fail with the same message
      UTV2-1822's closeout produced.
- [x] `pnpm type-check`, `pnpm lint`, `pnpm build` and `pnpm test` are green on the
      execution SHA.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` returns PASS
      with no R-level artifacts required for this diff.

## EVIDENCE:

The live failure this lane fixes. `post-merge-lane-close` run 33652083109, dispatched for
UTV2-1822 with `pr=1482`, after `ops:lane-close --repair-merged` had already repaired the
manifest and bound the proof:

```
[PASS] P3 proof files reference the merge SHA
[PASS] P10 external verifier provenance (verifier_provenance_bound_merge_slot)
[FAIL] C6 runtime-proof closeout requires evidence valid for the manifest-declared proof profile
[FAIL] P6 shared evidence contract failed: sha_binding.verified_source_sha: sha_binding.verified_source_sha does not equal the GitHub-recorded merge SHA
[FAIL] P9 proof does not satisfy its declared runtime/migration/static evidence profile
[FAIL] R1 declared proof profile failed: sha_binding.verified_source_sha: sha_binding.verified_source_sha does not equal the GitHub-recorded merge SHA
[FAIL] R2 declared proof profile failed: sha_binding.verified_source_sha: sha_binding.verified_source_sha does not equal the GitHub-recorded merge SHA
```

P10 passing with `verifier_provenance_bound_merge_slot` while P6 fails on the same bundle
in the same run is the defect in one line: one consumer already reads the declared merge
slot, and the migration consumer still reads the execution identity.

Baseline — the full `scripts/ops/proof-schema.test.ts` suite on the execution SHA:

```
$ pnpm exec tsx --test scripts/ops/proof-schema.test.ts
# tests 99
# pass 99
# fail 0
# skipped 0
```

Mutation control — restore the shipped call, resolving the merged-PR attestation from the
execution identity instead of the declared slot. This is the exact defect the lane fixes:

```
$ python3 - scripts/ops/proof-schema.ts   # resolveMergedPrAttestation(mergeAuthority.sha, context, mergeAuthority.field) -> resolveMergedPrAttestation(verifiedSourceSha, context)
$ pnpm exec tsx --test scripts/ops/proof-schema.test.ts
not ok 1 - a migration bundle whose merge slot is the attested merge and whose verified source is a PR commit passes
  error: |-
    [{"code":"migration_receipt_merge_attestation_mismatch","field":"sha_binding.merge_sha","message":"sha_binding.verified_source_sha does not equal the GitHub-recorded merge SHA"}]

    false !== true
# tests 99
# pass 97
# fail 2
```

The message the mutation produces is byte-identical to the one the live UTV2-1822 closeout
produced, which is what ties this regression to that incident rather than to a test-shaped
approximation of it.

Full suite on the execution SHA:

```
$ pnpm test
# tests 5439
# pass 5439
# fail 0
```

Static gates on the execution SHA:

```
$ pnpm type-check
$ pnpm lint
$ pnpm build
(all three exit 0 with no diagnostics)
```

R-level compliance on this diff:

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 4
Rules matched: (none) — no R-level artifacts required for this diff
```

Automation coverage:

```
$ pnpm ops:automation-coverage-check
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] baseline tests=119/119 capabilities=18/18
```

The single warning is the pre-existing baselined `WIRING_GLOB_SHADOWED` finding under
`apps/qa-agent`, untouched by this lane.

## Verification

- [x] `pnpm type-check`: pass (silent)
- [x] `pnpm lint`: pass (silent)
- [x] `pnpm build`: pass (silent)
- [x] `pnpm test`: 5439 tests, 5439 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/proof-schema.test.ts`: 99 pass, 0 fail
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS
- [ ] `pnpm verify` end-to-end: not obtainable off-CI. Its `test:live-db` step refuses to
      run outside the staging environment — `[assert-staging] REFUSED: target identity
      could not be resolved from its URL (host=127.0.0.1)`. Every preceding step passed
      locally; the authoritative receipt is the required `verify` context on this PR head,
      which runs against the run-scoped staging database.

## Runtime Verification

This is a `static`-profile governance lane. It changes proof-validation logic only: no
runtime service, no database, no migration, no deployment surface is touched. There is
therefore no live-DB behaviour to observe, and the writable-DB receipt is produced and
verified by CI inside the required `verify` context rather than asserted from proof text.

The behaviour that IS in scope — what the validator decides about a real merged bundle —
is measured above by executing it against a real git repository whose merge commit, PR
head, lane commit and base tip are four distinct objects, not by inspecting the source.

## Merge SHA Binding

Merge SHA: ef27ab62c90d8fb9bd6ee6d7688c836411a0753b
PR: https://github.com/griff843/Unit-Talk-v2/pull/1486
Approved PR head: 38433c681eac52e0784888825e3f20aa44667bb8
Execution SHA: cf3adef13a3f32ca841cbdc259961c4698149dfe

Anchor: `cf3adef13a3f32ca841cbdc259961c4698149dfe` is the last non-proof commit on this
branch and the head every measurement above was captured against. Only proof-path commits
follow it.
