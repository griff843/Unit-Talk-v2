# Unit Talk V2 — Three-Lane Workflow Specification

**Status:** Ratified  
**Ratified by:** Claude (governance) + PM (sequencing) — UTV2-639  
**Effective:** 2026-04-21

---

## Why this exists

Unit Talk V2 operates three parallel execution lanes: Codex (implementation), Claude (governance/proof/closeout), and PM/ChatGPT (prioritization/decision-forcing). A single generic Ready→In Progress→Done flow caused false progress signals and ambiguous ownership. This spec makes the real operating model mechanical.

---

## Workflow states

All 13 states are live in Linear. The table below is the canonical definition.

| State | Type | Owner | Meaning |
|---|---|---|---|
| **PM Triage** | backlog | PM | New issue; not yet sequenced against active program |
| **Needs PM Decision** | backlog | PM | Blocked: prioritization, tradeoff, scope, or acceptance call unresolved |
| **Needs Standard** | backlog | Claude | Blocked: governing standard, contract, or success bar not explicit |
| **Ready for Codex** | unstarted | Codex | Scope, acceptance, and standards clear; Codex can execute without guessing |
| **Ready for Claude** | unstarted | Claude | Requires governance framing, proof design, decomposition, or closeout rules |
| **In Codex** | started | Codex | Codex actively implementing |
| **In Claude** | started | Claude | Claude actively defining standards, proof, framing, or closeout logic |
| **In PM Review** | started | PM | Needs sequencing review, milestone review, tradeoff arbitration, or go/no-go |
| **Blocked Internal** | started | Owner of blocker | Waiting on another Unit Talk issue or team decision |
| **Blocked External** | started | Owner of blocker | Waiting on provider, infrastructure, vendor, or outside dependency |
| **In Proof** | started | Claude | Implementation complete; live/runtime evidence gathering underway |
| **Ready to Close** | started | Claude | Technical + proof complete; only final closeout/writeup/verdict remains |
| **Done** | completed | — | Fully closed. Proof-bearing issues: evidence exists, not just code |

---

## Lane labels (required on every issue)

| Label | Applies to |
|---|---|
| `lane:pm` | Issues owned or gated by PM at some step |
| `lane:codex` | Implementation assigned to Codex |
| `lane:claude` | Governance, proof, or closeout assigned to Claude |
| `lane:shared` | Cross-lane issue; explicit owner must be named for current step |

Every issue must carry exactly one primary lane label. Add a second only if the issue genuinely requires handoff.

---

## Phase labels (required on proof/closeout issues)

| Label | Meaning |
|---|---|
| `phase:implementation` | Active build work |
| `phase:proof` | Live evidence gathering |
| `phase:closeout` | Final verdict, writeup, or ratification |

---

## Dependency labels

| Label | Meaning |
|---|---|
| `blocked:internal` | Waiting on another issue in this repo |
| `blocked:external` | Waiting on something outside the repo |
| `needs:standard` | No governing contract or success bar exists yet |
| `needs:pm-decision` | PM must make a call before work can proceed |

---

## Done gate: implementation-only vs proof-bearing

### Implementation-only issues (`phase:implementation` only)

Done requires:
- `pnpm verify` green on merge SHA
- PR merged to `main`
- Lane manifest closed (`status: "merged"`)
- Linear state = Done

### Proof-bearing issues (`phase:proof` or `phase:closeout`)

Done requires everything above **plus**:
- Issue must pass through **In Proof** before Done (skipping In Proof is a workflow violation)
- Evidence bundle exists at `docs/06_status/proof/UTV2-###/evidence.json`, tied to merge SHA
- T1: runtime proof against live Supabase; static proof alone is insufficient
- Linear state = Done only after Merge Authority is satisfied per tier (canonical definition + artifacts: `CLAUDE.md` "Verification expectations", mechanically enforced by `.github/workflows/merge-gate.yml`) — T1 requires `t1-approved` label + `pm-verdict/v1` APPROVED comment; T2 requires a GitHub PR review approval or `pm-verdict/v1` APPROVED comment; T3 merges on green CI alone

---

## Ownership rules

| Who | Owns these states |
|---|---|
| PM (ChatGPT) | PM Triage, Needs PM Decision, In PM Review |
| Claude | Needs Standard, Ready for Claude, In Claude, Ready to Close (for proof/governance issues) |
| Codex | Ready for Codex, In Codex |
| Shared | Blocked Internal, Blocked External, In Proof (Claude leads; PM gates exit) |

Any issue in a shared lane must have an explicit owner named for the current step.

---

## Merge mechanics

**Status:** Ratified under UTV2-1467 (2026-07-09), implementing Design B of the merge-queue decision packet (`docs/05_operations/UTV2-1461-merge-queue-decision-packet.md`, UTV2-1461).

### Why this exists

Branch protection on `main` is `strict: true` with four required contexts (`verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`) and no merge queue. Every merge invalidates every other open PR's up-to-date status, forcing a full `update-branch → CI → re-post executor-result` cycle per PR. Measured cost: N green PRs cost roughly **2N–3N CI cycles** under serial, operator-driven draining. Native GitHub merge queue (Design A) is **not available** on this repository — it is an organization-scoped-only GitHub feature, confirmed via a live ruleset probe (`gh api` returned HTTP 422 for a `merge_queue` rule) — and adopting it requires a separate, PM-gated org-transfer decision. This section documents Design B instead: a batched-merge protocol that needs **no branch-protection or required-workflow changes**.

### merge-train

`pnpm ops:merge-wrapper merge-train --candidates-file <path.json> [--method squash] [--ttl-minutes 60] [--timeout-minutes 15] [--poll-seconds 15] [--dry-run]` drains a batch of already-green, already-gate-approved PRs serially and immediately:

1. **Collect** — the caller (orchestrator session or `/dispatch-board`) supplies a pre-ordered JSON array of `{ issue_id, branch, pr }` candidates. `merge-train` has no lane-type awareness; ordering (e.g. workflow/infra lanes first, then by age) is the caller's responsibility.
2. **Freeze** — the merge mutex (`.ops/merge-lock.json`) is acquired **once for the whole batch**, not once per PR. `merge_serialized_max` in `docs/governance/CONCURRENCY_CONFIG.json` stays exactly `1` — the train does not raise the serialization ceiling, it changes how long a single serialized hold covers.
3. **Drain serially, immediately** — for each candidate in order: `pr-update-branch` → wait for CI to settle on the new head (polls `gh pr view --json statusCheckRollup` against the four required contexts) → re-post the `EXECUTOR_RESULT` comment against the new head SHA (mechanical: the diff hasn't changed, only the base merge commit moved) → merge. No idle gap between candidates — that gap is exactly what let unrelated `main` advances restart other PRs' cycles under the old serial flow.
4. **Batch closeout** — after a successful drain, run the existing single-issue post-merge closeout once per merged candidate, back-to-back. This is *N sequential single-issue closeouts*, not a new batch-aware closeout workflow — `post-merge-lane-close.yml` accepting multiple issue IDs on one `workflow_dispatch` is an explicitly separate, deferred follow-up.

**Required-context enforcement is unchanged.** `ci.yml`, `merge-gate.yml`, `executor-result-validator.yml`, and `p0-protocol.yml` are untouched by this design — each candidate's `pr-update-branch` step produces the same `synchronize` event GitHub has always required a real CI run for; merge-train only changes the *cadence* at which those cycles happen between merges, not what gets validated or when.

**Degrades safely.** If a candidate fails (update-branch conflict, CI failure/timeout, or merge failure), the drain stops: already-merged candidates stay merged (nothing to undo), untouched candidates are left exactly as they were (individually mergeable), and the mutex is released unconditionally — including on an unexpected exception from an injected dependency. Per-PR merging continues to work unchanged at any point; there is no state to unwind.

**Invariant note:** the merge mutex being held for the duration of a train is a *different* mechanism from lane manifest state (`docs/06_status/lanes/*.json`, Truth hierarchy rank 3). A train holding the mutex does not make the underlying lanes "active" in the concurrency-policy sense (`docs/governance/LANE_CONCURRENCY_POLICY.md` §1) — those lanes already completed their own lifecycle before being queued into a train. Do not conflate "mutex held" with "lane active."

### Rollback

Stop invoking `merge-train`; per-PR merging via `pnpm ops:merge-wrapper pr-merge`/`pr-update-branch` continues to work exactly as before, with no state to unwind. There is no schema or config change to revert.

---

## Invariants

1. An issue in Ready for Codex or In Codex must have zero unresolved blockers.
2. A proof-bearing issue cannot reach Done without passing through In Proof.
3. Done without proof where proof is required is a workflow violation.
4. Every active issue must have at least one lane label.
5. T1 issues cannot move to In Codex or In Claude without PM confirmation.

---

## Canonical references

This document is the authoritative source for workflow state definitions and lane ownership. Related specs:

- `docs/05_operations/DELEGATION_POLICY.md` — tier policy and executor routing
- `docs/05_operations/TRUTH_CHECK_SPEC.md` — done-gate (`ops:truth-check`)
- `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` — proof artifact format
- `CLAUDE.md` — session discipline and lane execution expectations
