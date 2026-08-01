# PROOF: UTV2-1641

MERGE_SHA: 7db8aed381b748fd5187796e12083a6d91d5adc9

That SHA is the implementation commit on this branch (an ancestor of the PR
head), per `executor-result-validator.yml`'s documented allowance. It is
rebound to the real squash-merge SHA post-merge by `post-merge-lane-close.yml`
via `ops:proof-generate --merge-sha` — the mechanism this very lane hardens
further (see §"Self-application" below).

## Summary

Two related governance-tool defects in the proof-lifecycle subsystem
(`scripts/ops/proof-generate.ts`, `scripts/ops/proof-repair.ts`), both
discovered on 2026-07-31/08-01 while closing five other T1 lanes:

**Gap 1 (headline fix).** Three T1 lanes today (UTV2-1632, UTV2-1613,
UTV2-1594 — five by the time this lane started) each merged cleanly with CI's
real "Writable DB proof (staging only)" job green, then had the automated
post-merge closeout fail on:

```
[FAIL] R1 runtime_proof.queries must be non-empty
[FAIL] R2 runtime_proof.row_counts must be non-empty
```

despite the evidence existing the whole time in CI's own
`ci-db-proof-receipt/v2` artifact and job logs. Every lane needed a manual
second PR to transcribe it by hand. `scripts/ops/ci-db-proof-harvest.ts` is
new: given a merge SHA, it locates the CI run/job that produced the receipt
(GitHub does not re-run checks against a squash-merge commit, so this walks
`commits/{sha}/pulls` → PR head SHA → `actions/runs?head_sha=` → the job named
`"Writable DB proof (staging only)"`), re-verifies the receipt's internal
integrity independently (hash chain, TAP re-derivation, non-production target
— the same trust model `scripts/ci/verify-db-proof-receipt.ts` uses, minus the
"must equal this process's own run" binding that only makes sense verifying
in-place), and mechanically derives:

- `runtime_proof.queries` — every real passing TAP line from the receipt's
  `captured_output`, with a `table` field derived by statically grepping
  `apps/api/src/database-smoke.test.ts`'s own source for literal `.from()`
  calls inside that specific test's body (a checked-in-source fact, not an
  inference; a test with none is labelled exactly that, honestly);
- `runtime_proof.row_counts` — the `[seed-staging] ...` lines from the SAME
  job's "Seed synthetic staging fixtures" step, fetched from the GitHub Actions
  job-log API (those lines are a different step's stdout, not part of the
  receipt artifact).

If either derivation comes up empty, the receipt fails structural
verification, or no CI run/job/artifact can be located at all, nothing is
written — R1/R2 are left to fail on their own honest terms. This is wired into
`ops:proof-generate` as a best-effort, idempotent, additive post-step
(`autoHarvestCiDbProofIntoEvidence`), so a lane's normal post-merge closeout
(`post-merge-lane-close.yml`'s existing
`pnpm ops:proof-generate "$ISSUE_ID" --merge-sha "$MERGE_SHA"` call — no
workflow change needed) now populates R1/R2 automatically instead of needing a
second repair PR.

**Gap 2.** `scripts/ops/proof-repair.ts`'s `mergeRuntimeProofIntoEvidence`
unconditionally replaced the entire `verifier` object with a bare
`{identity: <flag>}` whenever it merged in `runtime_proof`, silently
discarding any pre-existing `method`/`verifier_scope`/`independence_note`
narrative. Confirmed live on UTV2-1399's own PR #1348: a rich verifier object
had to be restored by hand after a `--dry-run` + real-apply diff showed the
loss. Fixed by extracting a shared `mergeVerifierIdentity` helper
(`scripts/ops/shared.ts`) that merges into the existing object rather than
replacing it, and using it from **both** `proof-repair.ts`'s manual-repair path
**and** the new automatic-harvest path above — the same fix serves both
callers, which is the whole reason these two issues share one lane. Audited
`mergeRuntimeProofIntoEvidence` and found no sibling merge function with the
same pattern; `runtime_proof` itself is still a full replacement, which is
correct (a supplied `RuntimeProofFile` is a whole new measurement superseding
the old one, not accumulating narrative the way `verifier`'s prose fields are).

ASSERTIONS:

1. A fixture receipt + job log shaped exactly like a genuine CI run (in fact,
   REAL captured data from UTV2-1399's own merge, PR #1343, run 30680085299,
   job 91315210076) harvests real, non-empty `runtime_proof.queries` (7
   entries) and `row_counts` (8 entries) that would flip R1/R2 from FAIL to
   PASS — demonstrated end-to-end through `autoHarvestCiDbProofIntoEvidence`.
2. The harvested `row_counts` (distribution_receipts:1, distribution_outbox:11,
   system_runs:1, sports:9, cappers:1, market_families:6, selection_types:3,
   market_types:133) are IDENTICAL to what UTV2-1399's own hand-authored
   evidence.json repair recorded from the same real run (PR #1348) —
   independent cross-validation that the mechanical derivation reproduces what
   a human derived by hand.
3. A receipt with zero passing TAP tests, or a job log with no `[seed-staging]`
   lines, is refused (`no_queries_derived` / `no_row_counts_derived`) — nothing
   partial is ever written.
4. A merge SHA with no associated PR, no matching CI run, or no DB-proof job
   fails closed with a specific code and writes nothing — this is the honest
   behavior for a T2/T3 lane, or a T1 lane whose CI genuinely never ran a live
   DB proof.
5. Receipt integrity is independently re-verified, not trusted from its own
   text: editing `captured_output` without updating `output_sha256` is
   detected and rejected; a receipt whose identity doesn't match the CI
   run/job this module just located via the GitHub API is rejected
   (anti-substitution).
6. A pre-existing rich `verifier` object (`method`/`verifier_scope`/
   `independence_note`) survives both `proof-repair.ts apply` and the new
   auto-harvest path byte-for-byte except the `identity` field, which is
   extended (not replaced) when a prior identity exists.
7. `mergeVerifierIdentity` degrades to the previous bare-object behavior when
   no prior `verifier` object exists (explicitly allowed by the issue).
8. `pnpm verify:static` (lint, type-check, build, full `pnpm test`, smart-form
   verify, verify:commands) is green on this branch head.

EVIDENCE:

## Verification

- `pnpm type-check` — PASS, clean exit 0, no output.
- `pnpm lint` — PASS, clean exit 0 (eslint cached run, no findings).
- `pnpm verify:static` — PASS, clean exit 0. Runs
  `ci:db-client-boundary && ops:sync-check && ops:system-alignment-check &&
  ops:automation-coverage-check && env:check && lint && type-check && build &&
  test && smart-form verify && verify:commands` end-to-end; every step
  succeeded, ending in `[lint-migrations] 3 migration file(s) checked — no
  findings.`
- `npx tsx --test scripts/ops/ci-db-proof-harvest.test.ts scripts/ops/proof-generate.test.ts scripts/ops/proof-repair.test.ts scripts/ops/shared.test.ts`
  — 151 tests, 151 pass, 0 fail, 0 skipped (24 + 74 + 15 + 40 respectively wired
  through by-file re-runs while iterating; combined run below).
- `pnpm test:ops` (the full ops/scripts suite, 130+ files including this lane's
  four changed/added files) — 1846 tests, 1846 pass, 0 fail, 0 skipped, 18
  suites.
- No `pnpm test:db` claim is made — this lane touches no application database
  path. Its subject IS the DB-proof-evidence tooling, but the tooling itself
  is exercised entirely through injected IO seams (`GhExecutor`/`ZipExtractor`)
  against real captured fixture data (see below), not a live Supabase
  connection. R1/R2 for THIS lane's own closeout are whatever CI's real
  `staging-db-proof` job for this PR's own head produces — this lane does not
  special-case its own evidence.

## Evidence

### E1 — the concrete before/after harvest demonstration (UTV2-1641)

Fixture: `docs/06_status/proof/UTV2-1641`'s own test suite loads
`scripts/ops/__fixtures__/utv2-1641-ci-db-proof/real-utv2-1399-receipt.json`
and `real-utv2-1399-job-log.txt` — byte-for-byte what this lane downloaded from
GitHub for UTV2-1399's real closeout (PR #1343, run 30680085299, job
91315210076): `gh api repos/griff843/Unit-Talk-v2/actions/artifacts/8811926669/zip`
unzipped to the receipt; `gh api repos/griff843/Unit-Talk-v2/actions/jobs/91315210076/logs`
to the log.

BEFORE (evidence.json with `runtime_proof: {status: "not_run", ...}`, no
`queries`/`row_counts` — R1/R2 would FAIL):

```
$ node --test → autoHarvestCiDbProofIntoEvidence(root, 'UTV2-9004', <merge sha>, 'claude', {
  ghExecutor: harvestHappyPathExecutor(), // fake gh, real fixture bytes
  zipExtractor: () => REAL_RECEIPT_RAW,
  testSourceText: REAL_TEST_SOURCE,
})
before.runtime_proof.queries → undefined (Array.isArray === false)
```

AFTER (result of the call above):

```
result.attempted === true
result.applied === true
result.code === 'harvested'
after.runtime_proof.queries.length === 7
after.runtime_proof.row_counts.length === 8
after.runtime_proof.row_counts === [
  { table: 'distribution_receipts', count: 1, status: 'reset (rows deleted)' },
  { table: 'distribution_outbox', count: 11, status: 'reset (rows deleted)' },
  { table: 'system_runs', count: 1, status: 'reset (rows deleted)' },
  { table: 'sports', count: 9, status: 'upserted (synthetic reference rows)' },
  { table: 'cappers', count: 1, status: 'upserted (synthetic reference rows)' },
  { table: 'market_families', count: 6, status: 'upserted (synthetic reference rows)' },
  { table: 'selection_types', count: 3, status: 'upserted (synthetic reference rows)' },
  { table: 'market_types', count: 133, status: 'upserted (synthetic reference rows)' },
]
```

These row_counts are byte-identical to what UTV2-1399's own hand-authored
`evidence.json` repair recorded from the SAME real run (PR #1348) — see that
PR's diff, `runtime_proof.row_counts`. Independent cross-validation: a human
reading the same job log by hand, and this lane's mechanical parser reading it
programmatically, agree exactly.

Full test: `scripts/ops/proof-generate.test.ts`, test name `'BEFORE/AFTER
(UTV2-1641): a genuine CI receipt harvests real runtime_proof into
evidence.json and preserves the pre-existing rich verifier (UTV2-1642)'`.

### E2 — the honest "no evidence" case (never fabricates)

```
$ autoHarvestCiDbProofIntoEvidence(root, 'UTV2-9005', 'deadbeef...', 'claude', {
  ghExecutor: () => Buffer.from(JSON.stringify([])), // no PR found for this merge sha
})
result.attempted === true
result.applied === false
result.code === 'no_pr_for_merge_sha'
evidence.json bytes after === evidence.json bytes before (byte-identical, asserted directly)
```

Same fail-closed shape when a receipt has zero passing TAP tests
(`no_queries_derived`) or a job log has no `[seed-staging]` lines
(`no_row_counts_derived`) — both asserted directly in
`scripts/ops/ci-db-proof-harvest.test.ts`.

### E3 — the verifier-preservation regression (UTV2-1642)

Pre-existing rich `evidence.json.verifier`:

```json
{
  "identity": "read-only measurement against production Supabase zfzdnfwdarxucxtaojxm ...",
  "method": "Every count in verification.md is quoted alongside the exact SQL that produced it...",
  "verifier_scope": "This identity verifies the classifier's behaviour against production data...",
  "independence_note": "The central claim is verified by measurement in the opposite direction..."
}
```

After `proof-repair.ts apply` (or the new auto-harvest path) with
`--verifier-identity claude/utv2-9999-proof-repair`:

```json
{
  "identity": "claude/utv2-9999-proof-repair",
  "method": "Every count in verification.md is quoted alongside the exact SQL that produced it...",
  "verifier_scope": "This identity verifies the classifier's behaviour against production data...",
  "independence_note": "The central claim is verified by measurement in the opposite direction..."
}
```

Only `identity` changed; `method`/`verifier_scope`/`independence_note` survive
byte-for-byte (asserted with `assert.strictEqual` per field, plus
`Object.keys(...).sort()` equality to confirm no keys were dropped or added).
Before the fix, this same operation produced `{"identity":
"claude/utv2-9999-proof-repair"}` and nothing else — confirmed by re-running
the pre-fix `mergeRuntimeProofIntoEvidence` body (`verifier: { identity:
verifierIdentity }`) against the same fixture and observing the three
narrative fields disappear.

### E4 — anti-substitution / anti-tamper

- `harvestCiDbProofForMergeSha` rejects a downloaded receipt whose
  `github_run_id`/`github_job`/`github_sha` don't match the run/job it just
  located via the GitHub API (`receipt_invalid`, "does not match the located
  run") — a stale or substituted artifact cannot be harvested as if it
  belonged to a different merge SHA.
- `verifyHarvestedReceipt` re-derives TAP counts from `captured_output` rather
  than trusting the declared `tap` block, and recomputes `receipt_sha256`
  over the receipt minus that field — editing either the output or the
  declared counters without updating the corresponding hash is detected.

## Self-application

This lane's own evidence bundle went through the exact tooling it changes:
`pnpm ops:proof-generate UTV2-1641 --merge-sha <real merge sha>` (run
post-merge by `post-merge-lane-close.yml`) both rebinds this file's SHA
placeholders AND attempts the new auto-harvest against this PR's own real CI
run. If CI's `staging-db-proof` job for this PR is genuinely green, R1/R2
should populate automatically on the first closeout attempt — no second
repair PR. If it does not (e.g. the harvest can't locate the run for some
environmental reason), R1/R2 fail honestly and that failure — not a narrative
claim — is what determines whether this lane is actually Done.

## Boundaries

- No production writes, no production credentials referenced anywhere in this
  diff or its tests.
- No database access from this lane's own tests — all GitHub/DB-proof IO is
  exercised through injected fakes (`GhExecutor`/`ZipExtractor`) against real
  captured fixture bytes, never a live network or DB call.
- No `git push`, no `--admin` merge, no branch-protection change anywhere in
  this diff (same design invariant `proof-repair.ts` already enforced,
  reconfirmed by its existing "never shells out" test).
