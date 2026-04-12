# Execution Truth Model

**Status:** Canonical
**Authority tier:** T0 — governs all execution
**Owners:** PM + orchestrator agent
**Supersedes:** prose execution rules previously embedded in `CLAUDE.md`

This document defines how execution truth is established, enforced, and verified in Unit Talk V2. It is the governing spec for `ops:lane:start`, `ops:lane:close`, `ops:truth-check`, `ops:preflight`, and the lane manifest.

When this document and any other source disagree, **this document wins**. Update it instead of working around it.

---

## 1. Truth Hierarchy

Execution truth is ranked. Higher ranks win unconditionally.

| Rank | Source | Authoritative For | Non-Authoritative For |
|---|---|---|---|
| 1 | **GitHub `main`** | shipped code, merge SHAs, CI state on merge | what is in progress, intent |
| 2 | **Proof bundle** (tied to merge SHA) | completion evidence for T1/T2 | anything beyond the linked SHA |
| 3 | **Lane manifest** (`docs/06_status/lanes/*.json`) | active lane state, file locks, heartbeats | shipped outcomes |
| 4 | **Linear issue state** | workflow intent, ownership, tier label | whether code is actually merged |
| 5 | **Chat, memory, agent claims, session notes** | context only | **nothing — never authoritative** |

**Laws:**
- If two sources disagree, the higher-ranked source wins and the lower source is reconciled to it.
- The agent may **never** escalate its own claim above a lower rank it has read.
- `ISSUE_QUEUE.md`, `PROGRAM_STATUS.md`, and similar docs are *views*, not truth. They are updated from rank 1–3, never the reverse.

---

## 2. Lane Lifecycle

A lane is the unit of execution. Exactly one issue per lane, one branch per lane, one PR per lane.

```
Ready ──▶ Lane Started ──▶ In Progress ──▶ In Review ──▶ Merged ──▶ Done
                │                │              │            │
                ▼                ▼              ▼            ▼
             Blocked         Blocked        Blocked       Reopened
```

### States

| State | Entry Condition | Exit Condition | Authority |
|---|---|---|---|
| **Ready** | Linear issue has tier label, acceptance criteria, allowed-files scope | `ops:lane:start` succeeds | Linear |
| **Lane Started** | manifest created, preflight token valid, worktree + branch created, file locks acquired | first commit pushed | Manifest |
| **In Progress** | commits landing, heartbeat fresh | PR opened | Manifest |
| **In Review** | PR open, CI running | PR merged into `main` | GitHub |
| **Merged** | merge commit on `main` first-parent history | `ops:truth-check` passes | GitHub |
| **Done** | `ops:truth-check` pass recorded in manifest, Linear transitioned, manifest closed | — | Truth-check output |
| **Blocked** | explicit blocker with reason + reference | blocker resolved | Manifest |
| **Reopened** | post-Done truth-check failure OR follow-up fix within 24h without linked issue | re-entry to In Progress | Truth-check |

### Required Commands

These are the **only** sanctioned lane transitions:

| Command | Purpose | Fails If |
|---|---|---|
| `ops:preflight` | verifies env, git, deps, secrets; emits preflight token | any precondition missing |
| `ops:lane:start <UTV2-###>` | creates manifest, worktree, branch, file locks | no preflight token, issue missing tier, file-scope collision |
| `ops:lane:close <UTV2-###>` | runs truth-check, transitions Linear, closes manifest | truth-check fails |
| `ops:truth-check <UTV2-###>` | the done-gate (see `TRUTH_CHECK_SPEC.md`) | any mechanical check fails |

**No lane may start without a valid preflight token. No lane may be closed without a passing truth-check. These are hard gates, not conventions.**

---

## 3. Done-State Law

An issue is **Done** if and only if **all** are true:

1. A merge commit exists on `main`'s first-parent history referencing the issue.
2. CI on that merge commit is green.
3. Required proof artifacts exist at declared paths and reference the merge SHA.
4. `ops:truth-check <UTV2-###>` exits 0.
5. The lane manifest records the truth-check pass and has `status: closed`.
6. The Linear issue is transitioned to Done by `ops:lane:close`, not by hand.

An issue is **not Done** on the basis of:
- agent narrative ("I completed this")
- an open or draft PR
- green CI on a branch that is not merged
- a proof file that does not reference the merge SHA
- PM verbal approval without label
- memory, session notes, or chat summary

**If any rank-1 or rank-2 source contradicts Done, the issue is not Done.** Period.

---

## 4. Tier Model

Every Linear issue carries exactly one machine-readable tier label. Tier determines proof, verification, and merge requirements.

| Tier | Scope | Required Verification | Required Proof | Merge Authority |
|---|---|---|---|---|
| **T1** | migrations, shared contracts, runtime routing, scoring/promotion/lifecycle, governance | `type-check` + `test` + `test:db` + tier-specific runtime proof | Evidence bundle v1 (static + runtime), SHA-tied, validated by `evidence:validate` | PM label `t1-approved` required on PR |
| **T2** | isolated logic/refactor, service-internal changes, non-shared route changes | `type-check` + `test` + issue-specific verification | Diff summary + verification log in manifest | Orchestrator merges on green after diff review |
| **T3** | docs, isolated UI, typos, config-only, comment fixes | `type-check` + `test` | Green CI | Orchestrator merges on green |

**Tier laws:**
- Missing tier label → issue is not Ready, cannot be lane-started.
- Tier may only be lowered (T1→T2) by PM; never by agent.
- Tier may be raised (T2→T1) by agent if scope discovery reveals a T1 path; this reopens the plan.
- Phase-boundary violations (e.g., Phase 2 invariants) are **always T1** regardless of diff size.

---

## 5. Enforcement Placement

The placement law: **if a rule can be enforced mechanically, it must not live only in prose.**

| Concern | Surface |
|---|---|
| Lane start preconditions | `ops:preflight` (script) |
| Lane state | Lane manifest (JSON artifact) |
| Done-gate | `ops:truth-check` (script) |
| Tier-specific verification | `verification` skill + per-tier script dispatch |
| CI/secret/workflow health | `ops:ci-doctor` (script, also scheduled GH Action) |
| Package boundary rules | `code-structure` skill + CI grep guards |
| Phase-boundary invariants (Phase 2, etc.) | CI grep guards + `phase-boundary-guard` skill |
| Scope bleed on Codex returns | `ops:scope-diff` against task packet `allowed_files` |
| Merge authority per tier | GitHub branch protection + CODEOWNERS + PR labels |
| Evidence schema | `evidence_bundle_v1.schema.json` + `evidence:validate` |
| Issue tier labels | Linear automation + `ops:lane:start` refusal |
| Truth hierarchy / lifecycle spec | this document |
| Domain purity rules | `betting-domain` skill + CI import guards |
| Session bootstrap | `session-bootstrap` skill |

**What belongs in `CLAUDE.md`:** invariants that cannot be mechanically enforced, pointers to this document and skills, and the command reference. Nothing else.

**What belongs in skills:** detailed procedural rules loaded on demand (classification, verification, dispatch, code-structure, phase-boundary-guard).

**What belongs in canonical docs:** schema facts, contracts, this governance model, tier matrix, provider knowledge.

**What belongs in CI:** anything mechanically checkable on a PR or scheduled cadence.

**What belongs in GitHub/Linear policy:** branch protection, required checks, CODEOWNERS, required labels, state transitions.

---

## 6. Reopen Conditions

An issue returns from Done to In Progress (and manifest reopens) if **any** are true:

- `ops:truth-check` run post-merge fails for a reason tied to the merge SHA.
- A follow-up commit on `main` within 24h touches files in `files_changed` without a linked follow-up issue.
- Required proof artifacts become unreadable or schema-invalid.
- Phase-boundary guard flags a violation traced to the merge SHA.
- PM explicitly reopens via label `reopened` on the Linear issue.

Reopen is mechanical and logged in the manifest's `reopen_history` field.

---

## 7. Stale Lane / Heartbeat

Every active lane must emit a heartbeat while In Progress. Heartbeat is a timestamp written to the manifest on each `ops:*` call, on commit, and optionally on a timer.

| Condition | Detection | Action |
|---|---|---|
| No heartbeat for > 4h | `ops:reconcile` scheduled run | flag lane `stale`, notify PM |
| No heartbeat for > 24h | same | auto-transition to Blocked with reason `stranded`, require explicit `ops:lane:resume` |
| Manifest exists but branch deleted | `ops:reconcile` | flag `orphaned`, require manual close |
| Two lanes holding overlapping `file_scope_lock` | `ops:lane:start` | second lane refused |

Stranded detection is mechanical. No human scans a dashboard for stuck work.

---

## 8. PM Trust Rules

PM reviews **artifacts**, not narratives.

- **T1 review input:** `ops:truth-check` machine-readable output + evidence bundle + diff. Nothing else.
- **T1 approval signal:** GitHub label `t1-approved` on the PR. Chat approval is not binding.
- **Daily digest:** `ops:daily-digest` emits open lanes, stale lanes, truth-check failures, CI health, drift flags. PM reviews the digest, not session transcripts.
- **Agent self-certification is forbidden.** The agent may declare a lane *ready for truth-check*, never *done*.
- **PM override:** PM may force-close a lane via `ops:lane:close --override --reason <text>`. Recorded in manifest, appears in next digest.

---

## 9. What This Document Does Not Govern

- Implementation details of `ops:*` scripts → see `TRUTH_CHECK_SPEC.md`, `LANE_MANIFEST_SPEC.md`.
- Code-structure rules → `code-structure` skill.
- Phase-specific invariants → `docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md` and successor phase contracts.
- Provider knowledge → `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md`.
- Schema facts → `docs/02_architecture/SCHEMA_FACTS.md` (to be extracted from `CLAUDE.md`).

---

## 10. Invariants (Never Violate)

1. `main` is shipped truth. Nothing above it.
2. Agent claims are never authoritative.
3. No lane without preflight. No Done without truth-check.
4. Proof must tie to the merge SHA.
5. One issue, one lane, one branch, one PR.
6. Tier label is required before Ready.
7. Manifest is the only place lane state lives.
8. Reopens are mechanical, not polite.
9. PM reviews artifacts, not prose.
10. If a rule can be a script, it must not be a paragraph.
