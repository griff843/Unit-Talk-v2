# Claude Critique — UTV2-922

**Issue:** UT-P0-009 Make CI Truthful
**Branch:** codex/utv2-922-truthful-ci
**Merge SHA:** (pending merge)
**Critic:** Claude Sonnet 4.6 (orchestrator)
**Date:** 2026-05-13

---

## Invariant Correctness

This PR replaces the previous CI workflow structure (separate lint/type-check/build/test steps, empty Supabase credentials) with a consolidated `pnpm verify` step and a new `pnpm ci:db-smoke` step backed by `scripts/ci/required-db-smoke.ts`. It also injects real Supabase credentials from GitHub secrets into the CI env file.

### `required-db-smoke.ts` Logic

- **`isDbSmokeRequired(env)`**: Returns true when `CI_REQUIRE_DB_SMOKE` is truthy OR `GITHUB_REF_PROTECTED` is truthy OR `GITHUB_REF === 'refs/heads/main'`. The `refs/heads/main` check is reliable and sufficient. The `GITHUB_REF_PROTECTED` path depends on the env var being explicitly set (it is, via `github.ref_protected` in ci.yml).
- **`hasSupabaseSmokeCredentials(env)`**: All three required keys must be non-empty. Correct.
- **`evaluateDbSmokeResult(input)`**: Three failure modes: (1) required+no credentials → fail, (2) non-zero exit code → fail, (3) required+skipped-output → fail. Correct. Skip is allowed only when credentials are absent AND not required.
- **`detectDbSmokeSkipped(output)`**: Regex matches both the test-runner skip count summary and the smoke credential skip message. Correct.
- **`main()` early exit**: If required+no credentials, exits immediately without running `pnpm test:db`. Correct — avoids hanging on a missing credential.

### ESM Guard

`if (process.argv[1]?.replace(/\\/g, '/').endsWith('/required-db-smoke.ts'))` — correctly gates `main()` invocation to direct CLI execution, not import. Cross-platform path normalization (backslash→slash) handles Windows worktree paths.

### CI Workflow Changes

- Supabase credentials now come from `${{ secrets.SUPABASE_URL }}` etc. — previously empty strings. This is the key change that makes `pnpm test:db` actually runnable in CI.
- `pnpm verify` replaces separate lint/type-check/build/test steps. `pnpm verify` already runs all four in sequence; deduplication is correct.
- `CI_REQUIRE_DB_SMOKE: ${{ github.ref_protected || github.ref == 'refs/heads/main' }}` — `github.ref_protected` is a valid GitHub Actions context property (not a custom env var). The expression evaluates to `true`/`false` string. `truthy('true')` passes in `isDbSmokeRequired`. Correct.
- `pnpm test:command-center` added as explicit step — Command Center previously ran inside `pnpm test` but is now surfaced separately for per-step reporting. Correct, additive.
- CI truth summary step (`if: always()`) logs all step outcomes. Additive observability.

## Finding: `GITHUB_REF_PROTECTED` env var naming inconsistency

The `isDbSmokeRequired()` function checks `env['GITHUB_REF_PROTECTED']`, but the CI workflow sets `CI_REQUIRE_DB_SMOKE: ${{ github.ref_protected || ... }}`. The `GITHUB_REF_PROTECTED` env var path in `isDbSmokeRequired` is therefore only reachable if someone explicitly sets that env var externally. In practice, the CI uses `CI_REQUIRE_DB_SMOKE` exclusively. The dead `GITHUB_REF_PROTECTED` branch is not harmful — it is a forward-compatibility hook — but it creates a confusing code path that suggests the var is set automatically (it is not).

## Scope Assessment

Changed files on top of UTV2-918 base: `.github/workflows/ci.yml`, `scripts/ci/required-db-smoke.ts`, `scripts/ci/required-db-smoke.test.ts`, `apps/command-center/package.json` (minor), root `package.json` (`ci:db-smoke` script). Within scope for a CI truthfulness issue.

## Test Coverage

6 tests in `required-db-smoke.test.ts` cover: env parsing, credential detection, required detection, skip detection, and all evaluation branches (required+no-creds fail, required+skipped fail, optional+skipped ok, required+passed ok). Full path coverage. Correct.

## Verdict

**APPROVE**

The implementation correctly gates DB smoke execution on protected/main refs and fails CI when credentials are absent but required. The `pnpm verify` consolidation reduces CI step fragmentation without losing coverage. One finding: `GITHUB_REF_PROTECTED` env var path in `isDbSmokeRequired` is dead in practice (CI uses `CI_REQUIRE_DB_SMOKE`) — harmless but worth a comment. All 6 tests pass.

`pnpm verify` 113/0 pass (via UTV2-918 base).
