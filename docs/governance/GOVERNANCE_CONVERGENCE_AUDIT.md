# Governance Convergence Audit

**Issued under:** UTV2-975  
**Date:** 2026-05-15  
**Auditor:** Claude (governance lane)  
**Status:** Authoritative — blocks orchestration scaling until findings are addressed  
**Authority:** `docs/05_operations/EXECUTION_TRUTH_MODEL.md` T0

---

## Executive Summary

**Verdict: The system is architecturally coherent but mechanically unconverged.**

Unit Talk V2 has ONE governing authority model (`EXECUTION_TRUTH_MODEL.md`) and ONE canonical lane lifecycle (`LANE_MANIFEST_SPEC.md`). These documents are well-written and internally consistent. The truth hierarchy is sound.

However, the system now operates with **three partially-overlapping enforcement layers** that were built incrementally and have not been co-integrated:

1. **Prose + scripts layer** — `EXECUTION_TRUTH_MODEL.md`, `ops:*` CLI scripts, CLAUDE.md skills
2. **CI/CD layer** — 30 GitHub Actions workflows, merge-gate, tier-label-check, proof validation
3. **`.lane/` code-level enforcement layer** — merged 2026-05-15, not yet wired to CI or dispatch

These layers each enforce parts of the governance contract, but they:
- Define overlapping path policies that **directly conflict** in at least one case
- Are not cross-referenced from a single authoritative source
- Are not all present in `pnpm verify`
- Produce different answers to "can this lane write this file?"

Additionally, the merge mechanics (`sync.yml` conflict model, `[skip ci]` deadlock) are broken for normal governed merges. This is the most urgent operational blocker, confirmed by UTV2-961 and UTV2-970.

**Before scaling**: Fix merge mechanics (UTV2-961/970) first. Registry reconciliation (UTV2-962) second. `.lane/` integration third.

---

## Section 1: Lane Truth — Inventory and Verdict

### 1.1 All lane truth sources

| Source | Location | Purpose | Status |
|---|---|---|---|
| **Individual lane manifests** | `docs/06_status/lanes/*.json` | Active lane state, file locks, heartbeat, truth-check history | **Canonical** — declared by `LANE_MANIFEST_SPEC.md` |
| **Global lanes registry** | `.claude/lanes.json` | Per-lane entry with `owner`, `status`, `allowedFiles`, `packetPath` | **Legacy** — 5 entries, all done/merged (April 2026), no new entries since |
| **Lane type contracts** | `.lane/lanes/*.yml` | Path authority per lane type, proof requirements, concurrency rules | **New, unintegrated** — merged 2026-05-15; not cross-referenced from EXECUTION_TRUTH_MODEL.md |
| **sync metadata** | `.ops/sync.yml` | RETIRED_EXTERNAL_SYNC/CI sync — links PR to issue, controls `allow_multiple_issues` flag | **Operational but conflicted** — single shared mutable file causes guaranteed rebase conflicts |
| **Linear issue state** | Linear API | Workflow intent, tier label, ownership | Rank 4 truth — follows manifest, never leads |
| **GitHub PR metadata** | GitHub API | Merge SHA, CI outcomes, PR labels | Rank 1 truth for shipped state |

### 1.2 Canonical owner declaration

| Data category | Canonical owner | Non-canonical (retire) |
|---|---|---|
| Active lane existence | `docs/06_status/lanes/<issue>.json` | `.claude/lanes.json` |
| Lane file-scope locks | `docs/06_status/lanes/<issue>.json` `.file_scope_lock` | (none) |
| Lane type path authority | `docs/governance/LANE_TAXONOMY.md` | `.lane/lanes/*.yml` (conflict — see §1.3) |
| Merge SHA / CI outcome | GitHub `main` first-parent | (none) |
| Proof artifact validity | `ops:truth-check` output + evidence bundle | (none) |
| Active issue for a branch | `.ops/sync.yml` → `entities.issues[0]` | (none, but file must become per-issue) |
| Migration lock state | `.lane/migration-lock.yml` (new, unused) | (none — first clear use of `.lane/`) |

### 1.3 Critical path conflict: `.lane/lanes/runtime.yml` vs `LANE_TAXONOMY.md`

**`LANE_TAXONOMY.md` §1 (Runtime Lane, merged UTV2-955 today):**
> Allowed paths: `apps/api/src/`, **`apps/worker/src/`**

**`.lane/lanes/runtime.yml` (merged same day, different PR):**
```yaml
forbidden_path_globs:
  - apps/worker/**
```

These two documents, both merged on 2026-05-15, give **opposite answers** to whether a Runtime lane may write `apps/worker/src/`. `lane-contract.ts` enforces the `.yml` file; the dispatch skill enforces the `.md`. They are now in direct conflict.

**Resolution required:** One source must be authoritative. Recommendation: `LANE_TAXONOMY.md` is the human-readable policy document; `.lane/lanes/*.yml` are the machine-enforced copies and must be updated to match. The discrepancy is in `.lane/lanes/runtime.yml` which should allow `apps/worker/**` under the Runtime lane (with Tier C hook advisory).

### 1.4 `.lane/lanes/governance.yml` gap

`docs/governance/LANE_TAXONOMY.md` §6 lists `docs/governance/**` as an allowed path for Governance lanes. The `.lane/lanes/governance.yml` does NOT include `docs/governance/**` in its `allowed_path_globs`. This means `pnpm lane:check -- --lane governance` would fail for this very PR (UTV2-975).

### 1.5 `.claude/lanes.json` retirement recommendation

`.claude/lanes.json` contains 5 entries, all with `status: done` or `status: merged`, from April 2026. The youngest entry is UTV2-511 (April 2026). No new lanes have been registered here. `LANE_MANIFEST_SPEC.md` defines `docs/06_status/lanes/*.json` as canonical. `.claude/lanes.json` is dead weight and should be removed after confirming no tooling reads it.

---

## Section 2: Merge Semantics — Verdict

**Status: BROKEN for normal governed merges. Confirmed by UTV2-961 and UTV2-970.**

### 2.1 `.ops/sync.yml` conflict model — root cause of merge friction

Every lane branch writes `.ops/sync.yml` with its issue ID:

```yaml
entities:
  issues:
    - UTV2-NNN
```

Main resets to `issues: []` after each merge. **Any branch cut before the previous merge is guaranteed to conflict on this file.** With two or three concurrent lanes, every rebase requires a manual resolution of the same file.

This is a distributed-systems concurrency problem: a single mutable shared file that all concurrent writers modify. The fix is not to improve conflict resolution; it is to eliminate shared mutable state.

**Recommended fix (from UTV2-961):** Per-issue immutable sync files: `.ops/sync/UTV2-975.yml`. The branch only touches its own file. No cross-lane conflicts.

### 2.2 `[skip ci]` deadlock with protected checks

Lane housekeeping commits (manifest creation, sync.yml writes) use `[skip ci]` to avoid triggering full CI on bookkeeping-only changes. When such a commit is at branch HEAD:

1. Required checks (Merge Gate, tier-label-check) never run
2. Branch protection cannot be satisfied normally
3. Admin merge required
4. Admin merge bypasses the expected event path
5. Post-merge automation (`post-merge-lane-close.yml`) may not fire
6. Lane closeout becomes manual

This happened for UTV2-924/931/927 (all required manual intervention). UTV2-925 is currently open and awaiting `t1-approved` — if its last commit is a housekeeping commit, the same problem will recur.

**Recommended fix (from UTV2-970):** Replace `[skip ci]` with path-aware CI short-circuiting. Required checks must complete (fast path) even for manifest-only changes.

### 2.3 Squash merge vs standard merge event path

The `post-merge-lane-close.yml` workflow depends on push events to `main`. Squash merges fire a `push` event, but the commit SHA differs from the PR's `head.sha`. If the workflow reads `github.event.before` or expects branch name in the push event, it may not match the lane manifest.

Admin squash merges via GitHub UI produce a `push` event with `forced: false` and `created: false` — the workflow should handle this case, but the fact that it did not fire reliably for recent merges suggests it does not.

### 2.4 Branch-centric vs lane-centric state tension

The current system tracks lane state in:
- The lane manifest JSON (lane-centric, correct)
- The branch name (branch-centric, fragile)
- `.ops/sync.yml` (branch-local shared file, problematic)

The principle in EXECUTION_TRUTH_MODEL.md §2 is that the manifest is authoritative. But several CI workflows (branch-discipline-guard, RETIRED_EXTERNAL_SYNC sync) derive issue identity from branch name patterns (`utv2-\d+`). This is a pragmatic fallback but creates dual derivation paths.

**Long-term direction:** Issue identity should always come from the lane manifest or `.ops/sync/UTV2-NNN.yml` (per-issue), never solely from branch name parsing.

---

## Section 3: CI Governance Model — Verdict

**Status: Functionally sound but over-complex. 30 workflows with overlapping concerns. One naming error.**

### 3.1 Workflow inventory by function

| Function | Workflows |
|---|---|
| **Merge authorization** | `merge-gate.yml`, `tier-label-check.yml` |
| **Proof/evidence validation** | `evidence-bundle-validate.yml`, `proof-coverage-guard.yml`, `proof-regression.yml`, `r-level-compliance-check.yml` |
| **Lane discipline** | `branch-discipline-guard.yml` (mislabeled — see §3.2), `file-scope-lock-check.yml` |
| **Post-merge automation** | `post-merge-lane-close.yml`, `RETIRED_EXTERNAL_SYNC-sync-on-merge.yml` |
| **CI health** | `ci-doctor.yml`, `ci.yml` |
| **Deployment** | `deploy.yml`, `staging-deploy.yml` |
| **Sync** | `RETIRED_EXTERNAL_SYNC-sync-on-pr.yml`, `RETIRED_EXTERNAL_SYNC-sync-on-merge.yml` |
| **Alerting** | `stale-lane-alerter.yml`, `ingestor-staleness-alert.yml`, `pipeline-health-monitor.yml` |
| **Governance** | `executor-result-validator.yml`, `doc-truth-gate.yml`, `shadow-parity-required.yml` |
| **Validation** | `live-schema-parity.yml`, `qa-fast.yml`, `qa-experience-regression.yml` |
| **DB** | `supabase-pr-db-branch.yml` |
| **P0 protocol** | `p0-protocol.yml` |
| **Ops** | `ops-daily-digest.yml`, `ingestor-scheduled-run.yml`, `state-ttl-enforcer.yml` |

### 3.2 Naming error: `branch-discipline-guard.yml`

The file `.github/workflows/branch-discipline-guard.yml` contains:
```yaml
name: RETIRED_EXTERNAL_SYNC CI Enforcement
```

The file name `branch-discipline-guard.yml` implies it enforces branch naming or discipline rules, but its content is the RETIRED_EXTERNAL_SYNC CI enforcement workflow. This creates confusion for:
- Developers interpreting CI check failures
- The dispatch skill, which references `branch-discipline-guard` by name
- Any CI check status lookup that uses the workflow file name vs the `name:` field

**Fix:** Rename to `RETIRED_EXTERNAL_SYNC-ci-enforcement.yml` or rename the `name:` field to match. The check name visible in GitHub PR status is derived from job names, not the filename — but the discrepancy is still misleading.

### 3.3 Merge Gate is well-designed

The `merge-gate.yml` implementation is coherent:
- T3: auto-pass (no PM verdict required)
- T2: GitHub PR review approval OR pm-verdict/v1 from CODEOWNERS
- T1: pm-verdict/v1 APPROVED + `t1-approved` label
- `governance:pause` kill switch

This aligns exactly with `EXECUTION_TRUTH_MODEL.md` §4. No changes needed here.

### 3.4 `lane:check` is not in `pnpm verify`

`scripts/lane-check.ts` exists as `pnpm lane:check` but is not included in the `pnpm verify` pipeline:

```
verify = sync-check + env:check + lint + type-check + build + test + smart-form + commands
```

If `.lane/` path enforcement is a required gate, `pnpm lane:check` must be added to `pnpm verify` or to a required CI check. Currently it can be run manually but is never required.

### 3.5 Redundant tier checking

Both `tier-label-check.yml` and `merge-gate.yml` check for the presence of a tier label. The merge-gate will block on missing tier; the tier-label-check fires earlier and may produce a second failure. This is acceptable redundancy (fail-fast), but means tier label changes trigger two workflows.

---

## Section 4: Hook Architecture — Verdict

**Status: Advisory only. Not CI-equivalent. PowerShell portability gap exists.**

### 4.1 Hook inventory

| Hook | Trigger | Purpose | Enforcement level |
|---|---|---|---|
| `session-start.sh` | Session start | State reload, git sync | Advisory |
| `tier-c-path-guard.sh` | PreToolUse (Write/Edit) | Block/warn Tier C path writes | **Session-local warning** (exit 2) |
| `commit-msg-linear-check.sh` | PostToolUse (Bash commit) | Verify issue ID in commit message | Advisory |
| `artifact-drift-check.sh` | PreToolUse | Warn if proof artifacts look stale | Advisory |
| `bash-safety-guard.sh` | PreToolUse (Bash) | Block destructive commands | Session-local block |
| `linear-sync-reminder.sh` | PostToolUse | Remind to update Linear state | Advisory |
| `suggest-test-group.sh` | PreToolUse | Suggest test grouping | Advisory |
| `session-summary.sh` | Session end | Summarize session | Advisory |
| `post-compact-reinjector.sh` | PostToolUse | Re-inject state after /clear | Advisory |

### 4.2 Hooks are session-local, not CI-enforced

All 9 hooks fire only within Claude sessions. They have no CI equivalent for:
- Direct git commits by developers
- Codex tool use (Codex does not run Claude hooks)
- GitHub web editor
- VS Code / JetBrains without the Claude plugin

`tier-c-path-guard.sh` is the most critical hook. It covers `supabase/migrations/`, `packages/contracts/src/`, `packages/domain/src/`, `apps/worker/`, `apps/api/src/distribution-service.ts`, `apps/api/src/auth.ts`, `packages/db/src/lifecycle.ts`, `database.types.ts`, `DELEGATION_POLICY.md`, and `proof-coverage-guard.yml`.

Of these, `proof-coverage-guard.yml` and `DELEGATION_POLICY.md` (self-amendment protection) have no CI-level enforcement. The R-level compliance check covers some paths, but the hook's coverage is wider.

**Gap:** There is no CI check that fires if a developer directly pushes to a branch modifying Tier C paths without the hook session. The `file-scope-lock-check.yml` workflow provides partial coverage but operates on manifest locks, not path categories.

### 4.3 PowerShell portability gap

Hooks are written in bash (`#!/usr/bin/env bash`). On Windows, they require Git Bash or WSL. The repo's `WORKTREE_ISOLATION_POLICY.md` uses PowerShell (`.ps1`) for setup scripts. There is no explicit statement about which shell Claude hooks run in on Windows.

The `tier-c-path-guard.sh` uses `grep -qE` and `sed` — standard tools available in Git Bash. However, the `python3 -c` call for JSON parsing requires Python 3 on PATH. Windows environments where Python 3 is not on the Git Bash PATH will silently skip the hook (the `|| echo ""` fallback exits 0 on failure).

**Risk:** On Windows without Python 3 in Git Bash PATH, `tier-c-path-guard.sh` silently passes all writes. This defeats Tier C protection in Claude sessions on this machine.

### 4.4 Hook/lane authority integration gap

Hooks currently operate independently of lane manifests. `tier-c-path-guard.sh` does not check whether an active lane manifest authorizes the write. This means:

- A pre-authorized Runtime lane that has declared `apps/worker/src/foo.ts` in its `file_scope_lock` still triggers the hook warning
- Conversely, an unauthorized write to an unlocked Tier C path and a manifest-authorized write get the same warning

The UTV2-961 design calls for lane-aware hook authorization: allow write if `active manifest authorizes path + Linear issue ID present + proof bundle will capture it`. This integration does not yet exist.

---

## Section 5: Agent and Orchestration Model — Verdict

**Status: Coherent and well-bounded. Ready to extend but not yet scalable.**

### 5.1 Agent inventory

| Agent | File | Role | Scope |
|---|---|---|---|
| `codex-return-reviewer` | `.claude/agents/codex-return-reviewer.md` | Review Codex-returned PRs before merge | PR diff, tier C, tests, commit format |
| `db-proof-reviewer` | `.claude/agents/db-proof-reviewer.md` | Validate T1 evidence bundles + test:db output | T1 proof gate |
| `lane-reconciler` | `.claude/agents/lane-reconciler.md` | Reconcile ghost lanes | Manifest vs Linear vs GitHub drift |
| `pr-risk-reviewer` | `.claude/agents/pr-risk-reviewer.md` | Score PR risk before merge | Tier C, dependencies, test delta, scope |

**Verdict:** Well-scoped. No agent has authority to merge or self-certify Done. The `lane-reconciler` addresses the ghost-lane problem identified in this audit.

### 5.2 Skill inventory

15 skills in `.claude/commands/`:

- Core execution: `dispatch.md`, `dispatch-board.md`, `lane-management.md`, `verification.md`
- Domain: `betting-domain.md`, `outbox-worker.md`, `pick-lifecycle.md`
- Governance: `execution-truth.md`, `code-structure.md`
- Proof: `t1-proof.md`, `db-verify.md`, `verify-pick.md`
- System: `system-state-loader.md`, `three-brain.md`, `systematic-debugging.md`

**Gap:** No skill for `.lane/` contract enforcement (`lane:check`). The dispatch skill does not reference `.lane/lanes/*.yml` in its pre-execution checks.

### 5.3 Lane concurrency caps — current state

| Lane type | Current cap (per LANE_TAXONOMY.md) | Active lanes as of audit |
|---|---|---|
| Runtime | 1 | UTV2-925 (in_review) |
| Migration | 1 (blocks Runtime) | 0 |
| Governance | 3 (distinct sections) | UTV2-955 (started/stale), UTV2-958 (in_review), UTV2-975 (in_progress) |
| Modeling | 1 | 0 |
| Verification | Unlimited (1 per target) | 0 |
| Hygiene | 3 (distinct files) | 0 |

**Observation:** UTV2-955 (`started`, heartbeat 2026-05-15T05:42Z) appears to be a ghost lane. Its file locks (`LANE_TAXONOMY.md`, `LANE_CONCURRENCY_POLICY.md`) are on files already merged to main. The lane reconciler agent should close it.

### 5.4 Worktree policy — codified and correct

`WORKTREE_ISOLATION_POLICY.md` is well-specified and reflects the UTV2-915 incident. The dispatch skill correctly implements the `usesWorktree()` check. The gap is that `.lane/lanes/*.yml` has no concept of worktree constraints — it defines path authority but not execution location. These remain in separate documents.

### 5.5 `ops:reconcile` and `ops:scope-diff` are referenced but do not exist

`EXECUTION_TRUTH_MODEL.md` §5 cites:
- `ops:reconcile` (scheduled) — for heartbeat enforcement, stranded detection
- `ops:scope-diff` — for Codex scope bleed detection

Neither `scripts/ops/reconcile.ts` nor `scripts/ops/scope-diff.ts` exists. These are described as enforcement mechanisms but are not implemented. The `lane-reconciler` agent partially covers the reconcile use case, but it must be manually invoked. A scheduled `ops:reconcile` run does not exist.

---

## Section 6: Convergence Matrix

For every governance subsystem:

| System | Owner | Canonical? | Recommended action |
|---|---|---|---|
| `EXECUTION_TRUTH_MODEL.md` | PM + orchestrator | **Yes — T0** | No change. Keep as the root authority. |
| `LANE_MANIFEST_SPEC.md` | PM + orchestrator | **Yes — T1** | No change. Canonical for manifest schema and lifecycle. |
| `docs/06_status/lanes/*.json` | `ops:lane:start` / `ops:lane:close` | **Yes** | Continue as canonical active lane state. Close ghost UTV2-955. |
| `.claude/lanes.json` | Legacy | **No — superseded** | **Remove.** No new entries since April 2026. Superseded by individual manifests. |
| `docs/governance/LANE_TAXONOMY.md` | Claude/governance | **Yes — policy** | Keep. Authoritative for lane type definitions. Fix path conflict with `.lane/runtime.yml`. |
| `docs/governance/LANE_CONCURRENCY_POLICY.md` | Claude/governance | **Yes — policy** | Keep. Authoritative for concurrency rules. |
| `docs/governance/PROOF_BUNDLE_STANDARD.md` | Claude/governance | **Yes — policy** (in_review UTV2-958) | Keep pending merge. |
| `.lane/lanes/*.yml` | `scripts/lane-contract.ts` | **Partial — mechanical copy** | **Reconcile** with LANE_TAXONOMY.md. Fix runtime/worker conflict. Add docs/governance/** to governance.yml. Wire `pnpm lane:check` into `pnpm verify`. Add missing CI check. |
| `.lane/schema.yml` | `scripts/lane-contract.ts` | **Yes — for `.lane/` scope** | Keep. |
| `.lane/migration-lock.yml` | `scripts/lane-contract.ts` | **Yes — for migration** | Keep. First correct use of `.lane/` system. |
| `.ops/sync.yml` | CI / RETIRED_EXTERNAL_SYNC sync | **Yes — but broken model** | **Restructure** to per-issue files (`.ops/sync/UTV2-NNN.yml`). Single shared mutable file is the root cause of merge conflicts. |
| `.github/workflows/merge-gate.yml` | CI | **Yes** | No change. Well-designed T1/T2/T3 gate. |
| `.github/workflows/branch-discipline-guard.yml` | CI | **Misnamed** | **Rename** to `RETIRED_EXTERNAL_SYNC-ci-enforcement.yml` or fix the `name:` field. |
| `.github/workflows/tier-label-check.yml` | CI | **Yes (redundant with merge-gate)** | Acceptable. Fail-fast redundancy. Keep. |
| `.claude/hooks/tier-c-path-guard.sh` | Session | **Advisory only** | **Harden**: add Python fallback check or rewrite in cross-platform form. Add lane-aware authorization path (UTV2-961 scope). |
| `.claude/agents/` (4 agents) | Orchestrator | **Yes** | Keep. Add agent or skill for `.lane/` contract enforcement. |
| `.claude/commands/` (15 skills) | Orchestrator | **Yes** | Add `lane:check` reference to `/dispatch` pre-execution checks. |
| `scripts/ops/` (50+ scripts) | Orchestrator | **Yes** | Implement `ops:reconcile` and `ops:scope-diff` (currently referenced but missing). |
| `pnpm verify` pipeline | CI / orchestrator | **Yes** | Add `pnpm lane:check` to pipeline after `.lane/` is reconciled. |

---

## Section 7: Stabilization Recommendations

Ordered by urgency and dependency.

### Priority 1 — Fix merge mechanics (blocks all scaling)

**UTV2-961 + UTV2-970 together:**

1. **Replace `.ops/sync.yml` with per-issue files** (`.ops/sync/UTV2-NNN.yml`). Each lane branch touches only its own file. Update RETIRED_EXTERNAL_SYNC CI enforcement to scan `ops/sync/*.yml`. Update `branch-discipline-guard` check to use the new path.

2. **Remove `[skip ci]` from PR branch HEAD commits.** Housekeeping commits (manifest opens, link-pr) must use a lightweight CI path (path-aware workflow short-circuit) not `[skip ci]`. Every branch that needs protected checks must have those checks fire on HEAD.

3. **Make post-merge closeout idempotent and replayable.** `post-merge-lane-close.yml` must handle squash merges, admin merges, and manual `workflow_dispatch` replay. Test against the UTV2-924/931/927 failure cases.

These three changes make lane merges boring. Nothing else should proceed until they are working.

### Priority 2 — Reconcile `.lane/` with existing system

**New sub-issue or part of UTV2-962:**

4. **Fix path conflict:** Update `.lane/lanes/runtime.yml` to allow `apps/worker/**` (matching LANE_TAXONOMY.md).

5. **Fix governance lane gap:** Update `.lane/lanes/governance.yml` to include `docs/governance/**` in `allowed_path_globs`.

6. **Wire `pnpm lane:check` into CI.** Add a required CI check that runs `pnpm lane:check` on every PR. The check should use the lane type derived from the branch name or the manifest.

7. **Update `pnpm verify` to include `lane:check`** after the path conflicts above are resolved.

### Priority 3 — Registry cleanup

**Part of UTV2-962:**

8. **Retire `.claude/lanes.json`.** Archive the file (rename to `.claude/lanes.legacy.json` or delete). Update any tooling that reads it (check via `grep -r "lanes.json" .`). Add a comment in LANE_MANIFEST_SPEC.md noting the supersession.

9. **Close ghost lane UTV2-955.** Branch `claude/utv2-955-lane-taxonomy-execution-contracts` — LANE_TAXONOMY.md is already on main. Run `lane-reconciler` agent or manually close the manifest. Heartbeat is stale (>8h as of audit).

10. **Implement `ops:reconcile`.** The EXECUTION_TRUTH_MODEL.md §7 references this as a scheduled enforcement mechanism for stranded lanes. It does not exist. Add `scripts/ops/reconcile.ts` + scheduled workflow. The `lane-reconciler` agent covers the manual case; `ops:reconcile` covers the automated case.

### Priority 4 — Hook hardening

11. **Lane-aware hook authorization** (UTV2-961 scope): `tier-c-path-guard.sh` should check active manifests before blocking. If the active lane manifest has the path in `file_scope_lock` and the tier is authorized, allow the write and log the authorization.

12. **Cross-platform hook reliability**: Replace `python3 -c "import json"` in `tier-c-path-guard.sh` with a shell-native fallback or require Python 3 in the dev environment prerequisites. Silent fallback to exit 0 defeats Tier C protection.

13. **Rename `branch-discipline-guard.yml`** to `RETIRED_EXTERNAL_SYNC-ci-enforcement.yml` (file rename + update any references to the check name in scripts and docs).

---

## Section 8: Sequencing Recommendations

### UTV2-961 — Fix merge friction in lane governance integration

**Verdict: Execute first. Blocks everything else.**

- Status: Backlog, no tier label
- Recommended tier: T2 (CI/workflow changes, no migration, no write-path change)
- Recommended executor: Claude design → Codex implementation
- Dependencies: None — this is the dependency root
- Sequencing: Must merge before any new lanes are opened that would need to merge into main
- Priority inside UTV2-961: sync.yml restructure first (removes conflict source), then [skip ci] fix, then post-merge closeout

### UTV2-970 — Restructure manifest housekeeping so skip-ci cannot block protected merges

**Verdict: Execute as sub-task within UTV2-961 or immediately after.**

- Status: Backlog, no tier label
- Recommended tier: T2
- Recommended executor: Claude design → Codex implementation
- Dependencies: Can proceed in parallel with UTV2-961 if scope is strictly the `[skip ci]` / CI path change
- Note: This is a focused sub-issue of UTV2-961. If UTV2-961 is dispatched as one unit covering all 6 sub-problems, UTV2-970 should be closed as a sub-task. If dispatched separately, UTV2-970 should merge before UTV2-961 because fixing CI deadlocks unblocks the ability to merge UTV2-961 itself.

### UTV2-962 — Reconcile canonical lane and execution-state registries

**Verdict: Execute after UTV2-961 closes.**

- Status: Backlog, labels: `lane:shared`, `area:tooling`, `area:governance`, `tier:T2`
- Tier: T2 — already labeled correctly
- Recommended executor: Claude (governance judgment required for canonical owner decisions)
- Dependencies: Requires UTV2-961 to have resolved the sync.yml model (otherwise reconciling registries still has the merge friction problem)
- This audit's §1 findings (`.claude/lanes.json` retirement, `.lane/` reconciliation) are the primary input to UTV2-962
- Sequencing: UTV2-961 → UTV2-962 → `.lane/` CI integration

### Internal Agent Operating System project

**Verdict: Hold until UTV2-961 merges.**

The following agent-OS work should not begin until lane merges are boring:
- Automatic lane maximization (raising concurrent lane caps)
- Advanced orchestration rollout (multi-brain dispatch loop)
- Factory.ai integration
- Any new execution registry or agent-routing layer

The governance system has ONE coherent authority model but cannot yet execute governed lanes without manual intervention. Scaling before the merge path is stable will multiply the number of stuck lanes, not the throughput.

**What may proceed now:**
- UTV2-975 (this audit) — docs only, no merge friction risk
- UTV2-958 (Proof Bundle Standard) — docs only, already in_review
- UTV2-925 (dead-letter replay) — T1, awaiting `t1-approved` label
- Design work (specs, contracts) that does not require lane merges

---

## Section 9: Canonical Execution Model

This section defines the single canonical execution model as of 2026-05-15.

### 9.1 Truth hierarchy (unchanged from EXECUTION_TRUTH_MODEL.md)

```
Rank 1: GitHub main (shipped code)
Rank 2: Proof bundle (tied to merge SHA)
Rank 3: Lane manifest docs/06_status/lanes/*.json (active state)
Rank 4: Linear issue state (intent)
Rank 5: Chat / memory / agent claims (context only)
```

### 9.2 Canonical merge model

```
Lane branch ──▶ pnpm verify (required)
            ──▶ pnpm lane:check (required, after §7 Priority 2 fixes)
            ──▶ R-level compliance (required)
            ──▶ PR opened
            ──▶ tier-label-check (CI, required)
            ──▶ merge-gate (CI, required)
                  T3: auto-pass
                  T2: GitHub PR review approval
                  T1: pm-verdict/v1 + t1-approved label
            ──▶ Merge to main
            ──▶ post-merge-lane-close (automated, idempotent)
                  closes manifest
                  resets sync metadata
                  transitions Linear to Done
```

**Known gaps in current state:** post-merge-lane-close is not reliable (§2.3). `pnpm lane:check` not yet in CI (§3.4). sync.yml conflict on every concurrent merge (§2.1).

### 9.3 Canonical lane lifecycle

```
Backlog ──▶ Ready (tier label + AC + file scope declared)
        ──▶ [ops:lane:start] manifest created, branch created, file locks acquired
        ──▶ In Progress (commits landing)
        ──▶ In Review (PR open, CI running)
        ──▶ Merged (PR merged to main)
        ──▶ [ops:truth-check] done gate
        ──▶ Done (manifest closed, Linear transitioned)
```

### 9.4 Canonical authority model

| Authority question | Authoritative source | Non-authoritative |
|---|---|---|
| Is the code shipped? | GitHub main first-parent history | Lane manifest, Linear |
| What is this lane doing right now? | `docs/06_status/lanes/<issue>.json` | `.claude/lanes.json`, session memory |
| Can this lane type write this path? | `docs/governance/LANE_TAXONOMY.md` | `.lane/lanes/*.yml` (until reconciled) |
| Is this issue Done? | `ops:truth-check` exit code 0 | Agent narrative, Linear state alone |
| Who may merge T1? | PM `t1-approved` label + pm-verdict/v1 | Any agent claim |
| What issue does this branch belong to? | `.ops/sync/UTV2-NNN.yml` (target state) | `.ops/sync.yml` (current, broken) |

---

## Appendix A: Findings requiring immediate Linear issues

The following problems were discovered during this audit and require Linear issues if not already tracked:

| Finding | Severity | Existing issue? |
|---|---|---|
| `.lane/lanes/runtime.yml` forbids `apps/worker/**` — conflicts with LANE_TAXONOMY.md | Critical | Part of UTV2-961/962 |
| `.lane/lanes/governance.yml` missing `docs/governance/**` | High | Part of UTV2-962 |
| `.ops/sync.yml` shared mutable conflict source | Critical | UTV2-961 |
| `[skip ci]` deadlock with protected checks | Critical | UTV2-970 |
| `branch-discipline-guard.yml` misnamed | Low | Create new |
| `ops:reconcile` missing but referenced | Medium | Create new |
| `tier-c-path-guard.sh` silent failure on Windows when Python 3 absent | High | Create new |
| UTV2-955 ghost lane (stale manifest, work already merged) | Medium | Use lane-reconciler |
| `pnpm lane:check` not in `pnpm verify` or CI | High | Part of UTV2-962 |

---

*This document is the governance convergence audit deliverable for UTV2-975. It supersedes any prior informal assessment of governance system coherence. Stabilization issues (UTV2-961, UTV2-970, UTV2-962) may cite this document as their requirements source.*
