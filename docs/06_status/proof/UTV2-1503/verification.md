# PROOF: UTV2-1503

MERGE_SHA: 5aa66f6c6d4aac16288f450b9cfcf4be094c1c9b

(This is the substantive audit-content commit on the fresh continuation
branch, an ancestor of this branch's actual head -- a file cannot bind
its own future hash once further proof-doc commits land on top of it,
per this repo's established convention.)

## Summary

This is a clean continuation lane for UTV2-1503. A prior PR for this
issue reached PM `APPROVED` on its final exact head, but exceeded the
T1 `CHANGES_REQUIRED` bounce limit (4), which the protected-base Merge
Gate correctly rejects regardless of verdict. Per PM triage direction,
the already-reviewed five-file result (lane manifest, sync metadata,
audit doc, evidence, verification) is carried forward on a fresh
branch cut from current `main`, with no additional scope. This proof
is mechanical executor evidence only. It is not independent Griff
review, `t1-approved`, a `pm-verdict/v1`, or merge authorization.

## ASSERTIONS:

- [x] Audit doc (`docs/06_status/audits/UTV2-1503-orchestrator-standing-authority-narrowing.md`) carried forward byte-for-byte from the prior PR's approved final head -- confirmed via `diff` against that head's content, no differences
- [x] Independently re-verified every factual claim in the audit against current `main` before finalizing: `.lane/lanes/governance.yml`'s `forbidden_path_globs` (still exactly three entries), the active consolidated `proof-gate.yml` workflow (still replaces the disabled-to-`workflow_dispatch`-only `proof-auditor-gate.yml`), cited line numbers in `scripts/ci/r-level-check.ts` (256), `scripts/ops/truth-check-lib.ts` (243-284), and `scripts/ops/apply-branch-protection.sh` (33-38), `docs_authority_map.md`'s ownership rows for `r1-r5-rules.json`/`LANE_MANIFEST_SPEC.md`/`TRUTH_CHECK_SPEC.md` (Program Owner) and `EXECUTION_TRUTH_MODEL.md` (still absent by name), the live branch-protection snapshot (`required_status_checks.contexts = ["verify", "Executor Result Validation", "Merge Gate", "P0 Protocol"]`, `enforce_admins=false`, no required approving review count), and `STANDING_GUARDRAILS.md`'s single live guardrail (2026-07-07, UTV2-1432) -- no drift found, no content changes required
- [x] `pnpm verify` PASS (full suite, including live-DB smoke and live T1 proof), run on this exact branch after a fresh `pnpm install` in an isolated worktree
- [x] `pnpm test:db` PASS (7/7, live Supabase, standalone run)
- [x] R-level check PASS, no artifacts required for this diff

## EVIDENCE:

- Substantive source SHA: `5aa66f6c6d4aac16288f450b9cfcf4be094c1c9b`
- Changed behavior: none; the lane remains an analysis-only governance audit.
- Corrected authority model: lane allowlists establish path eligibility, while the Delegation Policy and tier gates establish execution, review, and merge authority.
- Preserved T1 gate: both `t1-approved` and a valid Griff-authored, reviewed-head-bound `pm-verdict/v1` APPROVED artifact remain mandatory.
- Identity boundary: shared Griff/Claude account provenance and executor output are explicitly non-independent.

## Verification

### Full repository gate

Command executed:

```text
pnpm verify
```

Result: PASS, exit code 0 (confirmed twice). The command completed sync checks, system alignment, automation coverage, environment validation, lint, type-check, build, all unit/command suites, live DB smoke, and live T1 proof execution.

### Standalone live database smoke

Command executed:

```text
pnpm test:db
```

Terminal summary:

```text
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 97676.813748
```

The smoke ran against Supabase project `zfzdnfwdarxucxtaojxm` and used the repository/service paths already defined by the suite. Test-created submission and pick records are cleaned up by the tests. This documentation-only lane performs no separate production mutation.

### R-level compliance

Command executed:

```text
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```

Result:

```text
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```

### Owner boundary

Mechanical checks passing does not approve this T1 PR. Griff must review the final head and independently supply both required owner artifacts before merge. This lane did not create either artifact and did not review, approve, label, or merge the PR.
