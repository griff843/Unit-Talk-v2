# PROOF: UTV2-1024 — Encode T1 Pre-closure Checklist as Failing CI Gate

Implementation SHA: 00fecb8de87d465752e910164204338302849e6c

## Summary

The 7-step T1 pre-closure checklist in CLAUDE.md was prose-only — any T1 PR could
merge without mechanically proving those steps passed. This lane encodes the
checklist minimums as a failing GitHub Actions CI gate (`t1-proof-gate.yml`).

## What Was Built

**New file: `.github/workflows/t1-proof-gate.yml`**

A GitHub Actions workflow that fires on `pull_request` events where the PR has a
`tier:T1` label. It enforces the following checks:

| Check | Description | Enforcement |
|-------|-------------|-------------|
| C1 | `pnpm verify` proof | `docs/06_status/proof/<ID>/verification.md` must exist and contain "pnpm verify" |
| C2 | `pnpm test:db` proof | A file in the proof dir must reference "test:db" or "pnpm test:db" |
| C3 | R-level compliance | Informational — enforced by `r-level-compliance-check.yml` (no duplication) |
| C4 | SHA-bound proof | At least one proof file must contain a 40-char hex SHA string |
| C5 | Tier label present | Informational — enforced by `tier-label-check.yml` (no duplication) |
| C6 | Expected proof paths | All paths in `expected_proof_paths` of the lane manifest must exist |

**Fail-closed behavior:**
- Any missing required proof file → workflow fails with a clear message naming the missing file
- Missing lane manifest → workflow fails directing developer to `ops:lane-start`
- No issue ID in branch name → skipped with neutral conclusion (not all PRs are lanes)

**New file: `.ops/sync/UTV2-1024.yml`**

Sync file required by the ops:sync-check to tie this branch to issue UTV2-1024.

## Assertions

- [x] `t1-proof-gate.yml` YAML is valid (python3 yaml.safe_load passes)
- [x] C1 through C6 implemented with fail-closed semantics
- [x] C3 and C5 are informational (no duplication of existing checks)
- [x] Issue ID extracted from branch name via grep -oiE 'utv2-[0-9]+'
- [x] Missing manifest → explicit failure message with actionable instructions
- [x] `pnpm verify` exits 0 on this branch
- [x] `pnpm type-check` exits 0 (YAML only — no TS compiled)
- [x] `pnpm test` exits 0 (479 pass, 0 fail)

Merge SHA: f0472d1ee7665d6e498ef49e13c19519b1e41b8b
