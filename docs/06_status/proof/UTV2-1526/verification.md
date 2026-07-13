# PROOF: UTV2-1526
MERGE_SHA: 145d3a07573126d78af12185e44204a2d4da1a11

Note: this PR is not yet merged, so there is no merge SHA yet. MERGE_SHA above is the
last non-proof (substantive) implementation commit already on this branch -- this proof
correction and evidence.json are proof-path-only commits on top of it -- satisfying the
validator's ancestor-of-current-head check; post-merge automation re-binds this to the
real merge SHA per the standard closeout flow. See
`docs/06_status/proof/UTV2-1526/evidence.json`'s `sha_binding.merge_sha: null` and
`sha_binding.sha_type: "substantive_commit_sha"`. Do not read this as a claim that the
PR is merged or that this commit is the current PR head.

ASSERTIONS:
- [x] Canonical policy defines 4 profiles using real, verified Codex CLI 0.144.1 model IDs and reasoning efforts
- [x] Manifest schema + ops:lane-start require model_routing for newly created Codex lanes; reject it for Claude lanes
- [x] codex-exec.ts never invokes codex exec without an explicit --model and reasoning-effort override
- [x] Legacy compatibility is a real schema_version boundary (v1 vs v2), not field presence -- deletion attack fails closed
- [x] codex-sol-max is disabled and mechanically unavailable; no caller-supplied override string unlocks any requires_pm_authorization:true profile, regardless of how well-formed or "authorized" it claims to be -- UTV2-1527 tracks the trusted external authorization mechanism that would be required before this could change
- [x] Model routing is threaded through every live Codex-lane caller: codex-dispatch.ts (dispatch-time), lane-manifest.ts's manual/repair create command, lane-start.ts, and lane-maximizer.ts's advisory recommended-command builder; lane-resume.ts preserves an existing manifest's model_routing untouched and never reconstructs it
- [x] Model-routing evidence is declared in scope and committed/pushed before a run can report SUCCESS
- [x] pnpm verify, R-level check, and pnpm test:db all pass
- [x] 117/117 targeted tests pass across all 8 final test files, including the lane-maximizer.ts recommendation-command fix

## Summary

Deterministic Codex model-profile routing for Three-Brain (UTV2-1526), reworked per PM
review to close six gaps: (1) model routing is now threaded through every live
Codex-lane-creating or Codex-lane-dispatching caller, not just ops:lane-start directly --
including `scripts/codex-dispatch.ts` and `scripts/ops/lane-manifest.ts`'s manual/repair
`create` command constructing lane manifests, `scripts/ops/lane-resume.ts` preserving an
existing manifest's `model_routing` untouched on resume, and `scripts/ops/lane-maximizer.ts`'s
advisory recommended-command builder now appending `--model-profile` to the Codex dispatch
command it suggests for a candidate; (2) legacy compatibility is a real `schema_version`
(1 vs 2) boundary, so deleting `model_routing` from a v2 Codex manifest is detected and
rejected -- it is no longer indistinguishable from "predates the field"; (3) `codex-sol-max`
(and any future `requires_pm_authorization: true` profile) is mechanically unavailable --
no caller-supplied override unlocks it, closing the same self-certification loophole
UTV2-1521 already closed for file-scope overrides; follow-up governance issue UTV2-1527
tracks building a trusted external mechanism, and this lane does not claim to have built
one; (4) the model-routing evidence sidecar's path is declared in the lane's own
`expected_proof_paths`, and `codex-exec.ts` now commits and pushes it before reporting
`SUCCESS` -- a run can no longer report READY_FOR_REVIEW with a dangling, uncommitted
evidence file; (5) this proof file clears the Proof Auditor / Runtime Verifier /
Executor Result Validation gates that were previously failing on this PR; (6) this
correction pass brings both proof artifacts (`evidence.json` and this file) into
agreement with the final implementation and its real 117/117 targeted-test result --
the prior versions still described an earlier 56- and 89-test state and falsely
described the pre-merge SHA-binding commit as the branch head.

## Evidence

**Repo-wide caller scan** (Explore agent, full report retained in session transcript)
confirmed exactly two live call sites construct a brand-new Codex lane manifest:
`scripts/ops/lane-start.ts` (reached from `scripts/codex-dispatch.ts` and the
`/dispatch` skill's raw `ops:lane-start` invocation) and `scripts/ops/lane-manifest.ts`'s
manual/repair `create` command (previously had no `--executor` support at all). Every
other Codex-lane touchpoint (`scripts/ops/lane-resume.ts`, `lane-start.ts`'s
already-exists resume branch, `scripts/ops/codex-exec.ts`) only reads/reactivates an
existing manifest and never reconstructs it. A third caller class was closed after this
scan: `scripts/ops/lane-maximizer.ts` never constructs a manifest, but its advisory
recommended-command builder previously suggested a Codex dispatch command with no
`--model-profile` argument at all; it now appends `--model-profile codex-sol-high` (T1)
or `--model-profile codex-terra-medium` (T2) to the command it recommends, matching the
resolution `resolveModelProfile` would itself produce for that tier.

EVIDENCE:
```text
$ npx tsx --test scripts/ops/model-routing.test.ts scripts/ops/codex-exec.test.ts \
    scripts/ops/shared.test.ts scripts/ops/lane-start.test.ts \
    scripts/ops/lane-manifest.test.ts scripts/ops/lane-resume.test.ts \
    scripts/ops/lane-maximizer.test.ts scripts/codex-dispatch.test.ts
1..117
# tests 117
# suites 0
# pass 117
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

```text
$ pnpm type-check
> tsc -b tsconfig.json
(exit 0, no errors)

$ pnpm verify
(env:check + lint + type-check + build + test -- full monorepo suite)
exit 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) -- no R-level artifacts required for this diff
```

## Verification

Commands executed:

- `pnpm type-check` -- clean, no errors
- `pnpm verify` -- exit 0 (env:check, lint, type-check, build, full `pnpm test` node:test suite)
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` -- PASS
- `pnpm test:db` -- live Supabase project `zfzdnfwdarxucxtaojxm`, real runtime proof, not in-memory repos

```text
$ pnpm test:db
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# pass 7
# fail 0
# skipped 0
```

This lane is pure ops-tooling/governance and does not itself touch DB runtime code;
`pnpm test:db` is run as the repo's standard T1 live-Supabase smoke suite per tier
policy, regardless of path.

Structured T1 evidence bundle (sha_binding, static_proof, runtime_proof, acceptance
criteria mapping): `docs/06_status/proof/UTV2-1526/evidence.json`.
