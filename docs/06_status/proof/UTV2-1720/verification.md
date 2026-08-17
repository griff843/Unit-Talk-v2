# PROOF: UTV2-1720

MERGE_SHA: f1eb161109286aab7d7e70300dac598a52ecf350

ASSERTIONS:

- [x] The pre-merge binding is the exact substantive source head; post-merge automation must rebind this anchor to the authoritative merge SHA.
- [x] Schema-v1 evidence remains readable while schema-v2 evidence uses one fail-closed, manifest-selected proof profile.
- [x] Static governance proof does not fabricate runtime queries or row counts, and app-runtime proof remains strict.
- [x] Schema-v2 verifier provenance comes from an external exact-head required check, never an author-written identity.

EVIDENCE:

```text
static gate: PASS
focused regression: PASS (321 tests, 0 failed, 0 skipped)
writable DB: BLOCKED_DEFERRED at the staging identity guard
shared contract: PASS
proof binding: PASS
r-level check: PASS
```

## Verification

Substantive source binding: `f1eb161109286aab7d7e70300dac598a52ecf350`.

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
