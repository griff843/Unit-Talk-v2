# Lane and Execution-State Registry Reconciliation

**Status:** Ratified  
**Effective:** 2026-05-15 (UTV2-962)  
**Purpose:** Canonical map of every source of lane/execution truth in Unit Talk V2 before agent-operating-system scaling.

---

## 1. Problem statement

Multiple artifacts claim to track lane or execution state. Without a declared canonical owner for each data category, a second registry can be created accidentally, producing contradictory truth and agent routing errors.

This document:
- inventories every source found at time of audit
- declares a canonical owner per data category
- identifies stale / duplicate / non-canonical sources
- describes a cleanup plan for each
- defines the single read model agents must consume

---

## 2. Sources found at audit (2026-05-15)

### 2.1 `docs/06_status/lanes/*.json` — **CANONICAL active-lane registry**

158 manifests at audit. Per `LANE_MANIFEST_SPEC.md §1`, this is the **sole authoritative source for active lane state**. It is written by `ops:lane:start`, updated by any `ops:*` call, and read by `ops:truth-check` and `ops:reconcile`.

Status breakdown at audit:

| Status | Count | Notes |
|--------|-------|-------|
| `done` | 113 | Terminal — correct |
| `merged` | 11 | Terminal — correct |
| `started` | 16 | See §4 — 14 are stranded (>24h heartbeat) |
| `in_review` | 3 | See §4 — 2 are merged PRs with no closeout |
| `closed` | 13 | Non-canonical — see §3 |
| `abandoned` | 1 | Non-canonical — see §3 |
| `cancelled` | 1 | Non-canonical — see §3 |

**Drift identified:**
- `UTV2-961`: status `in_review`, but PR #681 merged at `3922ec84`. Post-merge automation did not fire because UTV2-961 *was the fix* for post-merge automation. Fixed by this lane (§5).
- `UTV2-958`: status `in_review`, but PR #678 merged at `955f7fc9`. Fix: batch cleanup pass (§4).
- 13 `closed` manifests: non-canonical terminal state. Spec defines `done` as terminal; `closed` predates the spec. Fix: batch normalize (§4).

---

### 2.2 `.claude/lanes.json` — **LEGACY — DEPRECATED**

5 entries (UTV2-450, 452, 497, 510, 511), all `done` or `merged`. Last updated 2026-04-08. A separate cleanup commit (`395872a5 chore(ops): retire legacy .claude/lanes.json path — final cleanup`) was already merged but the file remains. The file contains duplicate state for entries already in `docs/06_status/lanes/*.json`.

**Canonical owner for this data:** `docs/06_status/lanes/*.json`.  
**Action:** File can remain as a historical artifact but must not be written to. Any tool or script that reads `.claude/lanes.json` for active state must be migrated to `docs/06_status/lanes/*.json`.

---

### 2.3 `.lane/lanes/*.yml` — **LANE-TYPE PATH CONFIGURATION — not execution state**

8 files (governance, runtime, modeling, verification, hygiene, migration, delivery-ui, data-canonical) plus `schema.yml`. These are **path-scope constraint configs** per lane type — they declare `allowed_path_globs`, `forbidden_path_globs`, `required_proof_artifacts`, and `ci_requirements` per lane type.

These are **not an execution registry**. They do not track active lanes, heartbeats, or issue-to-branch mappings. They define policy, not state.

**Canonical owner:** No overlap with `docs/06_status/lanes/*.json`. These configs are authoritative for "what paths may a `runtime` lane touch?" — the manifests are authoritative for "is UTV2-962 currently active?".

**No action required.** These files serve a distinct purpose.

---

### 2.4 `.ops/sync/UTV2-{number}.yml` — **LANE-OPEN SYNC METADATA — transient**

Created at lane-open by `scripts/ops/lane-start.ts`. Deleted by `post-merge-lane-close.yml` after merge. Checked by `branch-discipline-guard.yml` CI on every PR.

These files are **transient lane-open artifacts**, not a registry. They exist only on the branch during an active lane's lifecycle.

**Drift identified at audit:**
- `.ops/sync/UTV2-961.yml` — still present on main after PR #681 merged. Post-merge automation did not fire for UTV2-961.
- `.ops/sync/UTV2-970.yml` — still present on main after UTV2-970 was manually closed in this session without deleting the file.

**Action:** Both deleted in this lane (§5).

---

### 2.5 `.ops/sync.yml` (shared, legacy) — **NEUTRAL PERMANENTLY**

Per UTV2-961 policy (`MANIFEST_HOUSEKEEPING_POLICY.md`), `.ops/sync.yml` stays permanently neutral (`issues: []`) on main. No branch ever mutates it. The per-issue model (§2.4) replaced it.

**No action required.** File stays neutral.

---

### 2.6 Linear issues and projects — **WORKFLOW INTENT**

Linear tracks issue title, description, acceptance criteria, tier label, ownership, state (Ready/In Claude/Done). Linear is **rank 4** in the truth hierarchy — it follows the manifest, not the other way around. `ops:reconcile` patches Linear from the manifest, never the reverse.

Linear is authoritative for: what a lane should do, who owns it, and what tier it is.  
Linear is **not** authoritative for: whether the lane is currently active, which branch it is on, or what files it is touching.

---

### 2.7 GitHub branches, PRs, and merge SHAs — **SHIPPED CODE TRUTH**

GitHub is **rank 1** in the truth hierarchy. Shipped code on `main`, merge SHAs, CI outcomes on merge, and `files_changed` diffs are all authoritative from GitHub.

A PR being merged on GitHub is the trigger that should transition a manifest from `in_review` → `merged` → `done`. This is the gap that caused UTV2-961 and UTV2-958 drift.

---

### 2.8 Agent memory and chat claims — **NEVER AUTHORITATIVE**

Per `EXECUTION_TRUTH_MODEL.md` §1, agent claims are rank 5 — context only. They never override ranks 1–4.

---

## 3. Non-canonical status values

The spec (`LANE_MANIFEST_SPEC.md §4.1`) defines these valid status values:

```
"started" | "in_progress" | "in_review" | "merged" | "done" | "blocked" | "reopened"
```

Manifests using non-canonical values found at audit:

| Status | Count | Issues | Correct mapping |
|--------|-------|--------|-----------------|
| `closed` | 13 | UTV2-588, 619, 628, 631, 654, 655, 712, 715, 719, 746, 749, 862, 877 | `done` |
| `abandoned` | 1 | UTV2-818 | `done` (work was abandoned; lane is closed) |
| `cancelled` | 1 | UTV2-863 | `done` (work was cancelled; lane is closed) |

**Cleanup action:** A batch normalization script (`scripts/ops/normalize-manifest-statuses.ts`) should be run to set all 15 manifests to `done`. This does not require individual truth-check passes — these are all pre-spec manifests that predate the formal status enum. The cleanup is tracked as a follow-on task.

---

## 4. Stranded manifests

Per `LANE_MANIFEST_SPEC.md §7`, manifests with `heartbeat_at` > 24h old and status in `{started, in_progress, in_review, blocked, reopened}` should be transitioned to `blocked` with `blocked_by: ["stranded"]`.

Stranded manifests at audit (all > 24h, most > 300h):

| Issue | Status | Age (hours) | Branch |
|-------|--------|-------------|--------|
| UTV2-768 | started | 347 | claude/utv2-768-grading-alias-fix |
| UTV2-771 | started | 299 | claude/utv2-771-provider-offer-current-identity-contract |
| UTV2-776 | started | 299 | codex/utv2-776-supabase-hetzner-comparison-mode |
| UTV2-778 | started | 299 | codex/utv2-778-disk-growth-alerts |
| UTV2-779 | started | 299 | claude/utv2-779-postgres-version-decision |
| UTV2-782 | in_review | 358 | claude/utv2-782-walpitr-restore-proof |
| UTV2-785 | started | 299 | claude/utv2-785-architecture-scope-lock |
| UTV2-786 | started | 328 | claude/utv2-786-provisioning-checklist |
| UTV2-788 | started | 299 | claude/utv2-788-migration-runbook |
| UTV2-789 | started | 358 | claude/utv2-789-least-privilege-postgres-roles |
| UTV2-790 | started | 299 | codex/utv2-790-secrets-management-policy |
| UTV2-799 | started | 299 | codex/utv2-799-backup-rpo-rto-policy |
| UTV2-805 | started | 347 | codex/utv2-805-delivery-adapter-env-log |
| UTV2-807 | started | 347 | codex/utv2-807-watchdog-bounds |
| UTV2-809 | started | 340 | codex/utv2-809-clv-null-guard |

Additionally:
- **UTV2-958**: `in_review` (9h) but PR #678 merged at `955f7fc9` — needs closeout transition to `done`.
- **UTV2-955**: `started` (10h) — within stale window; not yet stranded. Monitor.

**Cleanup action:** Run `ops:reconcile` or a batch script to transition all 15 stranded manifests to `blocked` with `blocked_by: ["stranded"]`. Then PM triage: each stranded issue should be re-evaluated in Linear — re-dispatch, cancel, or mark done if the work landed via a different path.

UTV2-958 requires a targeted closeout (not just stranded transition): update manifest to `done` with merge SHA `955f7fc9`.

---

## 5. Changes applied in this lane

### 5.1 UTV2-961 manifest — `in_review` → `done`

Root cause: UTV2-961 was the PR that implemented the new post-merge automation. When it merged, the automation had not yet taken effect for its own merge event. Manual closeout applied.

Merge SHA: `3922ec84`  
Files touched: `scripts/ops/*.ts`, `scripts/lane-contract.ts`, `.github/workflows/*.yml`, `.claude/hooks/tier-c-path-guard.sh`, `.claude/commands/dispatch.md`, `.ops/sync/UTV2-961.yml`

### 5.2 Stale sync files deleted

- `.ops/sync/UTV2-961.yml` — deleted (lane closed)
- `.ops/sync/UTV2-970.yml` — deleted (UTV2-970 was manually closed in the same session but sync file was not removed)

---

## 6. Canonical read model for agents

When an agent needs to know the state of a lane, it must read in this order:

| Question | Source | How to read |
|----------|--------|-------------|
| Does this lane exist? | `docs/06_status/lanes/UTV2-NNN.json` | File existence |
| What is the lane's current status? | `docs/06_status/lanes/UTV2-NNN.json` → `status` | Read manifest |
| Which files does this lane own? | `docs/06_status/lanes/UTV2-NNN.json` → `file_scope_lock` | Read manifest |
| What branch is it on? | `docs/06_status/lanes/UTV2-NNN.json` → `branch` | Read manifest |
| What PR was opened? | `docs/06_status/lanes/UTV2-NNN.json` → `pr_url` | Read manifest |
| What is the merge SHA? | `docs/06_status/lanes/UTV2-NNN.json` → `commit_sha` | Read manifest |
| What are the acceptance criteria? | Linear `UTV2-NNN` | MCP `get_issue` |
| Did CI pass on merge? | GitHub PR `pr_url` | `gh pr view` |
| What paths may this lane_type touch? | `.lane/lanes/{lane_type}.yml` | Read config file |

**Never read `.claude/lanes.json` for active state.** It is a historical artifact.  
**Never read Linear for merge SHAs.** Linear does not store merge SHAs.  
**Never read agent memory or chat for lane status.** Always verify against the manifest.

---

## 7. Rules to prevent new drift

1. **`post-merge-lane-close.yml` must fire on every merge.** The actor guard (`github.actor != 'github-actions[bot]'`) prevents loops. Admin merges should trigger the workflow via `workflow_dispatch` if automation does not fire.
2. **No new registry file.** Before creating any file that tracks lane/execution state, map it to the existing truth sources in this document. If it overlaps with `docs/06_status/lanes/*.json`, it is a duplicate.
3. **`ops:reconcile` should run on a schedule.** It detects stale, stranded, and orphaned manifests automatically. Currently triggered manually; a cron job would prevent long-lived drift.
4. **`.claude/lanes.json` must not be written to.** Any script that updates it should be migrated to `scripts/ops/lane-start.ts` + `docs/06_status/lanes/`.
5. **Status values must be from the canonical enum.** `closed`, `abandoned`, `cancelled` are non-canonical. Use `done` for all terminal states; document the reason in a `notes` field if needed.

---

## 8. Follow-on actions

| Action | Owner | Priority |
|--------|-------|----------|
| Run `ops:reconcile` to transition 15 stranded manifests to `blocked` | PM / Claude | High |
| Fix UTV2-958 manifest: `in_review` → `done` with SHA `955f7fc9` | Claude | High |
| Normalize 15 `closed`/`abandoned`/`cancelled` manifests to `done` | Script / Claude | Medium |
| Wire `ops:reconcile` on a cron schedule | Claude | Medium |
| Remove `.claude/lanes.json` write path from any remaining scripts | Claude | Low |

---

## Canonical references

- `docs/05_operations/LANE_MANIFEST_SPEC.md` — manifest lifecycle, schema, authority model
- `docs/05_operations/EXECUTION_TRUTH_MODEL.md` — truth hierarchy (ranks 1–5)
- `docs/governance/MANIFEST_HOUSEKEEPING_POLICY.md` — `[skip ci]` policy, per-issue sync model
- `.lane/lanes/*.yml` — lane-type path configs (not execution state)
- UTV2-961 — post-merge automation fix, per-issue sync files, actor guard
- UTV2-970 — `[skip ci]` CI deadlock fix, housekeeping policy doc
