# Diff summary: WORK-2026100302

Bounded control-plane correction requested by Griff. No product implementation files change.

| File | Change |
|---|---|
| .github/workflows/file-scope-lock-check.yml | Accept WORK numeric IDs alongside UTV2; reviewer authorization remains unchanged. |
| scripts/ci/scope-override-comment-parser.ts | Keep helper parser in lockstep with the workflow. |
| scripts/ci/scope-override-comment-parser.test.ts | Execute actual workflow collector; prove authorized human, malformed-ID/schema rejection, and both ID namespaces. |
| scripts/ci/file-scope-guard.test.ts | Prove WORK exact issue/PR/HEAD/two-path matching and stale merged lane lock release without bypassing active locks. |
| docs/05_operations/schemas/scope-override-v1.md | Document the two admitted namespaces, preserving all authorization requirements. |
| docs/06_status/lanes/WORK-2026100201.json | Apply generated GitHub-bound repair packet: blocked -> merged, actual PR #1709 merge SHA. No fabricated passing truth-check or done status. |
| .ops/work/WORK-2026100302.md and normal lane/proof metadata | Declare bounded authority, measured proof, and preserve the original repair packet. |

## Activation Boundary

This T1 control correction must merge through normal repository controls before
the external PR #1711 override is registered. PR #1711 product implementation remains untouched.
The override is limited to UnitTalkLogo.tsx and extraction-only WorkspaceSidebar.tsx,
bound to the current exact HEAD at posting time; it grants no merge approval.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1712
