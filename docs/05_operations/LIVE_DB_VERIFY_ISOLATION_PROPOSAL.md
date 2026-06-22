# Live DB Verify Isolation Proposal

Issue: UTV2-1291
Status: proposal only; no CI or workflow changes in this lane.

## Purpose

Transient Supabase degradation should not turn unrelated docs-only or T3 hygiene lanes into live-write retries, and it should not amplify load on an already degraded database. The fix must preserve T1 runtime proof integrity: runtime, data-canonical, and migration lanes still need real live-DB proof before merge.

This proposal separates code correctness from live infrastructure availability. Static and local verification remain required everywhere. Live-DB proof stays fail-closed for T1/runtime lanes, but docs-only and low-risk hygiene lanes should not require live writes when Supabase is degraded.

## Current Findings

`pnpm verify` currently runs:

1. `pnpm ops:sync-check`
2. `pnpm ops:system-alignment-check`
3. `pnpm ops:automation-coverage-check`
4. `pnpm env:check`
5. `pnpm lint`
6. `pnpm type-check`
7. `pnpm build`
8. `pnpm test`
9. `pnpm --filter @unit-talk/smart-form verify`
10. `pnpm verify:commands`

The pressure point is `pnpm test`. It runs local/unit groups and then `pnpm test:t1-proof`. `test:t1-proof` is a sequential chain of T1 proof tests, several of which are live Supabase tests gated only by Supabase credentials.

`.github/workflows/ci.yml` also runs `pnpm ci:db-smoke` as a separate CI step after `pnpm verify`. In CI, `local.env` is populated with Supabase secrets, so `pnpm verify` can execute the embedded T1 live-proof chain before the separate database smoke step runs.

The standalone DB smoke helper is `scripts/ci/required-db-smoke.ts`. It runs `pnpm test:db`, which maps to `tsx --test apps/api/src/database-smoke.test.ts`. It distinguishes missing credentials from optional skips, but it does not currently distinguish "Supabase degraded" from a code failure once credentials are present.

## Live-DB Suites

The live-DB write suites in the current root scripts are:

| Suite | Invocation | Live dependency | Writes or attempted writes |
| --- | --- | --- | --- |
| `apps/api/src/database-smoke.test.ts` | `pnpm test:db`; also `pnpm ci:db-smoke` | Requires Supabase URL, anon key, and service-role key | `picks`, `submissions`, `pick_lifecycle`, `distribution_outbox`, `distribution_receipts`, `settlement_records`, and `audit_log` through real services/RPCs; also direct cleanup deletes for test-created `picks` and `submissions` |
| `apps/api/src/t1-proof-awaiting-approval.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Creates proof picks through the real submission/governance-brake path; verifies `picks`, `pick_lifecycle`, and `audit_log` |
| `apps/api/src/t1-proof-atomicity.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Direct REST/RPC inserts into `submissions`, `picks`, and `distribution_outbox`; verifies atomic lifecycle, delivery, settlement, and rollback behavior |
| `apps/api/src/t1-proof-awaiting-approval-review.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Creates awaiting-approval picks through the real pipeline; writes review decisions and verifies `picks` plus `audit_log` |
| `apps/api/src/t1-proof-lifecycle-invariants.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Creates proof picks and exercises live `pick_lifecycle` transitions |
| `apps/api/src/t1-proof-risk-score.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Submits picks through the in-process controller and verifies persisted risk metadata |
| `apps/api/src/t1-proof-utv2-1018-stranded-picks.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Creates proof picks and writes stranded-pick audit evidence |
| `apps/ingestor/src/t1-proof-utv2-1084-raw-payload-archive.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Inserts raw provider payload archive proof rows and verifies immutability |
| `apps/api/src/t1-proof-utv2-1116-artifact-sha-immutability.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Creates live artifact rows and verifies stored SHA immutability |
| `apps/api/src/t1-proof-utv2-1107-picks-fsm-trigger.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Creates live picks and attempts invalid direct `picks.status` updates |
| `apps/api/src/t1-proof-execution-intent.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Inserts `execution_intents`, attempts rejected update/delete, checks uniqueness and constraints |
| `apps/api/src/t1-proof-utv2-1136-settlement-records-immutability.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Creates picks and `settlement_records`; attempts rejected update/delete |
| `apps/api/src/t1-proof-utv2-1137-settlement-corrections.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Creates picks, settlement records, and `settlement_corrections`; verifies additive correction behavior |
| `apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts` | `pnpm test:t1-proof` | Requires Supabase service-role key | Writes and verifies `provider_offer_history` bounded dedup behavior |

The remaining files in `test:t1-proof` are proof-named but local/domain-only in this script chain: authority matrix, dual-auth, approval expiration, governance rollback, dual-auth expiry boundary, cross-domain enforcement, and terminal rollback states. They do not need live Supabase access and should remain in the local/static test path.

## Required By Lane Type

T1 runtime, data-canonical, migration, and schema-authority lanes still require real live proof. For those lanes, the live suites above are not optional when they correspond to the changed surface. `T1 Proof Gate` already runs `pnpm ci:db-smoke` with `CI_REQUIRE_DB_SMOKE=true` for `tier:T1`, and that strict gate should remain fail-closed.

Docs-only lanes and T3 hygiene lanes do not need live writes to prove their change. They still need `lint`, `type-check`, `build`, local unit tests, R-level compliance where triggered, file-scope lock checks, tier-label checks, executor-result validation, and merge-gate policy. They should not require live writes to `picks`, `audit_log`, `execution_intents`, `settlement_records`, provider history, outbox, or receipts when those tables are unrelated to the diff.

T2 runtime-adjacent lanes should be classified by changed path, not tier alone. A T2 docs/governance lane should follow the docs/T3 live-DB policy. A T2 lane touching `apps/api/src/**-service.ts`, `packages/db/**`, `supabase/migrations/**`, or runtime proof paths should require the relevant live proof or a PM-approved deferral state.

## Primary Approach

Split verification into three explicit layers and wire CI by lane risk:

1. `verify:static` gates every PR.
   - Runs sync/alignment/automation checks, env check, lint, type-check, build, local tests, smart-form verify, and command verification.
   - Excludes live Supabase smoke and live T1 proof tests.
   - Fails as a code failure.

2. `test:live-db` owns all live Supabase tests.
   - Runs `pnpm test:db`.
   - Runs only the live subset of `test:t1-proof`.
   - Executes serially with one CI concurrency group, for example `live-db-proof-${{ github.repository }}`, so multiple PRs do not multiply write pressure during degradation.
   - Emits a machine-readable verdict: `passed`, `code_failed`, `infra_unavailable`, or `proof_skipped`.

3. Tier/path policy decides whether the live verdict blocks merge.
   - T1 runtime/data-canonical/migration lanes: `test:live-db` must pass on the PR head or through a PM-approved Supabase branch/live proof path. `infra_unavailable` blocks merge as proof insufficient, but it is reported as infrastructure-blocked rather than code-failed.
   - T2 runtime-adjacent lanes: live proof is required when the changed paths match DB-writing or runtime proof policy. `infra_unavailable` blocks until PM decides deferral or rerun.
   - Docs-only and T3 hygiene lanes: `test:live-db` is advisory or skipped when `verify:static` is green and the diff does not touch runtime/DB-sensitive paths. `infra_unavailable` does not convert the PR to code-failed and does not create extra live write attempts.

This keeps T1 strict while removing unrelated live writes from docs-only and low-risk lanes.

## State Model

| State | Meaning | Merge behavior |
| --- | --- | --- |
| Code failure | Static/local checks or live tests fail due to assertions, type errors, lint, build errors, migration drift, or application behavior. | Block. Fix required before merge for every tier. |
| Infrastructure unavailable | Supabase live DB is unreachable, timing out, schema-cache degraded, or write path is unavailable before a conclusive assertion can run. | Do not label as code failure. T1/runtime lanes remain blocked because proof is missing. Docs-only/T3 lanes may proceed only if static/local gates are green and no runtime-sensitive paths are touched. |
| Proof insufficient | A lane that requires live proof has no successful live proof bound to the current head SHA, or proof is stale/skipped. | Block. Applies to T1 always and to any T2/T3 lane whose paths trigger live-proof policy. |
| Merge allowed | Required static/local checks pass; required live proof passes or is not required for the lane; tier approval policy is satisfied. | T1 still needs live proof plus PM approval. T2 needs PM verdict or review approval per Merge Gate. T3 can merge on green required checks and executor validation. |

## Implementation Sketch

The follow-up implementation lane should change code and workflows, but this lane intentionally does not.

Suggested script changes:

- Add `test:t1-proof:local` containing the proof-named local/domain tests currently inside `test:t1-proof`.
- Add `test:t1-proof:live` containing the live Supabase subset listed above.
- Change root `test` to run local tests only, ending with `test:t1-proof:local`.
- Add `test:live-db` as `pnpm test:db && pnpm test:t1-proof:live`.
- Add `verify:static` as the current `verify` minus live DB tests.
- Keep `verify` as the full local developer gate if desired, or make it call `verify:static` plus `test:live-db` only when `UNIT_TALK_REQUIRE_LIVE_DB_VERIFY=true`.

Suggested CI changes:

- In `.github/workflows/ci.yml`, replace the single `pnpm verify` step with `pnpm verify:static`.
- Add a separate `Live DB Proof` job that runs `pnpm test:live-db` only when path/tier policy requires it, or when manually requested.
- Put the live DB job in a repository-level concurrency group with `cancel-in-progress: false`.
- Teach `scripts/ci/required-db-smoke.ts` or a new wrapper to classify timeout/schema-cache/network errors as `infra_unavailable` and emit JSON for the CI summary.
- Keep `T1 Proof Gate` fail-closed for `tier:T1`, but have it consume the live DB proof job result when available instead of launching a duplicate live write run.
- Keep `Proof Coverage Guard` path-based and fail-closed for sensitive runtime changes. It should require proof coverage files for sensitive path diffs, not force docs-only lanes into live writes.

Suggested branch-protection posture:

- Keep `CI / verify` or its renamed static equivalent required.
- Keep `Merge Gate`, `Executor Result Validation`, `Tier Label Check`, `File Scope Lock Check`, and `R-Level Compliance Check` required where they are currently required.
- Keep `T1 Proof Gate` required/effective for T1 labels.
- Make the new `Live DB Proof` check required only for T1 and runtime/DB-sensitive path matches. For docs-only/T3 lanes, the check should be skipped/advisory and should not block a static-green PR during a Supabase incident.

## Alternatives Considered

1. Only serialize the existing live DB tests.
   - This reduces write pressure but still makes docs-only and T3 lanes wait on unrelated live DB health.

2. Only skip `pnpm ci:db-smoke` on docs-only lanes.
   - This misses the embedded live proof chain inside `pnpm verify` because `pnpm test` currently runs `test:t1-proof`.

3. Keep current CI but manually override red live-DB checks during incidents.
   - This blurs code failure and infrastructure failure, creates audit ambiguity, and risks accidental T1 proof weakening.

The primary split is stronger because it makes the proof requirement explicit, serializes the live write path, and preserves a clear audit trail for both blocked T1 proof and docs-only progress.

## Non-Goals

- No change to `.github/workflows/**` in UTV2-1291.
- No weakening of T1 runtime proof.
- No PM-gate bypass.
- No public Discord changes.
- No P3 certification claims.
- No live backfill, data repair, or mutation outside test-created proof rows.
