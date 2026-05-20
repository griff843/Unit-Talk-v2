# Diff Summary — UTV2-1077

**Merge SHA:** `2cec59c62f94c3f0d24d21fc5933b056007116d1`

**Issue:** UTV2-1077 — Add generate-preflight-token script for Claude-executed lanes
**Tier:** T2
**Branch:** codex/utv2-1077-generate-preflight-token-script

## Files Changed

- `scripts/ops/generate-preflight-token.ts` (new file — 268 lines)

## Summary

Created `scripts/ops/generate-preflight-token.ts`, a standalone CLI tool that generates preflight tokens for Claude-executed lanes. The script:

1. Accepts `--issue UTV2-###`, `--tier T1|T2|T3`, and `--branch <branch>` arguments
2. Reads git HEAD SHA via `currentHeadSha()` from `shared.ts`
3. Validates three preflight conditions:
   - **git**: working tree is clean (no dirty files)
   - **env**: env file exists and GITHUB_TOKEN is present
   - **deps**: pnpm-lock.yaml and node_modules are present
4. Constructs a `PreflightToken` using the interface from `scripts/ops/shared.ts` (not duplicated)
5. Writes to `.out/ops/preflight/claude/<branch-slug>.json`

Key design decisions:
- Reuses `PreflightToken` interface from `shared.ts` as required (no duplication)
- Handles worktree execution: env/dep checks look in both the worktree root and main checkout root (via `git rev-parse --git-common-dir`)
- TTL follows the same convention as `preflight.ts`: 15 min for T1, 30 min for T2, 60 min for T3
- Idempotent: reuses valid existing token unless `--force` is passed
- Fail-closed: exits 1 on check failure, 2 on bad args, 3 on infra error
- Output is JSON to stdout (same pattern as other ops scripts)

## Scope Compliance

File scope lock: `scripts/ops/generate-preflight-token.ts` — exactly one file touched.
