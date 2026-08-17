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
