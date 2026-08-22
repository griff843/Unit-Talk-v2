# PROOF: UTV2-1729

MERGE_SHA: pending merge

Generated at: 2026-08-22T01:07:49.862Z
Issue: UTV2-1729
Tier: T1
Lane type: governance
Branch: codex/utv2-1729-proof-producing-contract
Execution SHA: 7d7347df7f252e7318a0dc19c1e1cb1a545a3d05
result: pass

## ASSERTIONS:

- [x] Generated schema-v2 evidence reserves `sha_binding.merge_sha: null` before merge and never labels a branch SHA as merge authority.
- [x] Generated verification Markdown contains the canonical `## Merge SHA Binding` section before review.
- [x] Pre-merge binding validation rejects the malformed PR #1434/#1435 evidence, Markdown, and model-routing shapes.
- [x] The default rebind remains fail-closed for legacy, pre-schema, malformed, and non-static bundles.
- [x] GitHub-attested recovery repairs the real PR #1434 bundle, preserves execution provenance, passes post-merge truth evaluation, and replays idempotently.
- [x] Manual workflow replay defers all proof mutation until the trusted PR-attested lane-close path.

## EVIDENCE:

```
$ pnpm verify:static
exit 0

$ pnpm exec tsx --test 'scripts/ops/lane-close.test.ts' 'scripts/ops/model-routing.test.ts' 'scripts/ops/proof-generate.test.ts' 'scripts/ops/proof-rebind.test.ts' 'scripts/ops/proof-schema.test.ts'
1..389
# tests 409
# pass 409
# fail 0
```

## Verification

- [x] `pnpm type-check`: passed as a standalone check and inside `pnpm verify:static`.
- [x] `pnpm test`: passed inside `pnpm verify:static`.
- [x] `pnpm verify:static`: passed with exit code 0.
- [x] Focused issue suite: 409 tests passed, 0 failed.
- [x] Evidence bundle: schema-v2 static proof generated with distinct execution and merge identities.
- [x] Model-routing evidence: records `execution_sha`; no top-level `merge_sha` is present.
- [x] Runtime proof: not applicable to this governance-only tooling change.
- [ ] Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

## Runtime Verification

- No application runtime, database repository, migration, lifecycle, distribution, or worker path changed.
- Real historical fixtures exercise PR #1434 recovery and PR #1435 pre-merge refusal/normalization shapes.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 7d7347df7f252e7318a0dc19c1e1cb1a545a3d05
