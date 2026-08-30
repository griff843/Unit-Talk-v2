# PROOF: UTV2-1776 — Verification

MERGE_SHA: e8b74b3468aac5497994b0408753d81ce1ee7935

> Pre-merge the merge anchor is intentionally empty; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-08-29T23:55:00Z
Issue: UTV2-1776
Tier: T1
Lane type: governance
Proof profile: static
Branch: codex/utv2-1776-attestation-merge-slot
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1459
Head SHA: 1b4d57cd5eaf51fe8de99f15107130ba48ce2737
result: pass

## ASSERTIONS:

- [x] Merge authority is compared against `sha_binding.merge_sha`, never against `sha_binding.verified_source_sha`, on the schema-v2 post-merge path.
- [x] A merge slot that disagrees with the GitHub-recorded merge SHA fails closed, and is checked before any shortcut that could bypass it.
- [x] `verified_source_sha` is no longer required to equal the merge SHA when an explicit valid merge slot exists.
- [x] `verified_source_sha` still carries its own provenance obligation: it must be the attested merge SHA, or a commit the attested PR actually contributed.
- [x] A PR-head SHA or a branch/execution SHA placed in `sha_binding.merge_sha` cannot satisfy merge authority.
- [x] Missing, incomplete, non-`github-api`, or foreign GitHub merged-PR attestation fails closed with no source-provenance fallback.
- [x] The narrowly ratified pre-slot compatibility path (`historicalMergeSlotIsExempt`) is byte-identical to its parent commit.
- [x] Only bundles genuinely lacking the slot use the historical `verified_source_sha == GitHub merge SHA` shape; `declared-but-null` is never mistaken for absent.
- [x] Pre-merge explicit-slot bundles still require `merge_sha: null`.
- [x] The old equality rule was not deleted globally; the implementation branches explicitly on whether authoritative merge-slot semantics are present.
- [x] The real P10 and R3 consumers from run `33268421913` flip FAIL -> PASS on the real UTV2-1729 identities; both mutation controls flip them back.

## EVIDENCE:

The exact production failure being repaired, and the identities involved:

```
Post-Merge Lane Close run 33268421913 (UTV2-1729 / PR #1436)
  P10: verifier_merge_attestation_mismatch:
       sha_binding.verified_source_sha does not equal the GitHub-recorded merge SHA
  R3 : same mismatch

GitHub-recorded merge SHA : 95ec237f32eebd14c2a37cde477202fd553711cb
execution / source SHA    : 0c915811cd40b312bd3bdb4094062c29f6632c71
original PR head          : 55b583fd57e34ab2047bdf4cc948cca9b617eb83
```

Real git topology, read from this repository — this is why the old rule could never
be satisfied honestly:

```
$ git rev-list --parents -n1 95ec237f32eebd14c2a37cde477202fd553711cb
95ec237f32eebd14c2a37cde477202fd553711cb 1b5bffad1ce0cb8c9906f8bb0438b6c7c6ceb0cf
  -> one parent: a squash merge

$ git merge-base --is-ancestor 55b583fd 95ec237f   ; echo $?
1   -> the PR head is NOT contained in the recorded merge

$ git merge-base --is-ancestor 0c915811 55b583fd   ; echo $?
0   -> the execution SHA IS inside the merged PR

$ git merge-base 55b583fd 95ec237f
1b5bffad1ce0cb8c9906f8bb0438b6c7c6ceb0cf   -> the base-side reference

$ git merge-base --is-ancestor 0c915811 1b5bffad   ; echo $?
1   -> the execution SHA is NOT already on the base branch
```

Focused suites at the exact head, and both mutation controls:

```
$ pnpm exec tsx --test scripts/ops/proof-schema.test.ts
# tests 76   # pass 76   # fail 0   # skipped 0

$ pnpm exec tsx --test scripts/ops/truth-check-lib.test.ts
# tests 124  # pass 124  # fail 0   # skipped 0

MUTATION A -- restore the defective rule: merge authority read from
              verified_source_sha inside the declared-slot path
# tests 200  # pass 192  # fail 8
  not ok - UTV2-1776 regression: P10 accepts the real UTV2-1729 split identity
           through the production consumer
  not ok - UTV2-1776 regression: R3 accepts the real UTV2-1729 split identity
           through the production consumer
  not ok - regression: the explicit merge slot binds a squash-merged split identity
  not ok - negative control 1: an explicit merge slot that disagrees with the
           GitHub-recorded merge fails closed
  not ok - negative control 5: an attestation naming a different PR identity fails closed
  not ok - negative control 6: a verified source outside the merged PR fails closed
           even with a correct merge slot
  not ok - negative control 6b: a receipt bound to neither the verified source nor
           the attested PR head fails closed
  not ok - negative control 6c: a base-branch commit the PR did not contribute
           cannot be the verified source

MUTATION B -- drop the base-side exclusion from the execution-provenance check
              (the fail-open independent review found)
# tests 200  # pass 199  # fail 1
  not ok - negative control 6c: a base-branch commit the PR did not contribute
           cannot be the verified source

RESTORED
# tests 200  # pass 200  # fail 0
```

## Verification

### What was wrong

`scripts/ops/proof-schema.ts::resolveMergedPrAttestation` hardcoded

```ts
if (verifiedSourceSha.toLowerCase() !== attestation.merge_sha.toLowerCase()) { ... }
```

and three callers with different needs shared it. Two identities were being asked to
be one commit:

- **merge authority** — which commit GitHub recorded as the merge, and
- **execution/source identity** — which commit verification actually ran on.

Under a squash merge those are necessarily different objects, so a structurally valid
schema-v2 bundle could not satisfy the rule. The only bundles that could were ones
whose `verified_source_sha` misreported one of the two identities.

### What changed

1. `resolveMergedPrAttestation` is parameterized on the SHA that claims merge
   authority (`mergeAuthoritySha`) plus the evidence field it came from
   (`authorityField`), so a mismatch names the field that lied. Existing callers pass
   `verified_source_sha` and the default label, and their behaviour and message text
   are unchanged.
2. New `verifyDeclaredMergeSlotBinding` handles a bundle that declares the slot at
   `post-merge-read`. It is total: every path returns a decision, so a declared slot
   can never fall through to source-derived merge authority.
3. `readEvidenceMergeSlot` derives the slot with `hasOwnProperty`, so *declared-but-null*
   is never conflated with *absent*. A post-merge `merge_sha: null` is
   `verifier_merge_slot_invalid`, not exempt.
4. `verifyExternalVerifierProvenanceBinding` gained an optional `mergeSlot` input.
   Omitting it preserves pre-UTV2-1776 semantics exactly, which is the stricter of
   the two behaviours, so the new path can never widen an existing caller.
5. P10's schema-v2 decision was extracted out of `runTruthCheck` into exported
   `evaluateSchemaV2VerifierProvenanceCheck`. `runTruthCheck` has no other schema-v2
   P10 path, so the regression test drives the production decision rather than a
   re-implementation of it. Both P10 and R3 call sites now pass the slot.

### Ordering matters, and is asserted

The merge-slot branch runs **before** the `receiptSha === verifiedSourceSha`
exact-source shortcut. If it did not, a bundle naming the wrong merge SHA would pass
unchecked whenever its receipt happened to be the exact source head. Negative control
1b fixes that ordering in place.

### The execution-provenance rule, stated precisely

`verified_source_sha` is accepted in exactly two shapes:

1. the attested merge SHA itself — verification ran on the merge commit. This is the
   pre-UTV2-1776 shape, retained rather than broadened: it is no longer what *grants*
   merge authority, only what a verified source is allowed to be. The real
   `docs/06_status/proof/UTV2-1718/evidence.json` on `main` has this shape *and* a
   declared slot, so dropping it would have regressed a real merged bundle.
2. a commit the PR itself contributed — reachable from the attested PR head and **not**
   reachable from the base-side reference GitHub merged into.

The base-side exclusion is load-bearing. "Ancestor of the PR head" alone admits the
whole of `main` behind the branch point, including the merge SHA of every previously
merged PR, so a bundle could name a commit containing none of the lane's work and
still be reported as "within that PR". Independent adversarial review found this as a
working exploit against the first cut of this lane; it is fixed in `1b4d57cd` and
negative control 6c is the fixture that was missing.

### Negative controls

Each varies the condition it names, against a real temporary Git repository with a
real squash merge, so the ancestry facts are produced by git rather than asserted:

| # | Condition varied | Expected | Code |
|---|---|---|---|
| 1 | explicit slot disagrees with GitHub merge SHA | FAIL | `verifier_merge_attestation_mismatch` |
| 1b | wrong slot **and** receipt == verified source | FAIL | `verifier_merge_attestation_mismatch` |
| 2 | original PR head placed in `merge_sha` | FAIL | `verifier_merge_attestation_mismatch` |
| 3 | branch/execution SHA placed in `merge_sha` | FAIL | `verifier_merge_attestation_mismatch` |
| 4 | merged-PR attestation missing | FAIL | `verifier_merge_attestation_unverified` |
| 4b | attestation not sourced from the GitHub API | FAIL | `verifier_merge_attestation_unverified` |
| 5 | attestation names a different PR identity | FAIL | `verifier_source_not_in_merged_pr` |
| 6 | verified source outside the merged PR (sibling branch) | FAIL | `verifier_source_not_in_merged_pr` |
| 6b | receipt matches neither source nor attested head | FAIL | `verifier_receipt_head_mismatch` |
| 6c | verified source is a base-history commit (real ancestor of head) | FAIL | `verifier_source_not_in_merged_pr` |
| 7 | authentic pre-slot bundle | PASS | `verifier_provenance_bound_merged_pr_head` |
| 8 | pre-slot bundle with wrong attestation | FAIL | `verifier_merge_attestation_mismatch` |
| 9 | pre-merge bundle with non-null merge slot | FAIL | `verifier_merge_slot_premature` |

Plus: post-merge `merge_sha: null` -> `verifier_merge_slot_invalid`; non-hex/short/
numeric/object slot values -> `verifier_merge_slot_invalid`; pre-merge `merge_sha: null`
-> `verifier_provenance_bound_exact_source`; omitting `mergeSlot` -> unchanged
pre-UTV2-1776 rejection of the split identity.

Control 6c carries its own non-vacuity assertion: the fixture proves by execution that
the base commits it rejects really *are* ancestors of the attested PR head, so the
control is not passing for the trivial reason.

### Independent review

An independent adversarial reviewer was run against the change with the named risk
list. It found one real fail-open (the base-branch ancestry widening, above),
reproduced it with a working exploit against a real repository, and it was corrected
before this PR was opened. It reported clean on: merge-authority fallback on any path;
wrong slot riding in on valid execution ancestry; branch/PR-head SHA satisfying merge
authority; missing attestation falling back to a source-provenance pass; the
compatibility path applying to modern explicit-slot bundles; and `historicalMergeSlotIsExempt`
being byte-identical to its parent. It also re-verified every hard-coded git fact
behind the `UTV2_1729_GIT` test seam against real git; that seam now returns an error
on any ancestry probe it was not given, so it cannot silently invent a fact.

## Runtime Verification

Static-profile governance lane. It changes verification logic only — no DB surface, no
query, no runtime or delivery behaviour. No live-DB claim is made.

### 1. Full static verification

```
$ pnpm verify:static
verify:static exit=0

# tests 5263
# pass 5263
# fail 0
# skipped 0
```

### 2. Type-check and full test suite, run standalone

Run separately from `verify:static` so each carries its own measured receipt rather
than being asserted as transitively covered:

```
$ pnpm type-check
type-check exit=0

$ pnpm test
test exit=0

# tests 5149
# pass 5149
# fail 0
# skipped 0
```

The count differs from `verify:static` because `verify:static` runs additional suites
beyond `pnpm test` (`verify:commands` among them); both are reported as measured
rather than reconciled to a single number.

### 3. Full `pnpm verify` — partial, and why

`verify` is `verify:static && test:live-db`. Its static leg is the run recorded in
section 1 above (exit 0). The live-DB leg was run directly to record its own refusal
rather than inferring it:

```
$ pnpm test:live-db
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
  (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.
  Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
test:live-db exit=1
```

It refuses locally because the staging target is only reachable from the `staging-ci`
GitHub environment; the required CI `verify` job produces and checks a run-scoped
staging receipt in-job. Recorded as PARTIAL rather than presented as a pass.

### 4. R-level

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```

### 5. Scope

The functional change is four files, all inside the authorized scope:

```
scripts/ops/proof-schema.ts         implementation
scripts/ops/proof-schema.test.ts    leaf + negative controls
scripts/ops/truth-check-lib.ts      P10/R3 consumer wiring + P10 extraction
scripts/ops/truth-check-lib.test.ts real UTV2-1729 P10/R3 regression
```

No workflow file, no UTV2-1729 proof or manifest, no DB/runtime/delivery/production
change.

## Merge SHA Binding

Merge SHA: e8b74b3468aac5497994b0408753d81ce1ee7935
PR: https://github.com/griff843/Unit-Talk-v2/pull/1459
Approved PR head: 3620d08f80b0e910eb6b22d2ac077f21cdf78fbc
Execution SHA: 1b4d57cd5eaf51fe8de99f15107130ba48ce2737

## Known gaps

- **No Codex invocation occurred.** The lane is registered `executor: codex-cli` with a
  `codex-sol-high` routing block, and the Linear description did carry the full
  contract, so a Codex dispatch was available and was not used — this was implemented
  directly by Claude Opus 5. The model-routing sidecar declares the lane's registered
  routing because the validator requires manifest consistency and there is no
  sanctioned mid-lane routing-update command; it deliberately omits `codex_exit_code`
  and `codex_cli_version`, which would assert a run that did not happen. Disclosed
  rather than papered over; re-registering or re-running the lane is a PM call.
- **The migration-receipt consumer keeps pre-UTV2-1776 semantics.**
  `verifyPostMergeMigrationReceiptBinding` still passes `verified_source_sha` as merge
  authority, so a squash-merged *migration*-profile bundle with a split identity still
  hits the original failure on that path. It fails closed, so it is over-strict rather
  than unsafe, and widening it is exactly the "migration-receipt consumer changing
  semantics unexpectedly" risk this lane was told to guard against. Left unchanged and
  reported instead of fixed. The repair is therefore not uniform across the two
  consumers.
- **The first cut of this lane shipped a fail-open into review.** Checking only
  "ancestor of the attested PR head" widened `verified_source_sha` from an exact-SHA
  constraint to a whole-base-branch one. It was caught by independent review with a
  working exploit, not by the fixtures I wrote, because the fixture's only
  "outside the PR" commit was a sibling branch rather than base history. The missing
  case is now negative control 6c, but the general lesson — that a negative control
  must vary the condition along the axis the implementation actually reasons about —
  is not mechanically enforced anywhere.
- **P10 was extracted from `runTruthCheck` to make it testable.** That is a real
  structural change to the consumer, not a pure addition. `runTruthCheck` has no other
  schema-v2 P10 path, and the extracted function is called from exactly the site the
  inline block occupied, but the extraction itself is only covered by the full suite.
- **The R3 regression uses a scripted git seam, not live git.** `actions/checkout`
  gives CI a shallow PR checkout, so the historical UTV2-1729 objects are not fetchable
  there — the same constraint the pre-existing `AUTHENTIC_SQUASH_GIT` seam was built
  for. Every fact in the seam was read from real git in this repository and is recorded
  verbatim above, and the seam errors on any unrecorded probe, but it remains a
  recorded fact rather than a live one.
- **This lane does not close UTV2-1729.** It repairs the gate that stranded it. UTV2-1729
  is truthfully complete only after the sanctioned Post-Merge Lane Close workflow is
  replayed for PR #1436 / `95ec237f...` and observed to converge on its own. If the
  replay still fails, this repair is incomplete and that must be reported rather than
  worked around by hand-editing UTV2-1729.
- **UTV2-1778 and UTV2-1779 remain unstaffed.** The reconciler's missing GitHub read
  auth and the `lane-start --files` parser defect are both live and both were
  encountered in the course of this work.
