# PROOF: UTV2-1783 — pre-merge merge authority and execution identity are separate facts

MERGE_SHA: 4ba80a999fc654009f7e5082f1947b5926768e77

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1483
Approved PR head: pending merge
Execution SHA: 4ba80a999fc654009f7e5082f1947b5926768e77

Anchor: `4ba80a999fc654009f7e5082f1947b5926768e77` — the last commit carrying implementation
changes on this branch, and the head every measurement below was taken against.

What follows it: the proof bundle itself, a bot commit binding the manifest to PR #1483,
and one manifest commit declaring `expected_proof_paths` and correcting `created_by` to
`claude` after Close Eligibility Preflight blocked on CEP-E1/CEP-M2. All three touch only
proof and lane-apparatus paths; none touch `scripts/` or `.github/`, so every measurement
below still describes the code under review. Stated rather than implied, because
`proof-binding-validator` — the gate that would enforce a proof-paths-only rule — does not
run on this PR (see below), so the property is asserted here instead of being checked.

### Why this bundle's top-level row is a SHA and not the placeholder

This lane changes the contract that governs that row, and it is the one PR the new
contract does not govern. `executor-result-validator.yml` checks out the PR **base** ref
by design (a security property: the validator must run main's trusted code, never
PR-supplied code), so this PR is graded by main's *old* contract, which requires the row
to be a real hex SHA that is an ancestor of the head.

`proof-binding-validator` — the consumer that requires the placeholder there — is reached
only through `migration-reversibility-gate.yml`, whose path filter is
`supabase/migrations/**`, `db/migrations-rollback/**` and three named scripts. This PR
touches none of them, so that gate does not run here and the two consumers do not collide
on this bundle.

Stated plainly so a reviewer does not read it as the lane violating its own fix: the
repaired contract governs PRs opened after this one merges. This bundle is the last one
authored under the old rule.

## ASSERTIONS:

- [x] One migration-lane fixture passes both real consumers — `proof-binding-validator`
      exits 0 and the identity contract returns zero failures with an ERV-valid ancestry
      anchor — executed as subprocesses against a real git repository, not simulated.
- [x] `pending merge` is accepted only as a presentation placeholder and is never routed
      to a SHA rule: the anchor returned to callers is never the markdown row.
- [x] A branch/execution SHA in `sha_binding.merge_sha` fails.
- [x] A non-null merge SHA declared before merge fails (`premature_merge_authority`).
- [x] A missing, empty, placeholder-valued or short `verified_source_sha` fails execution
      provenance and yields no anchor — the caller cannot mistake it for "nothing to check".
- [x] Post-merge rebinding still populates merge authority, and execution identity stays
      the source commit rather than being overwritten by the merge commit.
- [x] Four mutation controls each restore one half of the old contradiction and each fails
      the regression it names; the unmutated control passes 90/90.
- [x] Historical bundles with no `sha_binding` keep the legacy rule unchanged, and a
      present-but-unreadable `evidence.json` is an error rather than a downgrade to it.

## Verification

### What was broken

`verification.md`'s top-level `MERGE_SHA:` row carried two incompatible meanings, and each
pre-merge consumer picked one:

| Consumer | Required of that one row |
|---|---|
| `scripts/ci/proof-binding-validator.ts:99` | the literal `pending merge` — a branch SHA is not merge authority |
| `.github/workflows/executor-result-validator.yml:274` | `/^[0-9a-f]{7,40}$/` **and** an ancestor of the PR head |

Each is right about a different fact. No value satisfies both. Any lane where both
consumers ran was therefore unmergeable, and no amount of re-anchoring could fix it —
the bundle was structurally incapable of passing.

It stayed invisible because `proof-binding-validator` is reached only through
`migration-reversibility-gate.yml`'s path filter. Ordinary lanes trip one consumer.
Migration lanes change `supabase/migrations/**` and trip both, which is why this surfaced
as a migration-lane blocker (PR #1482) rather than as a general one.

`scripts/ops/proof-generate.ts` had already been forced to pick a side. Its comment said
so outright — it wrote the execution SHA into the row because the placeholder "made every
freshly generated bundle structurally incapable of passing required Executor Result
Validation". So the generator and one of its own validators disagreed in the same repo.

### What changed

Schema v2 already modelled the two facts separately; nothing needed inventing:

- `sha_binding.merge_sha` — merge authority. Null until GitHub merges.
- `sha_binding.verified_source_sha` — execution identity. A real commit before merge.

The markdown row now presents merge authority and nothing else: the placeholder before
merge, the merge SHA after. Execution identity moved to the `Execution SHA:` row and is
what every consumer ancestry-checks.

The rules live once, in `scripts/ops/proof-schema.ts::validateProofMergeShaIdentity`.
`proof-binding-validator` imports it. The ERV workflow *invokes* it, via a guarded
`proof-identity` CLI, instead of holding an inline copy — a second copy is how these two
drifted apart, and a test written against a restatement of a validator proves only that
the copy agrees with itself.

Historical compatibility is deliberately narrow: a bundle with no `sha_binding` block
keeps the legacy rule unchanged (the row itself must be a real SHA, and is the anchor).
Absent evidence selects the older contract; it never relaxes one. A present-but-corrupt
`evidence.json` exits 2, so a lane cannot escape the schema-v2 contract by corrupting its
own evidence.

### The integration regression — both consumers, one fixture

The defect was never in either consumer alone. It was that they disagreed, and no test
ever ran them over the same bytes. So the regression executes both real consumers against
one migration-lane bundle in a real git repository:

```
$ pnpm exec tsx --test scripts/ops/proof-schema.test.ts
# pass 90
# fail 0
```

### Mutation controls — each old rule, restored and measured

Each mutation was applied to the shipped source, the suite re-run, and the source
restored. Measured, not asserted:

| # | Mutation (the old behaviour, put back) | Result |
|---|---|---|
| M1 | merge row may hold a branch SHA pre-merge | **fail 3** — control A, the #1434/#1435 shape test, and control C |
| M2 | ancestry anchor read from the markdown row (the overloaded field) | **fail 4** — including the both-consumers regression itself |
| M3 | merge authority may be claimed before merge | **fail 1** — `premature_merge_authority` |
| M4 | unreadable `evidence.json` downgrades to the legacy path | **fail 1** — control D |
| — | unmutated control | **pass 90 / fail 0** |

M2 is the one that matters most: pointing the anchor back at the overloaded row breaks
the integration regression directly, which is the contradiction reproducing itself.

### Wiring locks

W1–W3 pin the workflow mechanically, because a fix that lives only in a module a workflow
stopped calling is not a fix:

- **W1** — the workflow must invoke `scripts/ops/proof-schema.ts proof-identity`.
- **W2** — the old `/[0-9a-f]{7,40}/` rule and the `Proof MERGE_SHA is not a valid git SHA`
  rejection must not reappear in workflow code. Comment lines are stripped first: the
  block explaining the removed rule necessarily quotes it, and failing on the explanation
  would push the next author to delete the explanation rather than the duplication.
- **W3** — ancestry must run against `identity.provenanceAnchorSha`, never `base: fileSha`.

### Commands

```
$ pnpm type-check
(clean — tsc -b project references)

$ pnpm lint
(clean)

$ pnpm test
0 failures across 5559 tests (2803 in the root suite)

$ pnpm verify
exit 1 — and NOT green locally. Every step passed (ops:sync-check,
ops:system-alignment-check, ops:automation-coverage-check, env:check, lint,
type-check, build, test, smart-form verify, verify:commands) with zero `not ok`
lines in 5559 tests. It then reached the final step and refused:

  [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
  [assert-staging] REFUSED: target identity could not be resolved from its URL
  (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.
  Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

That is the fail-closed staging guard doing its job on a host with no staging
identity, not a defect in this change — this lane touches no database code. The
authoritative green `pnpm verify` for this branch is the required `verify` check
on the PR head, which runs inside the staging-ci environment. Claiming local
green here would be false.

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff

$ pnpm ops:automation-coverage-check
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] capabilities total=157 wired=139 orphan=18 (baselined=18 new=0)
```

## EVIDENCE:

```
$ pnpm exec tsx --test scripts/ops/proof-schema.test.ts scripts/ops/proof-generate.test.ts scripts/ops/proof-rebind.test.ts scripts/ops/truth-check-lib.test.ts
# pass 390
# fail 0
```

### Tests that asserted the old rule

Seven assertions in `proof-generate.test.ts` and three in `proof-schema.test.ts` encoded
the contradiction — the UTV2-1729 block most explicitly, since that lane resolved the same
tension by choosing the ERV side. None were deleted. Each was rewritten to assert the same
property against the carrier it moved to: the requirement that a real, ancestor-valid
execution SHA reach the validator survives intact; only the field carrying it changed.

### Scope

Contract and gate code only. No production code, no database code, no migration, no DDL,
no deployment, no branch-protection change, and neither consumer was weakened or exempted
— the fix makes both consumers pass the same bundle rather than excusing either from
running.
