# PROOF: UTV2-1647
MERGE_SHA: 75280b8b96ddf9671f510e5c2fe28b1bf81cad82

Generated at: 2026-08-02T00:57:25Z
Issue: UTV2-1647
Tier: T2
Lane type: governance
Branch: codex/utv2-1647-ci-db-proof-harvest-fix
Implementation SHA: eda33086ad2ff4415cc64facf58c3445619c67b5

ASSERTIONS:
- [x] Root-caused why `locateCiDbProofRun` missed a CI run that genuinely existed for the exact head SHA (repository-wide `per_page=20` endpoint truncated before reaching item 21/25)
- [x] Fixed via the workflow-scoped `ci.yml` runs endpoint, with a bounded `per_page=100` repository-wide fallback only if that call itself fails
- [x] Regression fixture uses the real UTV2-1646/PR #1356 case (exact merge SHA, head SHA, run ID, job ID)
- [x] 26/26 focused tests, 74/74 integration tests, `pnpm type-check` clean, R-level PASS
- [x] A regression the fix caused in the out-of-scope `proof-generate.test.ts` was resolved via a bounded compatibility fallback inside the authorized file, not by editing the out-of-scope test

EVIDENCE:
```text
See "Issue-Specific Evidence" and "Root Test Evidence" sections below for the
full pnpm test / focused-suite / R-level output this proof is bound to.
```

## Verification

| Command | Result |
|---|---|
| `pnpm type-check` | PASS — exit 0 |
| `pnpm test` | PASS — exit 0 after the compatibility fallback was added |
| `npx tsx --test scripts/ops/ci-db-proof-harvest.test.ts` | PASS — 26 tests, 0 failures |
| `npx tsx --test scripts/ops/proof-generate.test.ts` | PASS — 74 tests, 0 failures |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS — no rules matched |
| `pnpm verify` | STATIC PASS; live-DB tail refused local target as designed |

## Issue-Specific Evidence

```text
# Subtest: locateCiDbProofRun: UTV2-1646 regression queries ci.yml directly when CI is item 21 of 25 repository-wide runs
ok 14 - locateCiDbProofRun: UTV2-1646 regression queries ci.yml directly when CI is item 21 of 25 repository-wide runs

# Subtest: locateCiDbProofRun: falls back to a 100-run repository page when the workflow-specific endpoint is unavailable
ok 15 - locateCiDbProofRun: falls back to a 100-run repository page when the workflow-specific endpoint is unavailable

1..26
# tests 26
# pass 26
# fail 0
```

The proof-generation integration suite also passed all 74 tests, including the three auto-harvest integration cases that initially exposed compatibility with the older injected executor.

## Root Test Evidence

`pnpm test` completed with exit code 0 after the focused and integration corrections. Its final suite reported:

```text
1..19
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## R-Level Compliance

```text
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

## Full Verify Environment Boundary

The local `pnpm verify` invocation completed `verify:static` successfully, including environment checks, lint, type-check, build, root tests, smart-form verification, and command/migration checks. Its final `test:live-db` phase was not runnable locally because no protected `CI_SUPABASE_*` credentials are available. The mandatory staging guard refused the local URL before any DB client or write:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

This is an environment-enforced deferral, not a test failure in the changed code. The authoritative PR CI run must execute the protected staging job and pass before merge.
