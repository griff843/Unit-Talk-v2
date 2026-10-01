# PROOF: WORK-20260929

MERGE_SHA: pending merge

Issue: WORK-20260929
Tier: T1
Result: static_pass_ci_db_pending

## Assertions

- [x] `pnpm ops:brief -- --static` selects the local-only brief and does not
  build GitHub, Linear, runtime, pipeline, product-truth, DB, or other live
  sections.
- [x] A lane touching `apps/worker/**` receives scanner-quiescence guidance,
  the stranded/`awaiting_approval` warning, and the prohibition on mutating
  existing stranded rows.
- [x] Missing, renamed, or duplicate requested brief sections return the full
  source brief instead of a partial scoped brief.
- [x] Current-main preflight recovery remains intact: the candidate and
  `origin/main` have identical blobs for `scripts/ops/lane-link-pr.ts` and
  `scripts/ops/lane-link-pr.test.ts`.
- [x] The exact implementation source preserves material context reduction
  without removing the required safety sections.

## Measurements

Measured against `origin/main` at
`cdca09a4ccc64d295b79474413139323c486e5fe`, with candidate source
`c4a930972604c60b6a0e34d9087b2a4311b5c629`:

| Surface | Before | After | Reduction |
|---|---:|---:|---:|
| `AGENTS.md` bytes | 17,009 | 6,682 | 60.7% |
| Ordinary scoped brief bytes (sections 11, 13, 16) | 15,830 | 2,270 | 85.7% |
| Ordinary scoped brief words | 2,200 | 368 | 83.3% |
| Combined routine context bytes | 32,839 | 8,952 | 72.7% |

These are context-size measurements, not a claim of equivalent total
token-spend savings.

## Verification

- Focused agent-tooling, routing, execution-packet, executor, workflow, and
  lane-manifest suite — PASS, 302 tests, 0 failed.
- `pnpm verify:static` — PASS (exit 0): DB-client boundary, sync/alignment,
  automation coverage, env, lint, type-check, build, repository tests,
  production-post-migration static tests, Smart Form verification, command
  manifest, and migration checks.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`
  — PASS; 42 changed files at the verified source, no R-level rules matched.
- The authoritative git-backed file-scope guard — PASS; no scope violations or
  active-lane conflicts.
- `pnpm test:db` — correctly REFUSED locally because the configured host is
  `127.0.0.1`, not protected staging ref `xskgrzbteyqdufktjrjx`.
- `pnpm verify` — all static phases PASS, then correctly REFUSED at the same
  staging-only identity gate. The writable DB proof must run in the protected
  staging-CI environment.

The standalone legacy `scripts/ops/scope-diff.ts` reports this lane's own
manifest/sync/proof files as bleed. The authoritative
`scripts/ci/file-scope-guard.ts` passes them via the exact-lane lifecycle
policy introduced by UTV2-1759; no lock was widened and no override was used.

## PM findings

1. Static brief path: satisfied by explicit `--static` parsing and local-only
   regression coverage.
2. Worker safety: satisfied by routed brief sections 3 and 4 and direct
   assertions for scanner quiescence, `awaiting_approval`, and row immutability.
3. Fail-safe briefing: satisfied by exact-one resolution for every requested
   section and full-source fallback coverage for lane-specific heading drift.

## Merge SHA binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1695
Execution SHA: c4a930972604c60b6a0e34d9087b2a4311b5c629
