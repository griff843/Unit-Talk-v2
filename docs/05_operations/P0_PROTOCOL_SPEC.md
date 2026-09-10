# P0 Runtime Hardening Merge Protocol — Specification

**Linear:** UTV2-948
**Status:** Ratified 2026-05-12
**Supersedes:** Tier-based auto-merge for any repository work classified P0.

This document is the canonical mechanical enforcement spec for the P0 merge protocol. Memory entries describe intent; this file describes how the gate is enforced.

---

## 1. What is "P0"

Repository classification is authoritative. `scripts/ops/tracker-independence/p0-classifier.cjs` is shared by CI, `ops:p0-detect` and truth-check. Its reviewed registry is `docs/governance/tracker-independence/p0-classifications.json` (`schema_version: 1`, classifications with `issue_id`, `required` and `evidence`). Legacy UTV2/UNI and new WORK identities use the same rules.

Classification is `p0`, `non_p0` or `unknown`; `is_p0` is respectively true, false or null. Historical positives include UTV2-914 through UTV2-923, UTV2-948, UTV2-949 and UTV2-953. The initial batch is not an exhaustive negative classification of every other item. Trusted-base positive evidence or a candidate positive declaration requires the protocol; a candidate cannot clear that classification by deleting or editing a field or registry entry.

A negative declaration on an unmerged candidate requires an authorized exact-head `PM_VERDICT` with schema `pm-verdict/v1`, matching work ID, PR and Head SHA, validated through the existing merge-gate verdict validator. Trusted-base negative evidence remains usable after merge. Missing or unknown classification is a blocking condition, never an implicit non-P0 result. Tracker credentials, project reads and outages do not influence classification.

Run `pnpm ops:p0-detect <WORK-ID>` before merge; existing UTV2/UNI identifiers remain compatible.

## 2. The five required steps

| Step | What it means | Enforced by |
|---|---|---|
| 1. Codex implementation | A Codex (or Claude) lane produces the diff. Recorded in lane manifest. | `lane-manifest` |
| 2. Claude critique | Claude independently reviews the diff for invariants, regressions, scope drift, hidden coupling. Written to `docs/06_status/proof/<UTV2-###>/claude-critique.md`. | `P0 Protocol` workflow + truth-check H2 |
| 3. Human PM approval | CODEOWNERS member posts a `pm-verdict/v1 APPROVED` comment on the PR. | Merge Gate workflow + truth-check H4 |
| 4. Runtime verification | Real runtime checks (DB smoke for DB work, auth flow exercised, etc.) recorded in `docs/06_status/proof/<UTV2-###>/runtime-verification.md` with `result: pass` and no FAIL/SKIP items. | `P0 Protocol` workflow + truth-check H3 |
| 5. No auto-merge | The PR is merged manually by PM; orchestrator must not auto-merge. | Branch protection + dispatch-board skill + truth-check H5 |

## 3. Required artifacts

For every P0 PR, the following files must exist in the PR diff and be present at the merge SHA:

### `docs/06_status/proof/<UTV2-###>/claude-critique.md`

Non-empty. Must reference the merge SHA after merge. Recommended sections:
- **Invariant correctness** — does the diff preserve the invariants the issue is supposed to enforce?
- **Regression risk** — what could this break that the tests don't cover?
- **Scope drift** — did the diff stay within the declared `file_scope_lock`?
- **Hidden coupling** — does this couple to anything not declared in the issue?
- **Verdict** — `APPROVE` / `BLOCK` / `REQUEST CHANGES` with rationale.

### `docs/06_status/proof/<UTV2-###>/runtime-verification.md`

Non-empty. Must contain:
- A checklist where each item ends in `: PASS` (or explicitly `: SKIP`, but SKIP fails the gate).
- A bottom line: `result: pass` (or `result: fail`).
- Runtime evidence specific to the change type:
  - DB changes: `pnpm test:db` log + targeted live smoke output
  - Auth changes: real auth flow trace
  - Worker/outbox changes: actual delivery + pending-age before/after
  - Config changes: service startup log under production-like env validation

A FAIL or SKIP on any required item blocks the merge.

## 4. Lane manifest fields (P0 protocol block)

Added to `LaneManifest` (`docs/05_operations/schemas/lane_manifest_v1.schema.json`):

```jsonc
"p0_protocol": {
  "required": true,                       // set when lane is P0
  "codex_implementation": { "recorded": true, "pr_url": "..." },
  "claude_critique":      { "recorded": true, "artifact_path": "docs/06_status/proof/UTV2-###/claude-critique.md" },
  "human_approval":       { "recorded": true, "pm_verdict_url": "https://github.com/.../pull/####issuecomment-..." },
  "runtime_verification": { "recorded": true, "artifact_path": "docs/06_status/proof/UTV2-###/runtime-verification.md", "result": "pass" },
  "merge_type": "manual"                  // never "auto" for P0
}
```

## 5. CI / branch-protection wiring

### Required status checks on `main`

Branch protection requires four checks. The fourth is added by UTV2-948:

1. `verify`
2. `Executor Result Validation`
3. `Merge Gate`
4. **`P0 Protocol`** (new — added by UTV2-948)

The `P0 Protocol` check skips protocol artifacts only for authoritatively classified non-P0 PRs, so adding it as required does not affect non-P0 work.

### Apply / inspect via GitHub CLI

```bash
# Inspect current protection
gh api repos/griff843/Unit-Talk-v2/branches/main/protection

# Update required contexts to include P0 Protocol
gh api -X PUT repos/griff843/Unit-Talk-v2/branches/main/protection/required_status_checks \
  -f strict=true \
  -F 'contexts[]=verify' \
  -F 'contexts[]=Executor Result Validation' \
  -F 'contexts[]=Merge Gate' \
  -F 'contexts[]=P0 Protocol'
```

## 6. Truth-check enforcement (post-merge)

`ops:truth-check <UTV2-###>` adds five P0-protocol checks (run after existing M/L/G/P/R/S checks):

| Check | What it verifies |
|---|---|
| **H1** | Shared repository classification is known and consistent with the required protocol; preserved positives cannot be cleared by the candidate. |
| **H2** | `claude_critique` artifact recorded, non-empty, references the merge SHA. |
| **H3** | `runtime_verification` artifact recorded, has `result: pass`, no FAIL/SKIP items, manifest `result === 'pass'`. |
| **H4** | PR has `PM_VERDICT: APPROVED` comment from a CODEOWNERS member. |
| **H5** | `merge_type === 'manual'` (never `auto`). |

Authoritatively classified non-P0 lanes skip protocol artifact checks; unknown classification fails H1. P0 lanes fail truth-check on any H violation.

## 7. Orchestrator behavior

The `/dispatch-board` skill calls `pnpm ops:p0-detect <UTV2-###>` before every merge attempt. If `is_p0: true`:
- Orchestrator does **not** call `gh pr merge` autonomously.
- Orchestrator surfaces the merge gate to PM (same template as T1 merge gate).
- Orchestrator waits for a `PM_VERDICT: APPROVED` comment from CODEOWNERS.
- PM merges manually.

This is the prose-side enforcement. Branch protection is the mechanical fallback if the orchestrator misbehaves.

## 8. Counter-tests

The protocol must reject all of the following at the gate:
- A P0 PR with no `claude-critique.md`.
- A P0 PR with `runtime-verification.md` containing `: FAIL` on any item.
- A P0 PR with `runtime-verification.md` containing `: SKIP` on any item.
- A P0 PR with `automerge` / `auto-merge` / `auto_merge` label.
- A P0 PR with `claude-critique.md` empty.
- A P0 PR with `runtime-verification.md` missing the `result: pass` line.

Each counter-test is documented in `scripts/ops/p0-detect.test.ts` and exercised against the `P0 Protocol` workflow during the dogfood verification of UTV2-948 itself.

## 9. Dogfood

UTV2-948 must ship through its own protocol. The PR for UTV2-948 includes:
- `docs/06_status/proof/UTV2-948/claude-critique.md`
- `docs/06_status/proof/UTV2-948/runtime-verification.md`
- Lane manifest with `p0_protocol.required: true` and all sub-blocks populated at merge.

If UTV2-948 cannot merge through its own gate, the gate is not real.

## 10. Re-evaluation

After the P0 batch (UTV2-914 through UTV2-923) closes:
- If all ten lanes shipped under this protocol without a regression, the protocol becomes the default for P1.
- If any guardrail was skipped and produced a defect, tighten before any P1 work begins.
- If the protocol blocked a legitimate merge for an artifact-formatting reason rather than a real risk, refine the artifact schema before broadening.

## Tracker cutover bootstrap boundary

The new workflow checks out its evaluator from the trusted protected base, never candidate implementation. If that base does not yet contain the evaluator, the check must refuse with a governed bootstrap review requirement. This specification describes the intended cutover behavior; it is not evidence that bootstrap, independent exact-head review, protected integration or tracker-free closeout has occurred. Prepare the existing required approval/bootstrap artifact before requesting the reserved action; do not direct-push main, fabricate checks or execute candidate code as merge authority.
