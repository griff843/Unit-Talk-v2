## Diff summary

MERGE_SHA: f1eb161109286aab7d7e70300dac598a52ecf350

Substantive source binding: `f1eb161109286aab7d7e70300dac598a52ecf350`.

### Requirement mapping

1. One version-aware contract: `scripts/ops/proof-schema.ts` now owns schema-v1 compatibility and schema-v2 profile validation; `scripts/ci/proof-binding-validator.ts`, pre-merge eligibility, and post-merge truth checks consume it.
2. Migration evidence remains truthful: schema-v2 migration receipts can satisfy T1 R1/R2 without fabricated `queries` or `row_counts`, while exact execution receipts remain mandatory.
3. Runtime evidence remains fail-closed: `app-runtime` lanes still require non-empty queries and monitored-table row counts; unknown, missing, or mismatched profiles fail by named errors.
4. Verification provenance is external: schema-v2 bundles reject author-written `verifier.identity`; P10/R3 require an exact-head GitHub required-check receipt.
5. Pre/post-merge agreement is enforced: close-eligibility workflow wiring and regression coverage prove the same profile decision is applied on both sides of merge, including rejection of disagreements before merge.

### Files changed

- `.github/workflows/close-eligibility-preflight.yml` — supplies the checkout and manifest context required by the shared pre-merge contract.
- `.ops/sync/UTV2-1720.yml` — records the issue synchronization identity.
- `docs/05_operations/EXECUTION_TRUTH_MODEL.md` — corrects the documented proof-profile and verifier-provenance semantics.
- `docs/05_operations/LANE_MANIFEST_SPEC.md` — aligns manifest proof declarations with the shared validator.
- `docs/governance/LANE_CONCURRENCY_POLICY.md` — corrects closeout/concurrency governance text affected by the repaired contract.
- `scripts/ops/proof-schema.ts` — implements the canonical version-aware evidence validator and fail-closed profiles.
- `scripts/ops/proof-schema.test.ts` — covers legacy compatibility, migration/static/runtime profile behavior, SHA binding, mismatch, and self-certification rejection.
- `scripts/ci/proof-binding-validator.ts` — delegates evidence-shape/profile validation to the shared module while retaining Git SHA resolution and proof-only ancestry checks.
- `scripts/ci/proof-binding-validator.test.ts` — proves the binding gate consumes the shared contract.
- `scripts/ops/truth-check-lib.ts` — makes P6/P10 and T1 R1-R3 profile-aware and external-provenance-aware across pre/post-merge evaluation.
- `scripts/ops/truth-check-lib.test.ts` — proves pre/post-merge agreement, migration truthfulness, runtime strictness, and exact-head verifier behavior.
- `docs/06_status/lanes/UTV2-1720.json` and `docs/06_status/proof/UTV2-1720/model-routing.json` — orchestrator-created lane bookkeeping and wrapper-generated model-routing evidence.
- `docs/06_status/proof/UTV2-1720/evidence.json`, `verification.md`, `runtime-verification.md`, and this file — SHA-bound closeout evidence for the lane.

No UTV2-1718 source, manifest, proof, or Linear state was modified. No exception, override, or bypass was introduced.

### Attempt 3 wiring repair addendum

Substantive repair SHA: `f5abb5e5a9bde0b4f00057b6baa7b7b55bccbd1e`.

The validator regression assertions were moved intact into the wired
`scripts/ops/proof-schema.test.ts` suite, the newly added unwired standalone test file was removed,
and close-eligibility preflight now invokes the wired suite. The focused two-file run passed all 130
tests with zero failures. `pnpm verify` passed the complete static gate and then was blocked only by
the established local staging-identity guard for writable DB proof.

### Attempt 4 PM correction addendum

Substantive correction SHA: `47188002a36131fc72c635a03779e9bfad69cb17`.

- Pre-merge callers now select an explicit pre-merge contract context and reject schema v1 with
  `legacy_v1_not_allowed_pre_merge`; the post-merge historical reader explicitly retains v1.
- Migration receipt heads now exact-match the verified source SHA pre-merge. Post-merge mismatches
  require a real Git ancestor and proof/bookkeeping-only paths in every intervening commit; missing
  Git context, unrelated heads, and non-proof deltas fail by named codes.
- `modeling` and `data-canonical` now resolve to `app-runtime`, requiring non-empty queries and row
  counts. `governance` remains in the static profile used by this lane.
- Wired schema/truth tests passed 136/136. Hosted CI run `32079807804` passed `pnpm test:db` 7/7 in
  job `95540431352`, passed all T1 live proof suites, and passed static plus same-run receipt
  verification in job `95541744993`. Local writable proof remains blocked/deferred by the required
  `127.0.0.1` identity refusal.
- R-level verification passed with 16 changed files and no matching rule.

The requested UTV2-1718 replay exposes a PM decision point, not a safe implementation branch:
receipt `a9943aa1d9e24201e0acdfd76c59d1c7813a068d` is not an ancestor of squash merge
`3ce86b98a5aa01ae244794253a8c7e716f2ce733`. The mandated ancestor-iff rule therefore rejects it as
`migration_receipt_not_ancestor`. This correction deliberately does not weaken the rule with an
unratified squash-merge exception.

### Attempt 5 squash-aware receipt-binding addendum

Substantive correction SHA: `c6c0f26e0573c6d9924a5108d4c65f86d9ccdb83`.

- `EvidenceContractContext` now accepts an explicit GitHub API merged-PR attestation; the contract
  remains pure and performs no network fetch.
- `runTruthCheck` passes the PR number, merge SHA, and merged PR head SHA it already obtains from the
  authoritative GitHub pull-request record.
- Post-merge migration binding requires the rebound source to equal the attested merge SHA and the
  receipt to equal or reach the attested PR head through proof-only commits. Direct proof-only
  ancestry to the verified source remains supported for non-squash merges.
- Missing or malformed attestations, missing repository context, unavailable commits, unrelated
  histories, non-proof deltas, and merge-attestation mismatches remain named fail-closed outcomes.
- Squash-shaped positive and negative fixtures are wired into the existing proof-schema and
  truth-check suites. The required five-file focused run passed 328/328, and `pnpm verify:static`
  passed lint, type-check, build, all unit tests, and command verification.

This is acceptance-criterion compatibility based on GitHub's rank-1 merge record, not a bypass. No
UTV2-1718 artifact was changed.
