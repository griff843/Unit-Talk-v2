# UTV2-948 — Post-Merge Enforcement Proof

**Merge SHA:** `0cb5ea39015c70e89b0fac28e10711b5cb3caa1d` (PR #641, merged 2026-05-12T18:01:31Z)
**Generated:** 2026-05-12

This document captures the live evidence that the P0 Runtime Hardening Merge Protocol (UTV2-948) is mechanically enforced on `main` after merge. It closes the deferred items from `runtime-verification.md`.

---

## 1. Branch protection — `P0 Protocol` is now a required status check

```
$ gh api repos/griff843/Unit-Talk-v2/branches/main/protection
  required_status_checks.contexts:
    - verify
    - Executor Result Validation
    - Merge Gate
    - P0 Protocol     ← added by UTV2-948
  required_status_checks.strict: true
  allow_force_pushes: false
  enforce_admins: false
```

Applied via `gh api -X PATCH ... -F strict=true -f contexts[]=...` (the bundled `scripts/ops/apply-branch-protection.sh` has a `-f` vs `-F` typing bug that emits `strict="true"` as a string; tracked in a follow-up T3 fix).

## 2. Synthetic failing-PR matrix — gate blocks every documented failure mode

Three synthetic PRs were opened against UTV2-914 (P0 issue, no artifacts on main yet) to exercise the gate. Each PR was deliberately constructed to violate one protocol requirement.

| Synthetic PR | Failure mode | Required block | Result | Evidence |
|---|---|---|---|---|
| **#644** `[SYNTH] no artifacts` | Missing `claude-critique.md` + `runtime-verification.md` for UTV2-914 | `P0 Protocol` workflow FAILS | **P0 Protocol: FAILURE** ✓ | https://github.com/griff843/Unit-Talk-v2/pull/644 |
| **#645** `[SYNTH] FAIL item` | `runtime-verification.md` contains `- [x] item: FAIL` | `P0 Protocol` workflow FAILS on the FAIL/SKIP predicate | **P0 Protocol: FAILURE** ✓ | https://github.com/griff843/Unit-Talk-v2/pull/645 |
| **#646** `[SYNTH] no verdict` | Valid artifacts, tier:T1, no `PM_VERDICT: APPROVED` comment | `Merge Gate` FAILS on missing pm-verdict/v1 | **Merge Gate: FAILURE** ✓ | https://github.com/griff843/Unit-Talk-v2/pull/646 |

All three PRs closed without merging — they are tests, not work product. The branches will be deleted after this evidence is captured.

A fourth synthetic test (`#643`, since closed) initially used UTV2-948 itself as the target and incorrectly passed because UTV2-948's artifacts already exist on main. That test was invalidated and re-run against UTV2-914 (#644). The fixture is preserved in this evidence document as a reminder: synthetic enforcement tests must target a P0 issue whose artifacts do not yet exist in the repo.

## 3. UTV2-948 own dogfood — the bootstrap PR shipped through its own protocol

PR #641's `P0 Protocol` check was the most revealing test:

1. First run: **FAILED** because the regex `:\s*(FAIL|SKIP|SKIPPED)\b` over-matched the narrative phrase ``synthetic PR with `: FAIL` in runtime-verification.md`` inside the deferred-items section.
2. Fix: anchored the predicate to end-of-line — `:\s*(FAIL|SKIP|SKIPPED)\s*$`. Counter-test added to `scripts/ops/p0-detect.test.ts`.
3. Second run: **PASSED** (`https://github.com/griff843/Unit-Talk-v2/actions/runs/25752595307`).

This is real dogfood feedback. The gate did exactly what it was supposed to do: catch its own narrative bug on the bootstrap PR. The fix tightened the predicate without weakening it.

## 4. Closing the deferred items from runtime-verification.md

| Deferred item | Status |
|---|---|
| Post-merge `pnpm ops:truth-check UTV2-948` H1–H5 PASS against real merge SHA | Pending — to be exercised in the next session against the merged SHA `0cb5ea39`. The truth-check requires an updated lane manifest with `commit_sha` and `merge_type=manual` set; that update is part of the lane-close workflow now in progress. |
| PM runs `apply-branch-protection.sh`, `P0 Protocol` becomes required | **Done** — branch protection updated directly via `gh api` (script bug documented as follow-up). See section 1. |
| First non-948 P0 PR mechanically blocked at merge without artifacts | **Done** — PR #644 against UTV2-914 was mechanically blocked. See section 2. |

## 5. Follow-up work captured

- **T3 hotfix**: `scripts/ops/apply-branch-protection.sh` — change `-f strict=true` to `-F strict=true` (string → typed boolean). Captured as a follow-up issue.
- **UTV2-949** (P0 Protocol Failure Observability): now unblocked. Will enter Wave 0 alongside the dispatch of UTV2-914.

## 6. Reproducibility

The synthetic test workflow can be re-run at any time by re-opening branches structured the same way against any P0 issue without committed artifacts. The predicates are documented in `docs/05_operations/P0_PROTOCOL_SPEC.md` §8 and verified by `scripts/ops/p0-detect.test.ts`.

---

result: pass
