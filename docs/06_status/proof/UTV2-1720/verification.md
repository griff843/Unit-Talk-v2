# PROOF: UTV2-1720

MERGE_SHA: b0cdfee3578eb7aed11039d91f142516da54002e

ASSERTIONS:

- [x] The pre-merge binding is the exact substantive source head; post-merge automation must rebind this anchor to the authoritative merge SHA.
- [x] Schema-v1 evidence remains readable while schema-v2 evidence uses one fail-closed, manifest-selected proof profile.
- [x] Static governance proof does not fabricate runtime queries or row counts, and app-runtime proof remains strict.
- [x] Schema-v2 verifier provenance comes from an external exact-head required check, never an author-written identity.

EVIDENCE:

```text
static gate: PASS
focused regression: PASS (332 tests, 0 failed, 0 skipped)
writable DB: PASS in staging CI; BLOCKED_DEFERRED locally at the staging identity guard
shared contract: PASS
proof binding: PASS
r-level check: PASS
```

## Verification

Substantive source binding: `b0cdfee3578eb7aed11039d91f142516da54002e`.

### Static gate

`pnpm verify` ran the complete `pnpm verify:static` stage successfully, including `pnpm type-check` and `pnpm test`. It then entered `test:live-db` and stopped at the staging identity guard. The full command therefore exited 1 for the explicitly deferred infrastructure condition; this is not represented as a passing full verify.

The final literal portion of `pnpm verify` was:

```text
> @unit-talk/v2@0.1.0 test:live-db /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1720-closeout-contract-repair
> pnpm test:db && pnpm test:t1-proof:live


> @unit-talk/v2@0.1.0 test:db /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1720-closeout-contract-repair
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts


> @unit-talk/v2@0.1.0 ci:assert-staging /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1720-closeout-contract-repair
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
 ELIFECYCLE Command failed with exit code 1.
 ELIFECYCLE Command failed with exit code 1.
 ELIFECYCLE Command failed with exit code 1.
 ELIFECYCLE Command failed with exit code 1.
```

### Writable DB proof

Command: `pnpm test:db`

The complete literal output was:

```text
> @unit-talk/v2@0.1.0 test:db /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1720-closeout-contract-repair
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts


> @unit-talk/v2@0.1.0 ci:assert-staging /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1720-closeout-contract-repair
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
 ELIFECYCLE Command failed with exit code 1.
 ELIFECYCLE Command failed with exit code 1.
```

Because the staging guard exits before `tsx --test` starts, no legitimate node:test TAP trailer exists for this run. A passing trailer is deliberately not invented. Writable live-DB proof remains blocked/deferred and must run through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.

### Focused regression suite

Command:

```text
pnpm exec tsx --test 'scripts/ci/proof-binding-validator.test.ts' 'scripts/ops/lane-close.test.ts' 'scripts/ops/proof-auditor-gate.test.ts' 'scripts/ops/proof-schema.test.ts' 'scripts/ops/truth-check-lib.test.ts'
```

Literal excerpts covering the new contract scenarios:

```text
TAP version 13
# Subtest: binding gate consumes the shared schema-v2 migration contract
ok 1 - binding gate consumes the shared schema-v2 migration contract
# Subtest: binding gate fails schema v2 when sha_binding is absent
ok 2 - binding gate fails schema v2 when sha_binding is absent
# Subtest: binding gate keeps supported schema-v1 evidence readable
ok 3 - binding gate keeps supported schema-v1 evidence readable
# Subtest: version-aware evidence contract accepts supported schema-v1 bundles
ok 196 - version-aware evidence contract accepts supported schema-v1 bundles
# Subtest: schema-v2 migration profile accepts executed receipts without queries or row_counts
ok 197 - schema-v2 migration profile accepts executed receipts without queries or row_counts
# Subtest: schema-v2 evidence fails without valid sha_binding
ok 198 - schema-v2 evidence fails without valid sha_binding
# Subtest: app-runtime profile fails closed without queries and row_counts
ok 199 - app-runtime profile fails closed without queries and row_counts
# Subtest: schema-v2 proof profiles reject unknown, undeclared, mismatched, and author-verifier input
ok 200 - schema-v2 proof profiles reject unknown, undeclared, mismatched, and author-verifier input
# Subtest: schema-v2 migration T1 passes R1/R2 without fabricated queries or row_counts
ok 232 - schema-v2 migration T1 passes R1/R2 without fabricated queries or row_counts
# Subtest: schema-v2 app/runtime T1 still fails without queries and row_counts
ok 233 - schema-v2 app/runtime T1 still fails without queries and row_counts
# Subtest: schema-v2 verifier provenance is external and exact-head, never evidence-authored identity
ok 234 - schema-v2 verifier provenance is external and exact-head, never evidence-authored identity
# Subtest: schema-v2 migration packet passes pre-merge and post-merge shared contract without row counts
ok 281 - schema-v2 migration packet passes pre-merge and post-merge shared contract without row counts
# Subtest: close eligibility catches shared proof-profile disagreement before merge
ok 282 - close eligibility catches shared proof-profile disagreement before merge
1..305
# tests 321
# suites 2
# pass 321
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 14338.477494
```

### Proof and R-level checks

Shared evidence contract and proof binding:

```text
schema_version: 2
proof_profile: static (manifest lane_type: governance)
contract failures: 0
placeholder_fields_resolved: true
binding violations: 0
proof-binding-validator: PASS
```

`npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`:

```text
Verdict: PASS
Changed files: 18
Rules matched: (none) — no R-level artifacts required for this diff
```

### Attempt 3 wiring repair addendum

The three `proof-binding-validator` regression cases were relocated from the unwired
`scripts/ci/proof-binding-validator.test.ts` file into the already-wired
`scripts/ops/proof-schema.test.ts` suite. The close-eligibility preflight now runs that wired suite.

```text
pnpm exec tsx --test scripts/ops/proof-schema.test.ts scripts/ops/truth-check-lib.test.ts
tests 130
pass 130
fail 0
```

`pnpm verify` completed `verify:static`, including executable wiring with `new=0`, then reached the
required live-DB guard. Local writable proof remains truthfully blocked/deferred because
`host=127.0.0.1` cannot resolve to staging ref `xskgrzbteyqdufktjrjx`; the writable DB portion must
run through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.

### Attempt 4 PM correction addendum

Substantive correction SHA: `47188002a36131fc72c635a03779e9bfad69cb17`.

The wired regression command required by the correction brief passed:

```text
pnpm exec tsx --test scripts/ops/proof-schema.test.ts scripts/ops/truth-check-lib.test.ts
1..3
# tests 136
# suites 3
# pass 136
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

The cases pin both validation contexts: schema v1 is rejected pre-merge with
`legacy_v1_not_allowed_pre_merge` and remains readable post-merge; migration receipt heads must
exact-match pre-merge; Git-verified proof-only ancestry passes post-merge; stale non-proof and
unrelated heads fail; and modeling/data-canonical lanes now require app-runtime queries and row
counts while governance remains static.

Local `pnpm verify` again passed the complete `verify:static` stage and then truthfully stopped at
the staging identity guard. A separate local `pnpm test:db` produced the required refusal:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
environment with CI_SUPABASE_* credentials.
```

The authoritative hosted run then passed against the required project:

```text
CI run: 32079807804
Writable DB proof job: 95540431352 — PASS
pnpm test:db TAP: tests 7, pass 7, fail 0, skipped 0
T1 live proof suites: PASS
Receipt artifact: 9304856369
Verify/receipt-consumer job: 95541744993 — PASS
Receipt verifier: observed xskgrzbteyqdufktjrjx; expected xskgrzbteyqdufktjrjx; Verdict: PASS
```

R-level verification at the substantive head:

```text
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 16
Rules matched: (none) — no R-level artifacts required for this diff
```

One acceptance premise cannot simultaneously satisfy the mandated rule. The actual UTV2-1718
receipt head `a9943aa1d9e24201e0acdfd76c59d1c7813a068d` is not a Git ancestor of its squash-merge binding
`3ce86b98a5aa01ae244794253a8c7e716f2ce733` (`git merge-base --is-ancestor` exits 1). Therefore the
new literal ancestor-iff validator correctly returns `migration_receipt_not_ancestor` for that
historical bundle. No squash-merge bypass was added; PM must choose either a different mechanically
verifiable squash provenance rule or a rebinding target that is a real descendant of the receipt.

### Attempt 5 squash-aware receipt-binding addendum

Substantive correction SHA: `c6c0f26e0573c6d9924a5108d4c65f86d9ccdb83`.

The post-merge contract is now squash-aware through rank-1 GitHub merge-record attestation, without
an override or bypass. `runTruthCheck` supplies the PR number, GitHub-recorded merge SHA, and
GitHub-recorded merged-PR head SHA to the pure evidence contract. The contract requires the rebound
`sha_binding.verified_source_sha` to equal the attested merge SHA, then accepts the receipt only when
it equals the attested PR head or reaches that head through proof-only branch commits. The existing
proof-only receipt-to-verified-source ancestry path remains an alternative for direct/non-squash
merges. Missing attestations, missing repository context, unavailable commits, unrelated histories,
non-proof deltas, and attested merge mismatches all fail closed with named errors.

This makes the UTV2-1718 squash-shaped replay mechanically verifiable: its receipt belongs to the
real pre-squash branch history, while the rebound source belongs to the squash commit recorded by
GitHub. No UTV2-1718 artifacts were edited.

```text
pnpm exec tsx --test scripts/ci/proof-binding-validator.test.ts scripts/ops/lane-close.test.ts scripts/ops/proof-auditor-gate.test.ts scripts/ops/proof-schema.test.ts scripts/ops/truth-check-lib.test.ts
tests 328
pass 328
fail 0

pnpm verify:static
PASS (lint, type-check, build, pnpm test, smart-form verification, and command verification)

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 16
Rules matched: (none) — no R-level artifacts required for this diff
```

Writable live-DB proof remains blocked/deferred locally: target identity could not be resolved from
its URL (`host=127.0.0.1`). Writable DB verification requires `xskgrzbteyqdufktjrjx` and must run
through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. The previously captured
hosted staging receipt remains recorded in `evidence.json` and `runtime-verification.md`.

### Attempt 6 net-tree-diff receipt-delta addendum

Substantive correction SHA: `129f36c23399de8c94cac3b9da2e3119d2d65a2c`.

The branch-side and direct migration ancestry paths now calculate the shipped delta with
`git diff --name-only <receiptHead> <target>`, after retaining the existing Git ancestry check.
Proof and lane-bookkeeping paths remain exempt. Every remaining path must resolve to the same blob
at the target and the verified main-side parent (`<attestedMergeSha>^1` for the squash path or
`<verifiedSourceSha>^1` for the direct path). A missing main-side path, unequal blob, or Git failure
fails closed with a named result. This deliberately ignores a non-proof edit that was fully reverted
before merge because the reverted content did not ship and the receipt remains representative of
the shipped tree.

The real UTV2-1718 bundle was replayed read-only with PR `1428`, attested merge
`3ce86b98a5aa01ae244794253a8c7e716f2ce733`, attested head
`aa4d4cfc4d528a7ef4e9f684c08f914f9ba0cfd7`, and receipt head
`a9943aa1d9e24201e0acdfd76c59d1c7813a068d`. Contract validation returned `valid: true` with zero
failures. Its net delta contained two exempt UTV2-1718 proof files plus
`docs/06_status/readiness/readiness-score.json`; that file's blob was
`0a0aadc3ad884b8066eba01620fc5bf46b4a567e` at both the attested branch head and the merge's first
parent, proving it was a main-sync import.

```text
pnpm exec tsx --test scripts/ops/proof-schema.test.ts scripts/ops/truth-check-lib.test.ts
tests 140
pass 140
fail 0

pnpm exec tsx --test scripts/ci/proof-binding-validator.test.ts scripts/ops/lane-close.test.ts scripts/ops/proof-auditor-gate.test.ts scripts/ops/proof-schema.test.ts scripts/ops/truth-check-lib.test.ts
tests 331
pass 331
fail 0

pnpm verify:static
PASS

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 17
Rules matched: (none)
```

Hosted staging CI run `32084054556` completed successfully at the substantive head. Writable DB job
`95552759089` passed `pnpm test:db` with 7 tests passed, 0 failed, and 0 skipped against project
`xskgrzbteyqdufktjrjx`; T1 live suites passed. Receipt artifact `9306145939` was accepted by verify
job `95553478646`, which also passed the complete static gate. The local invocation remains
truthfully blocked/deferred by the documented `127.0.0.1` identity refusal.

### Attempt 7 merge-base main-reference addendum

Substantive correction SHA: `b0cdfee3578eb7aed11039d91f142516da54002e`.

The migration receipt delta check now derives one main-side reference with
`git merge-base <attested-original-head> <attested-merge-sha>` and uses it for both the branch-side
and direct target paths. GitHub retains the original pull-request head across merge strategies, so
the merge base identifies the fork or last merged-main point for squash and merge commits and the
pre-replay fork point for a rebase merge. A Git error, empty output, malformed merge base, or missing
main-side path remains an `unverified` fail-closed outcome.

The wired rebase fixture creates a receipt at branch commit 1, introduces a lane-authored non-proof
file at commit 2, adds a trailing proof commit 3, advances main, and replays the chain with new SHAs.
With the original branch head and replayed tip in the attestation, validation rejects the new file
as `migration_receipt_non_proof_delta`. The existing squash/main-import and preserved PR #1428-shaped
cases remain green.

```text
pnpm exec tsx --test scripts/ci/proof-binding-validator.test.ts scripts/ops/lane-close.test.ts scripts/ops/proof-auditor-gate.test.ts scripts/ops/proof-schema.test.ts scripts/ops/truth-check-lib.test.ts
tests 332
suites 3
pass 332
fail 0
skipped 0

pnpm verify:static
PASS

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 17
Rules matched: (none)
```

For the preserved PR #1428-shaped history, `git merge-base` resolved to
`0dd73e2f2d931eaf8d08666c7103b886a5dacca9`. The imported readiness file has blob
`0a0aadc3ad884b8066eba01620fc5bf46b4a567e` at both the original branch head and that merge base,
so the legitimate main import remains accepted.

Hosted staging CI run `32087027202` passed writable DB job `95561575709`: `pnpm test:db` passed
7/7 against `xskgrzbteyqdufktjrjx`, and the T1 live suites passed. Receipt artifact `9307172976`
was accepted by verify job `95562787686`, which passed same-run receipt validation, the full static
gate, and Command Center tests.
Local writable proof remains blocked/deferred by the documented `127.0.0.1` identity refusal.

### Attempt 8 strategy-discriminated main-reference addendum

Substantive correction SHA: `e98e062139ad0fddcfe4b87be6c0a8b34216bead`.

The previous unconditional merge-base rule was correct for disjoint squash and rebase histories but
degenerate for a two-parent merge commit: because the original PR head is an ancestor of the merge,
its merge base with the merge SHA is the PR head itself. Comparing target blobs to that same tree
would accept every post-receipt lane delta.

The validator now first runs `git merge-base --is-ancestor <attested-head> <attested-merge>`. When
the result is true, it requires at least two parents, resolves `merge_sha^1` as the pre-merge main
tip, and rejects anomalous parent ordering where parent 1 equals the PR head. When the histories are
disjoint, it retains `git merge-base <attested-head> <attested-merge>` for squash and rebase. Git
errors, a null or unexpected ancestry exit, a single-parent merge-like successor, malformed parent
identity, and malformed merge-base identity all return the existing fail-closed `unverified` result.

Three wired regressions cover the strategy boundary. A real `git merge --no-ff` fixture with a
lane-authored non-proof file after the receipt fails `migration_receipt_non_proof_delta` and names
the file. A second real merge fixture with only proof/bookkeeping changes after the receipt and an
independent main-side file passes. A single-parent successor containing the original PR head fails
`migration_receipt_ancestry_unverified`. All prior squash, rebase, attestation, and main-import
regressions remain green.

```text
pnpm exec tsx --test scripts/ci/proof-binding-validator.test.ts scripts/ops/lane-close.test.ts scripts/ops/proof-auditor-gate.test.ts scripts/ops/proof-schema.test.ts scripts/ops/truth-check-lib.test.ts
tests 335
suites 3
pass 335
fail 0
skipped 0

pnpm verify:static
PASS

pnpm verify
STATIC PASS; writable DB stage BLOCKED_DEFERRED by the required staging identity guard

pnpm test:db
BLOCKED_DEFERRED before the test runner by the required staging identity guard
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL
(host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the
staging-ci GitHub environment with CI_SUPABASE_* credentials.
