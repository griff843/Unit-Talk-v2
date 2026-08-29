# PROOF: UTV2-1729

MERGE_SHA: pending merge

Generated at: 2026-08-29T08:20:00Z
Issue: UTV2-1729
Tier: T1
Lane type: governance
Branch: codex/utv2-1729-proof-producing-contract
Execution SHA: 02ae0502671effdc59642c038a3caebb7ebaef2d
result: pass

## ASSERTIONS:

- [x] Generated schema-v2 evidence reserves `sha_binding.merge_sha: null` before merge and never labels a branch SHA as merge authority.
- [x] Generated verification Markdown contains the canonical `## Merge SHA Binding` section before review.
- [x] Pre-merge binding validation rejects the malformed PR #1434/#1435 evidence, Markdown, and model-routing shapes.
- [x] The default rebind remains fail-closed for legacy, pre-schema, malformed, and non-static bundles.
- [x] GitHub-attested recovery repairs the real PR #1434 bundle, preserves execution provenance, passes post-merge truth evaluation, and replays idempotently.
- [x] Structural re-attestation is restricted to the known malformed schema-v2/static shape (or its canonical repaired successor); profileless and optional bundles retain tolerant ordinary rebinding.
- [x] A missing GitHub-recorded PR head is fetched from immutable `refs/pull/<n>/head` and verified before any ancestry decision.
- [x] Manual workflow replay defers all proof mutation until the trusted PR-attested lane-close path.
- [x] The pre-slot `sha_binding.merge_sha` exemption is decided by proven identity, not by proof profile: it is granted only post-merge and only when an authentic merged-PR attestation binds `verified_source_sha` to a real merged PR's merge SHA, and it is fail-closed on a wrong, incomplete, or absent attestation.

## EVIDENCE:

```
$ pnpm verify:static
exit 0

$ pnpm exec tsx --test 'scripts/ops/lane-close.test.ts' 'scripts/ops/model-routing.test.ts' 'scripts/ops/proof-generate.test.ts' 'scripts/ops/proof-rebind.test.ts' 'scripts/ops/proof-schema.test.ts'
1..403
# tests 424
# pass 424
# fail 0
# skipped 0
# todo 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 18
Rules matched: (none) — no R-level artifacts required for this diff
```

## Verification

- [x] `pnpm type-check`: passed as a standalone check and inside `pnpm verify:static`.
- [x] `pnpm test`: passed inside `pnpm verify:static`.
- [x] `pnpm verify:static`: passed with exit code 0.
- [x] Focused issue suite: 424 tests passed, 0 failed, 0 skipped.
- [x] R-level compliance: PASS; no lifecycle, domain, strategy, or operator UI rule matched.
- [x] Evidence bundle: schema-v2 static proof generated with distinct execution and merge identities.
- [x] Model-routing evidence: records `execution_sha`; no top-level `merge_sha` is present.
- [x] Runtime proof: not applicable to this governance-only tooling change.
- [ ] Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

## Mutation Testing

The exemption's controls are proven by execution, not by presence. Both
directions were forced and the suite re-run:

```
MUTATION A — historicalMergeSlotIsExempt() always returns true
not ok 5  - schema-v2 evidence requires a nullable merge slot before merge and forbids branch SHAs in it
not ok 6  - schema-v2 evidence has one merge authority and requires a concrete post-merge binding
not ok 29 - pre-slot compatibility is refused when the attestation belongs to a different merge
not ok 30 - pre-slot compatibility is refused when no merged-PR attestation is supplied at all
not ok 31 - pre-slot compatibility never applies pre-merge, even with an authentic attestation
not ok 32 - a branch SHA never satisfies merge authority through the pre-slot compatibility path
# pass 49
# fail 6

MUTATION B — historicalMergeSlotIsExempt() always returns false
not ok 28 - pre-slot static bundle is readable post-merge when an authentic merged-PR attestation proves identity
# pass 54
# fail 1

RESTORED
# pass 55
# fail 0
```

Every negative control fails when the exemption is forced on, and only the
positive fails when it is forced off. The compatibility regressions run against
a real Git repository containing a real merge commit, so
`resolveMergedPrAttestation` is exercised rather than stubbed.

## Runtime Verification

- No application runtime, database repository, migration, lifecycle, distribution, or worker path changed.
- Real historical fixtures exercise PR #1434 recovery and PR #1435 pre-merge refusal/normalization shapes.

### Known gap, disclosed rather than closed

Migration-profile bundles remain exempt from `sha_binding.merge_sha` at the
pre-merge gate, exactly as this lane originally authored them. Requiring the
null slot there is the correct end state, but the only fixture asserting the
current behaviour lives in `scripts/ops/truth-check-lib.test.ts`, which was
released from this lane's `file_scope_lock` on 2026-08-28. Closing it here
would require editing a released path, so it is reported to PM instead of
widened. The compatibility path added by this lane is unaffected: it never
applies pre-merge for any profile it governs.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1436
Approved PR head: pending merge
Execution SHA: 02ae0502671effdc59642c038a3caebb7ebaef2d
