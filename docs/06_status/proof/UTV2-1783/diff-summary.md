# DIFF SUMMARY: UTV2-1783

MERGE_SHA: 83e2c63af1b0ae975a1b7fc93a55dbe3534c29b4

Issue: UTV2-1783
Tier: T1
Lane type: governance
Branch: claude/utv2-1783-merge-sha-identity-contract
PR: https://github.com/griff843/Unit-Talk-v2/pull/1483

## What changed

| File | Change |
|---|---|
| `scripts/ops/proof-schema.ts` | New canonical contract `validateProofMergeShaIdentity` + guarded `proof-identity` CLI |
| `scripts/ci/proof-binding-validator.ts` | `validatePreMergeVerificationBinding` delegates to the contract; takes `evidence` |
| `.github/workflows/executor-result-validator.yml` | Inline merge-row SHA rule replaced by a call to the contract module |
| `scripts/ops/proof-generate.ts` | Pre-merge writes the placeholder in the merge row and the execution SHA in `Execution SHA:` |
| `scripts/ops/proof-schema.test.ts` | Integration regression (both consumers, one fixture), controls A–D, wiring locks W1–W4, the real-bundle schema-v1 regression, and the whole-corpus census |
| `scripts/ops/proof-generate.test.ts` | Assertions that encoded the old rule rewritten against the moved carrier |
| `docs/06_status/lanes/UTV2-1783.json`, `.ops/sync/UTV2-1783.yml` | Lane apparatus |

No production code, no database code, no migration, no branch-protection change.

## What did not change

`scripts/ops/proof-rebind.ts` is untouched. Its post-merge path already rewrote
`pending merge` to the merge SHA, which is exactly what the repaired contract
requires, so there was nothing to change and it is left byte-identical.
