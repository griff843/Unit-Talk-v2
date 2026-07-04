# UTV2-1461 Diff Summary

Issue: UTV2-1461
Tier: T2
Branch: claude/utv2-1461-merge-queue-decision-packet

## Summary

- Adds `docs/05_operations/UTV2-1461-merge-queue-decision-packet.md` — the merge-queue decision packet covering all five required sections: (1) native merge-queue availability verified against the live GitHub API, (2) Design A required-context/`merge_group` mapping and merge-wrapper interaction, (3) Design B batched-merge protocol, (4) preflight-token and executor-result SHA-re-post impact under each design, (5) explicit recommendation with rollout and rollback.
- Key finding: the `merge_queue` rule type is rejected (HTTP 422) on this user-owned repository even in a disabled-enforcement probe ruleset — native merge queue requires an organization transfer, making Design B the only immediately adoptable option.
- Docs-only lane: no code, workflow, or configuration changes.

## Scope

- docs/05_operations/UTV2-1461-merge-queue-decision-packet.md (new)
- docs/06_status/lanes/UTV2-1461.json (lane manifest)
- docs/06_status/proof/UTV2-1461/ (this proof bundle)

## R-Level

`scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS — docs-only diff matches no R1–R5 runtime rules.

Merge SHA: 57452722868109bc00833825a32f2bd880bc57ba
