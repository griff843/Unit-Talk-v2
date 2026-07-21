# PROOF: UTV2-1503

MERGE_SHA: acd1228414f60bf0528294f642137b40394daf01

(This is the substantive audit-repair content commit, an ancestor of this
branch's actual head -- a file cannot bind its own future hash once
further proof-doc commits land on top of it, per this repo's established
convention.)

## Summary

The audit repair at substantive commit `acd1228414f60bf0528294f642137b40394daf01` passed the repository gate and the separately required live database smoke. This proof is mechanical executor evidence only. It is not independent Griff review, `t1-approved`, a `pm-verdict/v1`, or merge authorization.

## ASSERTIONS:

- [x] Corrected the observed-facts claim about `governance.yml`'s `forbidden_path_globs` (three entries, not one)
- [x] Swapped the governance-critical-path list's reference from the retired `proof-auditor-gate.yml` to the active `proof-gate.yml`
- [x] Both Codex P2 review threads resolved
- [x] `pnpm verify` PASS (full suite, including live-DB smoke and live T1 proof)
- [x] `pnpm test:db` PASS (7/7, live Supabase)
- [x] R-level check PASS, no artifacts required for this diff

## Codex P2 fixes (this revision)

- Corrected the observed-facts claim that `governance.yml`'s `forbidden_path_globs` contains only `supabase/migrations/**` — it actually has three entries (`supabase/migrations/**`, `database/migrations/**`, `packages/**/database.types.ts`).
- Swapped the recommended governance-critical-path list's `proof-auditor-gate.yml` reference (disabled to `workflow_dispatch` only) for `proof-gate.yml` (the active, PR-triggered consolidated Proof Gate) — the list as originally written would have protected a retired workflow name while leaving the active gate editable.
- Both Codex P2 review threads resolved after this commit landed.

## EVIDENCE:

- PR: https://github.com/griff843/Unit-Talk-v2/pull/1232
- Substantive source SHA: `acd1228414f60bf0528294f642137b40394daf01`
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

Result: PASS, exit code 0. The command completed sync checks, system alignment, automation coverage, environment validation, lint, type-check, build, all unit/command suites, live DB smoke, and live T1 proof execution. The live T1 suite reported one explicit skip for UTV2-1282 because the most recent provider-offer row was outside its 72-hour lookback; the command classified that as stale provider data and exited 0.

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
# duration_ms 111734.356398
```

The smoke ran against Supabase project `zfzdnfwdarxucxtaojxm` and used the repository/service paths already defined by the suite. Test-created submission and pick records are cleaned up by the tests. This documentation-only repair performs no separate production mutation.

### R-level compliance

Command executed:

```text
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```

Result:

```text
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

### Owner boundary

Mechanical checks passing does not approve this T1 PR. Griff must review the final head and independently supply both required owner artifacts before merge. This lane did not create either artifact and did not review, approve, label, or merge the PR.
