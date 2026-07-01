# UTV2-1392 — ops:proof-generate merge-SHA rebinding

## Verification

This file is the T3 verification record for UTV2-1392.

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-1392 |
| Tier | T3 |
| Owner | claude/utv2-1392 |
| Date | 2026-07-01 |
| Verifier Identity | claude/utv2-1392-proof-generate-sha-rebind |
| Commit SHA(s) | `6a1c326d02780020e6e9a1fc97b62683d0dcc230` (merge SHA) |

## Scope

**Claims:**
- `ops:proof-generate --merge-sha` now rebinds `evidence.json`'s `sha_binding` fields and `verification.md`'s `Commit SHA(s)`/`Merge SHA Binding` sections, not just `diff-summary.md`/`runtime-verification.md`
- Rebind is idempotent and additive — only `sha_binding` fields (and `status`, only when it was a known pre-merge value) are touched; all other evidence content is preserved byte-for-byte
- Files that don't exist for a given lane (e.g. T3 lanes) are silently skipped, not errored
- No change to product/runtime code, `ops:lane-close`, `ops:truth-check`, or the `post-merge-lane-close.yml` workflow contract

**Does NOT claim:**
- Any change to what `ops:truth-check` checks for, or any weakening of the C4/P3 SHA-binding requirement
- A bypass of `ops:lane-close`'s truth-check gate — this makes the existing gate pass for the right reason (real SHA binding), not skip it

## Assertions

| # | Assertion | Evidence Type | Result |
|---|---|---|---|
| 1 | `rebindEvidenceJsonSha` rewrites `sha_binding` to the merge SHA and flips pre-merge status, preserving all other fields | test | PASS |
| 2 | `rebindEvidenceJsonSha` is idempotent | test | PASS |
| 3 | `rebindEvidenceJsonSha` reports `missing` without creating a file | test | PASS |
| 4 | `rebindEvidenceJsonSha` leaves non-evidence JSON (no `sha_binding`) untouched | test | PASS |
| 5 | `rebindVerificationMdSha` rewrites the Commit SHA(s) row and Merge SHA Binding section without corrupting surrounding content | test | PASS |
| 6 | `rebindVerificationMdSha` is idempotent | test | PASS |
| 7 | `rebindVerificationMdSha` leaves files with no matching sections untouched | test | PASS |
| 8 | `rebindMergeSha` is a no-op without a merge SHA | test | PASS |
| 9 | `rebindMergeSha` reports `missing` for T3-style lanes with neither file | test | PASS |
| 10 | `generateProofArtifacts` rebinds both files end-to-end when a merge SHA is present | test | PASS |
| 11 | `generateProofArtifacts` does not fail for lanes without evidence.json/verification.md | test | PASS |
| 12 | Full round-trip is idempotent (second `generateProofArtifacts` run reports `unchanged`) | test | PASS |
| 13 | pnpm verify green (lint, type-check, build, full test suite) | repo-truth | PASS |
| 14 | R-level check PASS — no rules matched (ops-tooling-only diff) | repo-truth | PASS |
| 15 | Live simulation: pre-merge evidence.json/verification.md + `ops:proof-generate --merge-sha` alone (no manual edit) → `evaluateCloseoutTruthGate`'s C4 (SHA binding) passes | runtime | PASS — see E4 below |

## Evidence Blocks

### E1 pnpm verify

Full pipeline green: env:check, lint, `pnpm type-check`, build, `pnpm test` (full workspace suite, including the 11 new tests in `proof-generate.test.ts`).

### E2 pnpm test:db

This lane makes no runtime/DB code change (`scripts/ops/proof-generate.ts` only edits proof markdown/JSON files on disk — no Supabase access), but `pnpm test:db` is included per the mechanical proof-auditor-gate requirement.

Command: `pnpm test:db` (live Supabase `zfzdnfwdarxucxtaojxm`)
```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 111671.122483
```

### E3 R-level check

`scripts/ci/r-level-check.ts --base origin/main --head HEAD`:
```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### E4 Live simulation — no manual edit required (acceptance criterion)

Simulated a real merged T2 lane (`UTV2-9001` — scratch, not a real issue) with pre-merge `evidence.json` (`sha_type: "branch_head"`, `status: "in_review"`) and `verification.md` (placeholder Commit SHA row + `(Filled post-merge by post-merge-lane-close.yml)`), matching the exact shape every T1/T2 lane in this repo has used pre-merge this session.

Ran `generateProofArtifacts()` (the same function `ops:proof-generate --merge-sha` invokes) once, then fed the resulting files straight into `evaluateCloseoutTruthGate()` (the real `ops:lane-close`/`ops:truth-check` C1-C4 logic) with no manual edit in between:

```
proof-generate result:
  updated_paths: [evidence.json, verification.md]
  stale_paths_replaced: [evidence.json, verification.md]

truth-check results:
  C1 pass — Linear Done merge SHA requirement satisfied
  C2 pass — manifest.commit_sha requirement satisfied
  C3 pass — PR merge SHA and manifest.commit_sha agree
  C4 pass — proof artifacts are SHA-bound or no SHA-bound proof is applicable

SMOKE TEST PASSED: C4 (SHA binding) passes after proof-generate --merge-sha alone, no manual edit.
```

`evidence.json.sha_binding.verified_source_sha` became the merge SHA, `sha_type` became `merge_sha`, `status` flipped `in_review` → `merged`; `verification.md`'s Commit SHA(s) row and Merge SHA Binding section were rewritten in place, with all other content (Sign-off section, table structure) preserved exactly. This directly answers the acceptance criterion: `post-merge-lane-close.yml`'s existing `ops:proof-generate --merge-sha` call, unchanged, now produces artifacts that pass truth-check's C4 on the first run.

## Stop Conditions Encountered

- First implementation used whole-file regex substitution for `verification.md` (`\s*$`-anchored patterns). A live idempotency test caught that greedy `\s*` before `$` silently ate an adjacent blank line, corrupting document structure on rewrite. Replaced with explicit line-array splicing, which is easier to reason about and made every test pass, including the round-trip idempotency case that first exposed the bug.

## Sign-off

**Verifier:** claude/utv2-1392-proof-generate-sha-rebind — 2026-07-01
**PM acceptance:** pending
**Status:** ready for review

## Merge SHA Binding

Merge SHA: `6a1c326d02780020e6e9a1fc97b62683d0dcc230`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1139
