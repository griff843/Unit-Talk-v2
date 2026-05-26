# UTV2-1174 Diff Summary

Generated at: 2026-05-26T13:08:00Z
Issue: UTV2-1174
Tier: T2
Lane type: governance
Branch: claude/utv2-1174-map-prompt-agents-authority
Head SHA: 1f150039f0221e20ed55ae491e9f0baf899d891d
Merge SHA: cc909e8f0742d64898eb3cf31bab6fe61efcdbe2

## Summary

- Added missing `agent-role-contracts.md` entries for `ci-triage`, `lane-governor`, `proof-auditor`, and `runtime-verifier`.
- Corrected `codex-return-reviewer` and `pr-risk-reviewer` authority language from blocking/conditional-blocking claims to advisory-only, with CI/Merge Gate/PM policy named as blocking authorities.
- Expanded the ownership map and lane-type responsibility table to cover all eight Claude prompt agents.
- Merged current `main` into the Claude branch and resolved the `.ops/sync/UTV2-1174.yml` metadata conflict by preserving the required proof artifact list.

## Files Changed

- `docs/05_operations/agent-role-contracts.md` - maps prompt agents to authority, trigger, artifact, CI enforcement, ownership, and lane-type usage.
- `.ops/sync/UTV2-1174.yml` - records the issue and required proof artifacts.
- `docs/06_status/proof/UTV2-1174/diff-summary.md` - records this change summary.
- `docs/06_status/proof/UTV2-1174/verification.log` - records focused verification evidence.
- `docs/06_status/proof/UTV2-1174/runtime-verification.md` - records markdown runtime-verifier evidence for the CI gate.

## Scope

No runtime, migration, domain, DB, worker, package, or Tier C paths were changed.
