# UTV2-1499 Diff Summary

MERGE_SHA: 441b6c6f40c878179e23e49935ac91e2160fe9db

## Change

Adds `docs/05_operations/RUNTIME_OPERATIONS_GOVERNANCE.md` — the minimum enforceable Runtime Operations Governance chapter. Docs-only; no runtime code, no implementation, no deploy.

## Scope

Consolidates existing, already-ratified authority from `DELEGATION_POLICY.md`, `BREAK_GLASS_PROTOCOL.md`, `INCIDENT_RUNBOOK.md`, and the `BLOCKED_EXTERNAL` SGO-outage precedent (`docs/06_status/proof/UTV2-1476/diff-summary.md`) into one lookup chapter covering: runtime authority roles, incident severity levels (SEV-1/2/3), declare/resolve authority, restart/pause/retry/replay authority, evidence requirements, and SGO/provider outage classification. No new governance program — every table row cites exactly one existing ratified source; §7 explicitly lists what is out of scope (INCIDENT_RUNBOOK's own draft ratification, break-glass's open human-backup decision, new alerting infra, the kill-switch mechanism itself).

## Files changed

- `docs/05_operations/RUNTIME_OPERATIONS_GOVERNANCE.md` (new)

## Merge order

No dependency on any other open lane. Standalone docs change.
