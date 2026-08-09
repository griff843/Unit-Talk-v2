# PROOF: UTV2-1683
MERGE_SHA: ccfe9d89a26f52e2aaa79d8214a56b9c3a3e6920

ASSERTIONS:
- [x] `locateCiDbProofRun` prefers the merge SHA's own push-triggered CI run, so harvested runtime proof binds to the implementation merge SHA rather than a PR head or a repair commit.
- [x] A transport failure on that lookup fails closed with `gh_api_error` instead of silently downgrading to the weaker PR-head binding.
- [x] The PR-head fallback accepts a merge-ref receipt only when GitHub proves the commit has exactly two parents and its second parent is the target head; substitution, non-merge commits, and unreadable ancestry are all rejected.
- [x] A receipt whose `github_sha` is not the target implementation SHA is rejected.
- [x] A receipt whose `github_sha` IS the merge SHA is accepted and yields non-empty `runtime_proof.queries` and `runtime_proof.row_counts`.
- [x] `static_proof` is populated mechanically from the merge SHA's successful `verify` job, and writes nothing when that job is absent, unsuccessful, or the section already exists.
- [x] `fetchCiDbProofJobLog` retries with `--allow-escape-sequences` only on that specific `gh` refusal, leaving older `gh` and unrelated failures untouched.
- [x] All five injected mutations were killed by the tests naming their conditions.

EVIDENCE:
```text
$ pnpm verify:static
exit 0

$ pnpm test:ops
# tests 2089 / # pass 2089 / # fail 0

$ npx tsx --test scripts/ops/ci-db-proof-harvest.test.ts scripts/ops/proof-generate.test.ts
# tests 117 / # pass 117 / # fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 9
Rules matched: (none) - no R-level artifacts required for this diff

$ npx tsx <live read-only harvest at merge SHA 20505c8e7f0ee3ddd89f599c99d0b8af55836fde>
{ "ok": true, "identity_source": "merge_sha_run",
  "run_id": 31276897581, "job_id": 93151835178,
  "target_merge_sha": "20505c8e7f0ee3ddd89f599c99d0b8af55836fde",
  "supabase_project": "xskgrzbteyqdufktjrjx",
  "tests": 7, "pass": 7, "fail": 0,
  "queries_count": 7, "row_counts_count": 8 }
```

R-level compliance: `scripts/ci/r-level-check.ts` returns PASS with no rules matched — this diff touches
no lifecycle, promotion, settlement, strategy, or operator-UI path, so no R1-R5 artifact is required.

---

# UTV2-1683 — Verification

**Lane:** UTV2-1683 · **Tier:** T2 · **Lane type:** hygiene · **Executor:** claude
**Branch:** `claude/utv2-1683-ci-db-proof-harvest-merge-sha`
**Source head measured:** `5b5e85f79592c884e055c3e777b7bde077f600cb`
**Merge SHA:** not yet merged — this section is rebound post-merge by `post-merge-lane-close.yml`.

## Verification

All receipts below are measured executions against this exact tree. Nothing is claimed that was not run.

| Gate | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | **PASS** (exit 0) | full chain: db-client-boundary, sync-check, system-alignment, automation-coverage, env:check, lint, type-check, build, test, smart-form verify, verify:commands |
| `pnpm type-check` / `pnpm build` (`tsc -b`) | **PASS** (exit 0) | included in verify:static |
| `pnpm test:ops` | **PASS** — 2089 tests / 2089 pass / 0 fail / 0 skipped | the suite carrying both changed modules |
| `scripts/ops/ci-db-proof-harvest.test.ts` | **PASS** — 37 pass / 0 fail (was 27) | +10 tests |
| `scripts/ops/proof-generate.test.ts` | **PASS** — 80 pass / 0 fail (was 74) | +6 tests |
| `pnpm verify` (full) | **NOT_RUN** — see below | fails closed at `ci:assert-staging` |
| `pnpm test:db` / `test:live-db` | **NOT_RUN** — no staging credential on this host | see below |

### Why `pnpm verify` is NOT_RUN rather than PASS

`verify = verify:static && test:live-db`, and `test:live-db` begins with `pnpm ci:assert-staging`. On this credential-free checkout that guard refuses, by design:

```
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci
GitHub environment with CI_SUPABASE_* credentials.
```

This is UTV2-1627's own guard behaving correctly — a test runner on a host with no isolated writable target must not proceed. The authority for the live half is CI's `verify` job, which binds the `staging-ci` environment. It is recorded here as NOT_RUN with its reason rather than claimed as passing.

## Controls validated by execution path

A control is only proven by making it **fail** on the condition it names. Five mutations were applied to this tree and reverted; each killed exactly the test naming its condition.

| # | Mutation | Result |
|---|---|---|
| M1 | A2 ancestry check replaced with unconditional accept | **KILLED** — 3 failures (regressions 3b, 3c, 3d) |
| M2 | `gh_api_error` no longer fails closed on the merge-SHA lookup | **KILLED** — 1 failure (transport fail-closed test) |
| M3 | `merge_sha_run` exactness removed | **KILLED** — 1 failure (regression 1) |
| M4 | `static_proof` no longer requires a successful `verify` job | **KILLED** — 1 failure (red-gate test) |
| M5 | `static_proof` overwrites an existing section | **KILLED** — 1 failure (never-overwrite test) |

**M2 initially SURVIVED.** The first version of that test threw on every call except the merge-SHA lookup, so removing the fail-closed branch still produced `gh_api_error` further down the PR path — it passed for the wrong reason and proved nothing. The fake was rewritten to offer a fully working PR fallback, so the assertion now only holds if the branch genuinely stops the downgrade. Re-running the same mutation then produced 1 failure. Recorded because the surviving-mutant finding is the substantive part.

## PM-required regression coverage

| Requirement | Test | Result |
|---|---|---|
| 1. Receipt mismatch rejection — incorrect `github_sha` must fail | `UTV2-1683 regression 1` | PASS (asserts rejection) |
| 2. Exact merge SHA acceptance — receipt SHA == target merge SHA must pass | `UTV2-1683 regression 2` | PASS (asserts acceptance + non-empty queries/row_counts) |
| 3. Merge-ref fallback succeeds only when second-parent proves identity | `regression 3a` (accept), `3b` (wrong parent → reject), `3c` (not a merge commit → reject), `3d` (unreadable ancestry → fail closed) | PASS |

## Live end-to-end validation (read-only, real GitHub data)

Running the fixed harvester against the real merge SHA `20505c8e7f0ee3ddd89f599c99d0b8af55836fde` — no fakes, no injected executor:

```json
{ "ok": true,
  "identity_source": "merge_sha_run",
  "run_id": 31276897581, "job_id": 93151835178,
  "target_head_sha":  "20505c8e7f0ee3ddd89f599c99d0b8af55836fde",
  "target_merge_sha": "20505c8e7f0ee3ddd89f599c99d0b8af55836fde",
  "supabase_project": "xskgrzbteyqdufktjrjx",
  "tests": 7, "pass": 7, "fail": 0,
  "queries_count": 7, "row_counts_count": 8 }
```

`static_proof` against the same SHA returned `static_proof_populated` with `conclusion: success`, run 31276897581, job 93152450883, and `test_run_logs[0].merge_sha` = the merge SHA. Written into a scratch directory — **no repository proof artifact was modified by this check**.

R1 (queries non-empty), R2 (row_counts non-empty), P7, P8 and P9 all have their required inputs, bound to the implementation merge SHA rather than any repair commit.

### A third defect this live run exposed

The first live attempt failed *after* both new identity checks passed:

```
job_log_fetch_failed: the response contains terminal escape sequences;
pass --allow-escape-sequences to output it anyway
```

Actions job logs are ANSI-coloured and `gh` ≥ 2.9x refuses to emit escape sequences without an explicit flag, so `fetchCiDbProofJobLog` could not read the logs that `row_counts` are derived from. A1 and A2 alone would still have produced `no_row_counts_derived`. Fixed by attempting the plain call first and retrying with `--allow-escape-sequences` only on that specific refusal, which keeps older `gh` (where the flag does not exist) working. Covered by two tests, including one asserting a 404 is **not** retried as if it were an ANSI refusal.

This defect was invisible to unit tests because every existing test injects a fake `GhExecutor`. It is recorded here because it is the reason live validation was worth running at all.

## Live-data grounding

The fixture correction is not a guess. Verified against the GitHub API at authoring time:

- `b36840e4` → `"Merge 4aaa6c56d3f741b7bcc9ae9cd17c1478120f3772 into f4c529b51267d86c2dfbd38bdcfab527bd31668c"`, parents `[f4c529b5, 4aaa6c56]`
- PR #1343 head → `4aaa6c56d3f741b7bcc9ae9cd17c1478120f3772`
- UTV2-1627's receipt `72b63dd7` → `"Merge 8fb32317 into eec9277c"`; PR #1320 head → `8fb32317`

Both confirm `GITHUB_SHA` on a `pull_request` run is the merge ref, which is the premise A2 encodes.

## Constraints observed

- No `docs/06_status/proof/UTV2-1627/**` or `docs/06_status/lanes/UTV2-1627.json` edit in this lane.
- No manifest hand-edit; lane state written only by `ops:lane-start` / `ops:lane:block`.
- No bypasses; no approval artifacts created.
- No unrelated cleanup. The two fixture corrections are load-bearing: without them the new tests cannot express the real relationship.
