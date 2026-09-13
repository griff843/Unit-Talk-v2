# P0 Runtime Hardening Merge Protocol — Specification

**Linear:** UTV2-948
**Status:** Ratified 2026-05-12
**Supersedes:** Tier-based auto-merge for any repository work classified P0.

This document is the canonical mechanical enforcement spec for the P0 merge protocol. Memory entries describe intent; this file describes how the gate is enforced.

---

## 1. What is "P0"

Repository classification is authoritative. `scripts/ops/tracker-independence/p0-classifier.cjs` is the shared evaluator foundation for CI, `ops:p0-detect` and truth-check. Its reviewed registry is `docs/governance/tracker-independence/p0-classifications.json` (`schema_version: 1`, classifications with `issue_id`, `required` and `evidence`). Legacy UTV2/UNI and new WORK identities use the same rules.

Classification is `p0`, `non_p0` or `unknown`; `is_p0` is respectively true, false or null. Historical positives include UTV2-914 through UTV2-923, UTV2-948, UTV2-949 and UTV2-953. The initial batch is not an exhaustive negative classification of every other item. Trusted-base positive evidence or a candidate positive declaration requires the protocol; a candidate cannot clear that classification by deleting or editing a field or registry entry.

A candidate manifest that explicitly declares `p0_protocol.required: false` is classified non-P0 when that same manifest carries a valid T1, T2 or T3 tier. This applicability decision does not require a second P0-specific human verdict. The protected Merge Gate evaluates the declared tier independently and continues to enforce its ordinary T1 and T2 review and approval requirements, including exact-head approval where the tier policy requires it. Trusted-base negative evidence remains usable after merge. Missing flags, missing or invalid tiers, and unknown classification are blocking conditions, never implicit non-P0 results. Tracker credentials, project reads and outages do not influence classification.

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

PR #1556 carries the evaluator foundation. Until that foundation lands on the protected base, `.github/workflows/p0-protocol.yml` remains the existing base consumer and does not treat candidate-only evaluator code as merge authority. The follow-up workflow patch must be applied only after the foundation lands, and must check out and execute the evaluator from the trusted protected base rather than from candidate implementation.

This specification describes the intended cutover behavior; it is not evidence that bootstrap, independent exact-head review, protected integration or tracker-free closeout has occurred. P0 work still requires its human verdict bound to the exact reviewed head, complete runtime evidence and manual merge. Prepare the existing required approval/bootstrap artifact before requesting the reserved action; do not direct-push main, fabricate checks or execute candidate code as merge authority.

### The staged block is mechanical, not a condition of approval

The two phases above create a window: the foundation lands while the base consumer still resolves
`/(?:UTV2|UNI)-\d+/i` and **auto-passes anything else**, so a `WORK-###` PR clears the required
`P0 Protocol` check in seconds with no evaluation at all. Measured on #1556's own required check —
run `34599912852`, conclusion `success` in 10s, log line *"No UTV2-### / UNI-### identifier found in
PR title, body, or branch — treating as non-P0."*

That window is narrowed by three **local** controls. They are stated as local deliberately: none
of them is a required check, none is enforced by GitHub, and the paragraph after the table says
what that means for how the foundation reaches `main`.

| Site | Behaviour |
|---|---|
| `scripts/ops/shared.ts` — `evaluateRepoMintedP0Coverage` | reads the consumer **at the installed trusted base `origin/main`** (`git show origin/main:.github/workflows/p0-protocol.yml`), never the working tree or a branch head, and parses it structurally: coverage means a `pull_request`-triggered workflow whose `P0 Protocol` job has a live step — not under a literal-false `if`, not `continue-on-error: true` — whose `actions/github-script` body, with comments removed, `require`s `scripts/ops/tracker-independence/p0-workflow.cjs` and calls its `evaluatePullRequest` entry point at statement level, and that evaluator exists at the same base commit. A shell `run:` step is never counted, because the evaluator has no CLI entry point: `node p0-workflow.cjs` exits 0 having evaluated nothing. A comment naming the path, a disabled step, a step in another job, or an activation that exists only on a branch is a reference, not coverage. Fails closed when `origin/main` cannot be resolved, when the consumer is missing at the base, or when the evaluator is absent there. The receipt records the ref and commit it read. |
| `scripts/ops/preflight.ts` — check `PW1` | `fail` for a repo-minted identity while coverage is absent at the base; `skip` for a tracker key, which the existing consumer already evaluates. Not waivable at any tier. |
| `scripts/ops/lane-start.ts` | refuses a **new** repo-minted lane with `p0_consumer_not_activated` before any lease, worktree or manifest is written; the refusal JSON carries the `trusted_base` it read. |
| `scripts/ops/pre-merge-authorization.ts` (the merge wrapper) | a manifest that already exists on a branch never passes admission again, so the sanctioned merge path holds the same line: a repo-minted head ref is refused with the coverage reason in the receipt, evaluated at the same trusted base, and a predicate that throws is a refusal rather than an assumption. |

**What these controls are not.** They are not required-check enforcement. `merge-gate.yml` resolves
the authoritative tier from the lane manifest carried by the candidate head, and an earlier revision
of this section claimed that made admission "a complete chokepoint" because `ops:lane-start` was the
only writer of that file. That is a statement about ordinary tooling, not an enforced trust
guarantee — a manifest can be written by anything that can commit — and the claim is withdrawn.
What the controls do guarantee is narrower and is what the tests exercise: **the repository's own
admission tooling refuses to open or authorize a repo-minted lane unless the consumer installed on
`origin/main` contains a live `actions/github-script` step, in the `P0 Protocol` job, whose body,
read literally, calls the evaluator's `evaluatePullRequest` export through a `require` of the
evaluator path and contains nothing else that names that module or that export**. "Live" means: the job and step carry no
literal-false `if:`, no `continue-on-error` other than literal false, the job does not `need` a
disabled or absent job, its matrix (if any) has no empty axis and no `exclude` at all (matrix
expansion is not modelled, so any `exclude` is refused), the step's action is exactly
`actions/github-script` (any ref), and exactly one job reports the `P0 Protocol` context.
"Read literally" means: every string and template literal is blanked first (only the evaluator
path literal keeps its content), and a body containing any `/` outside a string (a comment, a regex
literal or a division), a template substitution, a raw newline inside a quote, or an unterminated
literal is refused rather than parsed. "Calls through a `require`" means one of exactly three
statement-level forms: `require(<evaluator>).evaluatePullRequest(` inlined; `const
{ evaluatePullRequest } = require(<evaluator>)` followed by `evaluatePullRequest(`; or `const <name>
= require(<evaluator>)` followed by `<name>.evaluatePullRequest(`, where `<evaluator>` is the path
literal or a `const` binding of it declared once. "Nothing else" means the body refuses on `eval`,
`Function`, `with`, `import`, `module` or `globalThis`; on a `require` not immediately called or
whose argument is not a string literal or a path binding; on a redefinition of `require` or of the
entry point; on an assignment to a path binding; and on any other occurrence of the entry-point
name, of a module binding, of the path literal or of a `require` of it. The tests enumerate the
shapes independent review probed across five rounds, each refused: a shell `run:` of any form (the
evaluator has no CLI entry point, so no shell invocation evaluates anything), a comment-only
reference in shell or JavaScript, a path inside a string (including a backslash-newline
continuation) or a template literal, a `require` nested inside another expression, a bare `require`
that never calls the entry point, a body that shadows or redefines the entry point or `require`, a
`let` or `const` binding reassigned, a forked `actions/github-script-*` action, an all-excluded
matrix, a duplicate `P0 Protocol` job, a fake object property named after the entry point called
after a bare `require`, the export reassigned or replaced before the call (through a tracked or an
unbound module reference, a second binding, `Object.assign`, `Object.defineProperty`,
`Reflect.set`, a getter, a bracket access, `require.cache`, `eval` or `new Function`), a module
loaded through a computed, concatenated or dynamically imported path, a `//` inside a string ahead
of a mutation, the entry point passed around by reference, a renamed or widened destructuring, a
longer path that merely ends in the evaluator's, candidate-only activation on a branch, and a
candidate manifest that already exists.

What the predicate does **not** assess, stated so nobody reads more into it: JavaScript control
flow (a call inside `if (false)`, a never-invoked function, a `try` whose `catch` swallows the
failure, or a body that throws before the call is counted if the statements are present; a body
that throws fails the required check, which is fail-closed for the PR), runtime `if:` expressions
(evaluated by Actions, not here), `timeout-minutes`, a second *workflow* that reports the same check
name, and a mutation of the loaded module through a reference obtained without naming `require`,
`module`, `eval`, `Function` or `import` (for example a helper module already on the base). None of these is
reachable by a WORK PR author, because the predicate never reads candidate content: introducing
any of them requires first landing a weakened consumer on `origin/main` through a reviewed
required-check change, which is exactly the bootstrap route this foundation already requires. The
predicate is a fail-closed detector of whether the reviewed activation is installed, not a semantic
verifier of the consumer. These are local controls; they do not replace the required checks, and
the merge gate is unchanged.

**How the foundation reaches `main`, then.** The evaluator and its activation are landed through
the **established bootstrap route**, not by widening a required check and not by admitting a
`WORK-###` PR through the controls above: a tracker-keyed lane whose tier `Merge Gate` resolves from
its manifest, with its own independent review and required CI — or, where the concurrency caps
refuse that lane, a `docs/governance/BOOTSTRAP_AUTHORIZATIONS.json` entry authorized by Griff and
read from the base, exactly as `merge-gate.yml` already reads it. `Merge Gate` cannot resolve a tier
for a `WORK-###` head at all (*"No issue ID found in PR branch or title. Cannot resolve
authoritative tier."*), which is measured on #1556 and is the reason the route is the tracker-keyed
one. No branch-protection change and no required-check change is part of this.

**It releases itself, and only from the base.** Because the predicate reads `origin/main`, landing
the activation there lifts the refusal with no second edit, and a later base commit that removes
the delegation re-arms it even if a working tree still holds the activated files. Applying the
activation on a branch, referencing the evaluator in a comment, or disabling the required check does
not release it.
