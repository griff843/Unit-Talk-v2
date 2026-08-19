# PROOF: UTV2-1683
MERGE_SHA: d637c92c40badf4c1624bfbd7139758e3be05eab

# UTV2-1683 — Diff Summary

**Lane:** UTV2-1683 — Repair CI-DB-proof harvest so runtime evidence binds to the merge SHA
**Tier:** T2 · **Lane type:** hygiene · **Executor:** claude
**Branch:** `claude/utv2-1683-ci-db-proof-harvest-merge-sha`
**Source head at authoring:** `5b5e85f79592c884e055c3e777b7bde077f600cb`

## Scope

| File | Change |
|---|---|
| `scripts/ops/ci-db-proof-harvest.ts` | A1 merge-SHA-first run location; A2 merge-ref ancestry proof; extracted `findWorkflowJobForHeadSha`; ANSI job-log retry |
| `scripts/ops/ci-db-proof-harvest.test.ts` | 10 new tests incl. the 3 PM-required regressions; fixture corrected to model reality |
| `scripts/ops/proof-generate.ts` | B mechanical `static_proof` from the merge-SHA `verify` run; wired into `main` |
| `scripts/ops/proof-generate.test.ts` | 6 new `static_proof` tests; harvest fixture corrected |
| `docs/06_status/lanes/UTV2-1683.json`, `.ops/sync/UTV2-1683.yml`, `docs/06_status/proof/UTV2-1683/**` | lane apparatus |

`+892 / -60` across 7 files. No UTV2-1627 artifact is touched by this lane.

## A1 — merge-SHA-first run location

`locateCiDbProofRun` now tries `ci.yml` runs at `head_sha=<mergeSha>` **before** resolving the PR. `ci.yml` runs on push to `main`, so a merge commit normally has its own CI run whose `GITHUB_SHA` **is** the merge SHA — the receipt therefore binds directly to the tree that landed, with no indirection.

Fall-through is deliberately narrow. Only "this SHA genuinely has no such run" (`no_ci_run_found` / `no_db_proof_job`) proceeds to the weaker PR source; that is the real case of a proof-only merge commit, which `ci.yml` skips via `paths-ignore`. A transport failure returns `gh_api_error` immediately, so unknown state can never be silently downgraded to the weaker binding.

## A2 — merge-ref ancestry fallback

On a `pull_request` event `GITHUB_SHA` is GitHub's synthetic merge-ref commit, **not** the PR head that `target_head_sha` records. The old check `receipt.github_sha === target_head_sha` therefore could not pass for **any** lane — confirmed against live data:

```
receipt.github_sha 72b63dd7 = "Merge 8fb32317 into eec9277c"   (UTV2-1627)
located target_head_sha     = 8fb32317                          (PR #1320 head)
```

The fallback now accepts a merge-ref SHA only when GitHub proves the commit has exactly two parents and its **second** parent is the PR head. This is positive identification, not a loosened comparison — a receipt from another PR, another push, or a hand-built commit is still refused, and an unreadable ancestry response fails closed.

## B — mechanical `static_proof`

Truth-check P7 requires `static_proof` **and** `runtime_proof` populated, but nothing in `scripts/` had ever written `static_proof` — the UTV2-1641 harvest writes only `runtime_proof` and `verifier`. P7 stayed red even for a fully green lane, and the only remedy was to hand-author the section: exactly the narrative proof the truth model exists to eliminate.

`autoPopulateStaticProofFromVerifyRun` derives it from the `verify` job of the merge SHA's own run — same binding A1 uses, so both proof halves describe the same tree. Records conclusion, run URL, run/job ids, `merge_sha`, and `test_run_logs` entries carrying `merge_sha` (what P8 reads). Writes nothing when there is no `verify` job, when it did not succeed, or when `static_proof` is already present.

## Fixture correction (why this defect survived)

`REAL_RUN_INFO.target_head_sha` was set to `b36840e4`. Live API says that commit is `"Merge 4aaa6c56 into f4c529b5"` — the **merge ref**, not PR #1343's head (`4aaa6c56`). That back-filled value made the old identity assertion pass in tests while failing for every real lane, so the unit tests could never catch the bug. Fixtures now model reality and the merge-ref relationship is asserted explicitly.

## C — ANSI job-log retry (found by live validation)

`row_counts` are parsed from the `staging-db-proof` job's raw log. Actions logs are ANSI-coloured and `gh` ≥ 2.9x refuses to emit escape sequences without `--allow-escape-sequences`, so `fetchCiDbProofJobLog` failed with `job_log_fetch_failed` — *after* both new identity checks passed. A1 and A2 alone would still have yielded `no_row_counts_derived`.

`fetchCiDbProofJobLog` now attempts the plain call and retries with the flag only on that specific refusal, so older `gh` (which lacks the flag) is unaffected. Two tests cover it, including one asserting a 404 is not retried as if it were an ANSI refusal.

Unit tests could not have caught this: every existing test injects a fake `GhExecutor`.

## Blast radius

Read-path only: resolves GitHub runs and writes two additive sections into an evidence bundle. No product behavior, DB contract, migration, lifecycle, or runtime execution path is touched. `runtime_proof.ci_run` gains one additive field (`identity_source`).
