# PROOF: UTV2-1927

MERGE_SHA: a8fdf2c1196c4c73fb620ebd79d78f272d12d217

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-17T18:14:16.000Z
Issue: UTV2-1927
Tier: T3
Lane type: governance
Branch: claude/utv2-1927-internal-pick-approval-docs
PR URL: pending
Head SHA: 47a5866741fd1613c30dba4d32d08f5311471e55
result: pass

## ASSERTIONS:

- [x] The protocol no longer reads as though every internal pick advances through `awaiting_approval`. Purpose now states it governs system-generated and automated picks only, and Scope's "does NOT govern" list names authorized human capper submissions explicitly.
- [x] The new Applicability section grounds the rule in code rather than restating it as policy. It cites `packages/contracts/src/picks.ts` for the canonical wording ("awaiting_approval is the governance brake for non-human producers") and `apps/api/src/distribution-service.ts` for `GOVERNANCE_BRAKE_SOURCES`, which is the mechanical membership list.
- [x] The Applicability table matches the shipped set exactly. Measured, not read: `isGovernanceBrakeSource()` returns true for `system-pick-scanner`, `alert-agent`, `model-driven` and `board-construction`, and false for `smart-form` and `manual`. The set enumerates those four and nothing else.
- [x] Rule 1 — approval is reserved for system-generated and automated picks — is true of the code as written: the brake is keyed on `source` alone, and `automated-write-boundary.ts` asserts at module load that every source it classifies as automated is a member, so the two mechanisms cannot drift apart silently.
- [x] Rule 2 — delivery eligibility is not a reason to require approval — states a prohibition the FSM makes consequential: `awaiting_approval` admits only `queued` and `voided` as exits (`pickLifecycleTransitions`), so parking an ungoverned pick there is not a neutral act.
- [x] Rule 3 — a fail-closed delivery refusal is not "awaiting approval" — adds no gate. It forbids one reinterpretation of an existing refusal.
- [x] The Delivery Isolation Guarantee's governance-brake bullet no longer generalizes the brake to all autonomous advancement. It now names the source set it actually keys on and states that an authorized human capper's submission never enters that state.
- [x] Documentation only. The branch diff is the protocol document plus this lane's own control-plane and proof artifacts. No code file, no contract, no workflow, no gate, no schema is touched.
- [x] No new readiness threshold, approval artifact, lane type or CI check is introduced. Version bumped 1.0 -> 1.1; Status stays Active.

## EVIDENCE:

```
$ pnpm type-check
exit 0

$ pnpm lint
exit 0

$ pnpm test
exit 0 — 5826 ok / 0 not ok

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 4
Rules matched: (none) — no R-level artifacts required for this diff
exit 0

$ git diff --name-status origin/main..HEAD
A	.ops/sync/UTV2-1927.yml
M	docs/05_operations/INTERNAL_PICK_APPROVAL_PROTOCOL.md
A	docs/06_status/lanes/UTV2-1927.json
A	docs/06_status/proof/UTV2-1927/**

$ brake membership, evaluated against the shipped module
smart-form: brake=false
manual: brake=false
model-driven: brake=true
board-construction: brake=true
system-pick-scanner: brake=true
alert-agent: brake=true
set: alert-agent, board-construction, model-driven, system-pick-scanner
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm lint`: exit 0
- [x] `pnpm test`: exit 0, 5826 ok / 0 not ok
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no R-level artifacts required
- [ ] `pnpm verify`: cannot exit 0 in a lane worktree — `ci:assert-staging-target` refuses outside the `staging-ci` environment. The authoritative run is the `verify` check on this PR.

## Runtime Verification

Not applicable. This lane changes one Markdown document and touches no runtime path, so there is no
runtime behaviour to measure. The claims the document makes about runtime behaviour were verified
against the shipped modules and are recorded in the EVIDENCE block above; the document asserts
nothing that the code does not already do.

## Merge SHA Binding

Merge SHA: a8fdf2c1196c4c73fb620ebd79d78f272d12d217
PR: https://github.com/griff843/Unit-Talk-v2/pull/1597
Approved PR head: 51fb5099bb5ca5ff48b36d669c4ac9074550ecb5
Execution SHA: 47a5866741fd1613c30dba4d32d08f5311471e55
