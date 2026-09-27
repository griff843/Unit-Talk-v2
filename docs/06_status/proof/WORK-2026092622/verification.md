# PROOF: WORK-2026092622

MERGE_SHA: 0f5d48322fd494c967da694a7ce44991104a0232

> Pre-merge, merge authority does not exist yet. `post-merge-lane-close.yml` binds the merge
> SHA after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-27T04:02:32.000Z
Issue: WORK-2026092622
Tier: T2
Lane type: governance
Branch: claude/work-2026092622-work-id-preflight-contract
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1663
Head SHA: 063620c2dcd005396d4aa8ae6ecf2a213ae32f03
result: pass

## ASSERTIONS:

- [x] A `WORK-###` identity never reaches the tracker in preflight, with or without a Linear credential. Covered by the credential-present and credential-independence tests; mutation MA is red (8 tests).
- [x] PL1 passes only for a work order committed at HEAD whose title heading names the identity. A missing work order, an untracked draft on disk, or a mismatched heading fails. Mutation MC (reading the working copy instead of HEAD) is red.
- [x] PL2 requires the work order's `Tier:` to equal `--tier`, returning NOT_APPLICABLE as a tracker tier mismatch does. The mechanical floor (PE2) still refuses a tier below it. Mutation MF is red.
- [x] PL4 requires a non-empty `## Acceptance Criteria` section. Mutation MD is red.
- [x] PL5 and PL6 still run for a `WORK-###` identity. They were extracted unchanged into `runManifestOwnershipChecks`, which the tracker path also calls.
- [x] `UTV2-###` identities are unchanged: with a credential they are looked up in Linear (new test), and without one the UTV2-1837 tests pass unmodified. The no-credential branch now calls the shared `checkMechanicalFloor`, which emits identical text.
- [x] `fetchLinearTaskSource` refuses a `WORK-###` identity before curl runs, naming the missing work order. Mutation ME is red.
- [x] PG2 exempts `WORK-###` sync files and manifests exactly as it exempts `UTV2-###` ones. Work orders are not exempt, so an untracked one still fails PG2. Mutation MB is red.
- [x] The ten untracked work orders are committed byte-for-byte. WORK-2026092606's sha256 is `d67945e3c60e687f79da47b6b1e901d3b487345fa3089b93bc927e6674313584`, identical to the PM-amended root copy.

## EVIDENCE:

```
$ pnpm exec tsx --test scripts/ops/preflight.test.ts scripts/ops/execution-packet.test.ts   # tests 161  pass 161  fail 0
$ pnpm test:ops                   # pass 3482  fail 0 (summed across suites), exit 0
$ pnpm type-check                 # exit 0
$ eslint (4 changed files)        # exit 0
```

Mutation battery: each mutation was applied alone to the files at `063620c2dcd005396d4aa8ae6ecf2a213ae32f03`, the two focused suites were run, and the files were restored. The baseline is 0 failures.

```
MA  runLinearChecks WORK branch disabled                      -> red (8 tests)
MB  lane-registry pattern back to UTV2-only                   -> red (1)
MC  readCommittedWorkOrder reads the working copy, not HEAD   -> red (1)
MD  PL4 acceptance-criteria check always passes               -> red (1)
ME  fetchLinearTaskSource WORK guard removed                  -> red (1)
MF  PL2 tier-equality check removed                           -> red (1)
```

Pre-merge check on real inputs. `runLinearChecks` was called for WORK-2026092606 on `063620c2dcd005396d4aa8ae6ecf2a213ae32f03`, with the real `local.env` Linear credential present, 2606's committed work order and its declared file scope. Every `fetch` was counted.

```
linear_credential_present: true
tracker_calls: 0
PE2 skip — repo-owned identity WORK-2026092606 has no tracker issue; tracker checks are optional and non-blocking. Declared --tier T2 satisfies the mechanical floor T3.
PL1 pass — repo-owned work order .ops/work/WORK-2026092606.md is committed at HEAD
PL2 pass — work order tier matches T2 (mechanical floor T3)
PL3 pass — repo-owned identity has no tracker state; lane ownership is checked by PL5
PL4 pass — .ops/work/WORK-2026092606.md states acceptance criteria
PL5 pass — no active manifest owns this issue
PL6 pass — candidate file scope does not overlap any active manifest
```

The acceptance test is the real Codex preflight for WORK-2026092606 run from the root checkout after merge. It is recorded on the PR and in the lane report, not here, because it can only run once this change is on `main`.

## Verification

Measured on `063620c2dcd005396d4aa8ae6ecf2a213ae32f03` in the lane worktree: the focused suites, `pnpm test:ops`, `pnpm type-check`, eslint and the mutation battery above. `verify` re-runs `pnpm type-check` and `pnpm test` on the PR head.

pnpm verify ran as the required `verify` job on PR head `81bb9ef0c`: run 36293177561, job 108548347674, conclusion success.

scripts/ci/r-level-check.ts, run after merge against the exact merged diff (explicit SHAs, never `HEAD`):

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base f2caf062f --head 0f5d48322
Verdict: PASS
Changed files: 20
Rules matched: (none) — no R-level artifacts required for this diff
```

## Merge SHA Binding

Merge SHA: 0f5d48322fd494c967da694a7ce44991104a0232
PR: https://github.com/griff843/Unit-Talk-v2/pull/1663
Execution SHA: 063620c2dcd005396d4aa8ae6ecf2a213ae32f03
