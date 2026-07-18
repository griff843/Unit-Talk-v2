# UTV2-1506 pre-merge proof

SOURCE_SHA: `b2994b8116e54473dd67d23d40294c474833a228`
MERGE_SHA: `b2994b8116e54473dd67d23d40294c474833a228`
PR: #1231
Generated: 2026-07-16T05:30:18Z

Rebound from the stale pre-merge SHA (`6153af325f228b0679b91abdb3b35c4bf9a03d9b`)
to the authoritative merge SHA during post-merge lane-close reconciliation.
Runtime proof below now also carries canonical `queries[]`/`row_counts[]`
detail in `evidence.json` (previously present only as a pass/fail summary).

## Summary

This proof covers the documentation-only repair to the runtime reliability charter. It proves repository gates and the narrow acceptance criteria below; it does not certify owner approval, ratification, runtime deployment, production mutation, or merge readiness.

## Evidence

- Diagnostic capture is now explicitly recommended operating guidance, not a mandatory logging obligation or third evidence form.
- The incident declaration artifact and T1 evidence bundle remain the only two ratified evidence forms. Linear comments and chat cannot substitute for either.
- Missing restart pre/post capture is classified as evidence-incomplete. The charter no longer independently declares such a restart unauthorized.
- Restart authority remains governed by `RUNTIME_OPERATIONS_GOVERNANCE.md` §4.
- `INCIDENT_RUNBOOK.md` remains DRAFT; this lane neither edits nor ratifies it.
- `reviewer_verdict` and `pm_verdict` remain null. This implementation/proof packet is not independent review or Griff approval.

## Verification

Substantive revision verified: `b2994b8116e54473dd67d23d40294c474833a228`

### `pnpm verify`

Full gate completed with exit code 0, including static validation, lint, type-check, build, unit tests, smart-form verification, command verification, live DB smoke, and the live T1 proof suite.

### `pnpm test:db`

```text
TAP version 13
1..7
# tests 7
# pass 7
# fail 0
# skipped 0
# duration_ms 114773.293835
```

### R-level compliance

Command: `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

```text
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

## Runtime Verification

The changed behavior is governance text only. No runtime path, database implementation, migration, deployment, paging mechanism, or monitoring workflow changed. Runtime applicability is therefore limited to confirming that the full mandatory T1 live checks remained green; `pnpm verify` ran DB smoke 7/7 and the live T1 proof suite successfully. No production mutation was performed by this repair beyond the repository's governed, non-destructive verification tests.

## Acceptance criteria mapping

| Criterion | Result |
|---|---|
| Universal diagnostic logging is recommended and non-authoritative | PASS |
| Guidance is subordinate to the two ratified evidence forms | PASS |
| Missing restart capture is evidence-incomplete, not independently unauthorized | PASS |
| DRAFT runbook boundary is preserved | PASS |
| No owner approval or independent-review identity is claimed | PASS |

## Owner boundary

PR #1231 remains T1 and requires Griff's independent owner action through the existing constitutional artifacts. This proof supplies no `t1-approved` label, no `pm-verdict/v1`, no review approval, and no merge authorization.
