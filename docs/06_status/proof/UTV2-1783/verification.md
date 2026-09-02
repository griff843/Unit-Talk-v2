# PROOF: UTV2-1783 — pre-merge merge authority and execution identity are separate facts

MERGE_SHA: b3df08fa795190a710c0407f1c604399e61e2f63

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1483
Approved PR head: pending merge
Execution SHA: b3df08fa795190a710c0407f1c604399e61e2f63

Anchor: `b3df08fa795190a710c0407f1c604399e61e2f63` — the last commit carrying implementation
changes on this branch, and the head every measurement below was taken against.

What follows it: the proof bundle itself. Everything before it — the earlier proof commit,
a bot commit binding the manifest to PR #1483, and a manifest commit declaring
`expected_proof_paths` and correcting `created_by` to `claude` after Close Eligibility
Preflight blocked on CEP-E1/CEP-M2 — is behind the anchor, and this re-anchor moves it to
the review-round-2 implementation commit. The commits after it touch only proof and
lane-apparatus paths; none touch `scripts/` or `.github/`, so every measurement
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
- [x] Seven mutation controls each restore one half of the old contradiction and each fails
      the regression it names; the unmutated control passes 94/94.
- [x] The validation phase is stated by the caller, never inferred, wherever the artifact
      under validation is untrusted: the CLI exits 2 when `--phase` is absent or invalid,
      so a consumer cannot regress to inference by forgetting a flag.
- [x] The schema-v2 contract is selected by the bundle's *declared* `schema_version`, not
      by the presence of a `sha_binding` object. Proven against the real
      `docs/06_status/proof/UTV2-1554` bundle and against every schema-v1 bundle in the
      repository, none of which is read under the v2 rules.
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

Historical compatibility is deliberately narrow, and keyed on what the bundle *declares*:
a bundle that does not declare `schema_version: 2` keeps the legacy rule unchanged (the row
itself must be a real SHA, and is the anchor), even when it carries a `sha_binding` block —
157 shipped bundles do, and reading those as v2 would have failed them retroactively on
placeholder and binding-section rules that did not exist when they were written. The
regression for this is a real bundle from this repository (UTV2-1554) plus a census over
the whole proof corpus, because a fabricated fixture would only have been written to match
whatever the new code expected. Absent evidence selects the older contract; it never
relaxes one.

The phase is likewise stated rather than inferred. Executor Result Validation runs only on
open pull requests, so `pre-merge` is a fact about the caller; inferring it from the
bundle's own `sha_binding.merge_sha` let an unmerged PR assert merge authority and be
believed. `--phase` is now required — the CLI exits 2 rather than defaulting — so the
guarantee cannot lapse by omission. Inference survives only for post-merge readers of
historical artifacts, where there is no untrusted claimant. A present-but-corrupt
`evidence.json` exits 2, so a lane cannot escape the schema-v2 contract by corrupting its
own evidence.

### The integration regression — both consumers, one fixture

The defect was never in either consumer alone. It was that they disagreed, and no test
ever ran them over the same bytes. So the regression executes both real consumers against
one migration-lane bundle in a real git repository:

```
$ pnpm exec tsx --test scripts/ops/proof-schema.test.ts
# pass 94
# fail 0
```

### Mutation controls — each old rule, restored and measured

Each mutation was applied to the shipped source, the suite re-run, and the source
restored. Measured, not asserted:

| # | Mutation (the old behaviour, put back) | Result |
|---|---|---|
| M1 | merge row may hold a branch SHA pre-merge | **fail 3** — `proof-binding-validator`, control A, control C |
| M2 | ancestry anchor read from the markdown row (the overloaded field) | **fail 1** — the post-merge authority test |
| M3 | merge authority may be claimed before merge | **fail 2** — `premature_merge_authority`, and the self-consistent open-PR bundle |
| M4 | invalid `verified_source_sha` silently tolerated | **fail 1** — execution-provenance control |
| M5 | discriminator keys on `sha_binding` presence, not the declared schema version | **fail 3** — control C, the real UTV2-1554 bundle, and the whole-corpus census |
| M6 | CLI silently defaults `--phase` when the flag is absent | **fail 1** — the CLI phase-required test |
| M7 | ERV workflow stops passing `--phase pre-merge` | **fail 1** — W4 |
| — | unmutated control | **pass 94 / fail 0** |

Each mutation was applied to the shipped source, the suite re-run, and the source restored
before the next one. One mutation I first wrote was inert rather than surviving: `arg()`
returns `null` for an absent flag, never `undefined`, so a mutation testing for `undefined`
never fired. It is recorded here because an inert mutation reads exactly like a surviving
one and would otherwise have been reported as a coverage gap that did not exist. Re-run in
its accurate form, M6 is caught.

M7 is the mutation that found a real gap: nothing asserted that the workflow *states* the
phase, so a future edit could have dropped `--phase pre-merge` and silently restored the
inference this round removed. W4 now pins it, and the CLI's exit-2 guard means the two
fail together rather than one covering for the other.

M5 is the one that matters most this round: keying the discriminator on the presence of a
`sha_binding` object rather than the declared version is exactly the fail-open the P2
review named, and it is caught by a real shipped bundle and by a census of the whole
corpus — not by a fixture written to match the new code.

### Wiring locks

W1–W4 pin the workflow mechanically, because a fix that lives only in a module a workflow
stopped calling is not a fix:

- **W1** — the workflow must invoke `scripts/ops/proof-schema.ts proof-identity`.
- **W2** — the old `/[0-9a-f]{7,40}/` rule and the `Proof MERGE_SHA is not a valid git SHA`
  rejection must not reappear in workflow code. Comment lines are stripped first: the
  block explaining the removed rule necessarily quotes it, and failing on the explanation
  would push the next author to delete the explanation rather than the duplication.
- **W3** — ancestry must run against `identity.provenanceAnchorSha`, never `base: fileSha`.
- **W4** — the workflow must pass an explicit `--phase pre-merge`. Added in review round 2:
  the phase is a fact about the caller (this job only ever validates an open PR), so
  leaving it unstated is what let an untrusted bundle's own merge slot decide it.

### Commands

```
$ pnpm type-check
(clean — tsc -b project references)

$ pnpm lint
(clean)

$ pnpm test
0 failures across 5563 tests (2803 in the root suite)

$ pnpm verify
exit 1 — and NOT green locally. Every step passed (ops:sync-check,
ops:system-alignment-check, ops:automation-coverage-check, env:check, lint,
type-check, build, test, smart-form verify, verify:commands) with zero `not ok`
lines in 5563 tests. It then reached the final step and refused:

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
