# PROOF: UTV2-1917

MERGE_SHA: f7cc5193117a5404036c2c15a8a27a4dec43a929

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-15T14:20:04.838Z
Issue: UTV2-1917
Tier: T2
Lane type: hygiene
Branch: claude/utv2-1917-track-only-capper-stats
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1585
Head SHA: 5859b3e1c12ea866328b8669728c1b495fa00b37
result: pass

## ASSERTIONS:

- [x] `picks.capper_id` is carried to the statistics layer instead of being read and discarded. `AttributedStatsInputPick` makes the canonical partition key **required** at every partitioning entry point, so it cannot be silently omitted where omitting it would matter.
- [x] Per-capper figures are produced by the **same** pure function as the whole-cohort aggregate. `computeTrackOnlyStatsByCapper` calls `computeTrackOnlyStats` once per partition, so a capper total that disagrees with the aggregate is arithmetically impossible rather than merely unlikely.
- [x] A capper partition equals the figure computed over that capper's picks alone (`deepEqual`, not a recomputation).
- [x] The partitions sum exactly to the whole-cohort aggregate: `cohortSize`, `record.{win,loss,push,decided}`, `pending` and `units.measuredOver` exactly; `units.staked`/`units.net` within `1e-4`, because units are rounded per partition.
- [x] A pick with `capper_id = null` lands in a **named** partition (`(unattributed)`) and still counts in the aggregate. It is never dropped — dropping it would break the sum invariant above.
- [x] A second capper's picks cannot contaminate the first capper's cohort.
- [x] "Latest settlement" is **resolved**, not ordered. `resolveSettlement` wraps the canonical `resolveEffectiveSettlement`, which walks root → tip via `corrects_id`. Asserted against a fixture whose tip has an *earlier* `settled_at` than its root, with rows handed to the resolver in `settled_at.desc` order — the exact order the old code fetched in, so nothing about the input favours the new behaviour.
- [x] The stake is read off the **same row** the resolver named (`effective_record_id`), not off the newest row.
- [x] Two competing roots (an `operator` root and a `grading` root, both `corrects_id IS NULL`, which the partial unique index permits to coexist) are refused **by name** as `MULTIPLE_ROOT_RECORDS` and count toward neither `record` nor `pending`. A silent wrong number becomes an explicit exclusion.
- [x] `buildPickReport` publishes the resolved settlement rather than the newest row.
- [x] No second mutable stats ledger: nothing is persisted, no table, no view, no materialization. The report client is read-only (GET-only PostgREST) and no production read or write occurs.
- [x] Every test uses `node:test` `test()` + `node:assert/strict`, per AGENTS.md. No `describe`/`it`.
- [x] The out-of-scope consumer `scripts/ops/track-only/sgo-journey-proof.ts` compiles **untouched**: `StatsInputPick` is unchanged and `AttributedStatsInputPick extends` it, so no `scope-override/v1` was needed and no guard was weakened to avoid one.

## EVIDENCE:

```
$ pnpm test:ops
1..2988
# tests 3113
# suites 21
# pass 3113
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 62025.515697

$ pnpm exec tsx --test scripts/ops/track-only-report.test.ts
1..42
# tests 42
# suites 0
# pass 42
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 837.243646

$ pnpm type-check
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json
(exit 0, no diagnostics)

$ pnpm exec eslint scripts/ops/track-only/stats.ts scripts/ops/track-only-report.ts scripts/ops/track-only-report.test.ts
(no output, exit 0)

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```

Note on `pnpm type-check` coverage, measured rather than assumed: root `tsconfig.json` is
`{"files": [], "references": [...]}` naming only `packages/*` and `apps/*`, and
`eslint.config.mjs` declares no `project`/`projectService`. **`scripts/**` is therefore
type-checked by no CI gate.** This lane's TypeScript was additionally checked by a deliberate
standalone `tsc` run carrying the `@unit-talk/*` path mappings, which is what caught the
`sgo-journey-proof.ts` signature break that `pnpm type-check` reported clean. That run is why
the type was split rather than made optional.

CI, measured on `bebc9f8f7e83d8130655a5599df0a4ff43cacd33` — the head carrying this
proof bundle, and the head at which the full required set actually concluded:

`verify` completed/success; `P0 Protocol` completed/success;
`Writable DB proof (staging only)` completed/success; `Executor Result Validator`
completed/success; `Proof Auditor Gate`, `Runtime Verifier Gate`,
`Require live-DB proof for runtime changes`, `Close eligibility preflight`,
`File scope lock`, `Lane authority` and `Return review packet` all completed/success.
`T1 Proof Gate` completed/skipped, correctly — this is a T2 lane.
`Merge Gate` is completed/failure and is the only red: it awaits the T2
merge-authority artifact, which is not an executor-authorable artifact.

**This block previously cited `5859b3e1c12ea866328b8669728c1b495fa00b37` and claimed
`Writable DB proof (staging only)` and `verify` both succeeded there. That was
false and is corrected here rather than quietly dropped.** On that head CI run
`34980875628` was **cancelled** — superseded by the push of the proof commit — so
`Writable DB proof (staging only)` concluded `cancelled` and `verify`, which is a
downstream job of the same run rather than an independent check, concluded
`failure`. A cancelled run is not a passing run, and the earlier text read a
superseded run as evidence.

`5859b3e1c12ea866328b8669728c1b495fa00b37` remains the Execution SHA below: it is
the last commit on this branch that changes code. Every commit after it — the PR
binding, this bundle, and this correction — touches only lane metadata and proof
narrative, and none of them alters what was verified.

## Verification
- [x] `pnpm type-check`: exit 0, no diagnostics
- [x] `pnpm test`: `pnpm test:ops` 3113 tests / 3113 pass / 0 fail across 21 suites
- [x] `pnpm verify`: `verify` job completed/success on head `bebc9f8f7e83d8130655a5599df0a4ff43cacd33` (CI is the authoritative site; `pnpm verify` cannot exit 0 locally because `ci:assert-staging-target` refuses a non-staging target). Not `5859b3e1c12ea866328b8669728c1b495fa00b37` — the run on that head was cancelled; see the CI note above.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, 6 changed files, no R-level artifacts required

## Runtime Verification
- No runtime proof is owed by this lane and none is claimed. The change is a pure-function
  partition plus a resolver substitution inside a read-only operator report; it performs no
  database write and touches no deployed surface. The staging boundary that does exercise
  `computeTrackOnlyStats` end to end — `scripts/ops/track-only/sgo-journey-staging.t1-proof.test.ts`
  — ran green under `Writable DB proof (staging only)` on this head and is unchanged by this lane.

`evidence.json` was added to this bundle after `Executor Result Validation`
concluded INVALID at `2c33bccf1badf3f134091cc2b9befd91de7b8a54`, with the exact
reason *"Proof MERGE_SHA is not a valid git SHA: \"pending merge\". This bundle
declares no schema-v2 sha_binding block, so the legacy contract applies."* The
legacy contract requires the `MERGE_SHA:` row itself to be a real commit, which
no bundle can satisfy before its own merge exists; the schema-v2 `sha_binding`
block is what selects the contract that admits the `pending merge` anchor. The
file was produced by `buildEvidenceSkeleton` from `scripts/ops/proof-generate.ts`
rather than hand-authored, and re-checked with the same
`proof-schema.ts proof-identity --phase pre-merge` CLI the validator invokes
(`failures: []`, `provenanceAnchorSha` = the Execution SHA below).

Its `static_proof` section is deliberately **absent rather than empty**.
`autoPopulateStaticProofFromVerifyRun` refuses to overwrite an already-populated
`static_proof`, and the skeleton's `{"status": "not_run"}` placeholder counts as
populated — so pre-filling it would permanently block the closeout harvest that
binds `static_proof` to the `verify` job of the merge SHA's own CI run. Leaving
it absent is what lets that harvest record a measured result. The consequence is
stated rather than hidden: `scripts/ci/proof-binding-validator.ts` reports
`static proof requires a populated static_proof block` on this bundle today. That
validator is invoked only by `migration-reversibility-gate.yml`, which does not
run on this lane (no migrations), so no gate on this PR consumes that verdict.

## Merge SHA Binding

Merge SHA: f7cc5193117a5404036c2c15a8a27a4dec43a929
PR: https://github.com/griff843/Unit-Talk-v2/pull/1585
Approved PR head: 4f346839aca82b78e271b5ab187d768da3cbfece
Execution SHA: 5859b3e1c12ea866328b8669728c1b495fa00b37
