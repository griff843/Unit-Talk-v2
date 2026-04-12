# Lane Manifest — Specification

**Status:** Canonical, implementation-ready
**Authority:** `EXECUTION_TRUTH_MODEL.md` §2 (Lane Lifecycle)
**Implementer:** Codex-safe after this spec is ratified
**Manifest location:** `docs/06_status/lanes/<UTV2-###>.json`
**Schema file (target):** `docs/05_operations/schemas/lane_manifest_v1.schema.json`

The lane manifest is the **sole authoritative source for active lane state** in Unit Talk V2. Linear and GitHub track intent and shipped truth; the manifest tracks what is *actively happening right now*. A lane without a manifest does not exist.

---

## 1. Purpose

Encode lane execution state in a machine-readable artifact that:

- is the single place agents, CI, and PM look to learn lane status
- enables file-scope locking across concurrent lanes
- enables stranded-lane detection via heartbeats
- provides the input contract for `ops:truth-check`
- replaces lane state previously carried in chat, memory, and Linear comments

The manifest is authoritative for: **what lane exists, where it is working, what it is touching, what it promises to prove, and its current lifecycle state.**

The manifest is **not** authoritative for: shipped code (use `main`), CI outcomes on merge (use GitHub), issue intent or acceptance criteria (use Linear), or completion (use truth-check output).

---

## 2. Lifecycle Rules

| Event | Trigger | State Change | Writer |
|---|---|---|---|
| **Create** | `ops:lane:start <issue>` succeeds | file created, `status: started` | `ops:lane:start` |
| **Heartbeat** | any `ops:*` call for the lane, any commit on the lane branch, or explicit `ops:lane:heartbeat` | `heartbeat_at` updated | any `ops:*` tool |
| **Progress** | first commit pushed | `status: in_progress` | `ops:lane:start` or commit hook |
| **Review** | PR opened and linked | `status: in_review`, `pr_url` set | `ops:lane:link-pr` or auto-detect |
| **Merge** | PR merged into `main` | `status: merged`, `commit_sha` set, `files_changed[]` finalized | reconcile or `ops:lane:close` |
| **Close** | `ops:truth-check` passes | `status: done`, `closed_at` set | `ops:lane:close` |
| **Block** | explicit block or heartbeat timeout | `status: blocked`, `blocked_by` populated | `ops:lane:block` or reconcile |
| **Reopen** | truth-check exit code `4` | `status: reopened`, `reopen_history[]` appended | `ops:truth-check` |
| **Override close** | PM force-close | `status: done`, `override: {reason, by}` set | `ops:lane:close --override` |

**Laws:**
- A manifest file is created **only** by `ops:lane:start`. No manual creation.
- A manifest is never deleted. Closed manifests remain for audit.
- State transitions follow the lifecycle in `EXECUTION_TRUTH_MODEL.md` §2. Illegal transitions are rejected by the writer.
- Concurrent writes are prevented by the file-scope lock mechanism (§6).

---

## 3. Heartbeat Expectations

| Condition | Threshold | Detection | Action |
|---|---|---|---|
| Fresh | `heartbeat_at` < 4h old | n/a | normal |
| Stale | `heartbeat_at` 4–24h old | `ops:reconcile` | flag `stale: true`, appear in digest |
| Stranded | `heartbeat_at` > 24h old | `ops:reconcile` | auto-transition to `blocked` with `blocked_by: ["stranded"]` |
| Orphaned | branch deleted but manifest active | `ops:reconcile` | flag `orphaned: true`, require manual close |

Heartbeat updates are **cheap and frequent**. Every sanctioned `ops:*` call updates it. Agents should not need to think about heartbeats.

Resume from stranded requires `ops:lane:resume <issue_id>`, which re-runs preflight and verifies file-scope locks are still valid.

---

## 4. JSON Schema (v1)

The manifest is a single JSON object. Unknown fields are preserved but not acted upon. Unrecognized `schema_version` values are rejected.

### 4.1 Required Fields

```json
{
  "schema_version": 1,
  "issue_id": "UTV2-###",
  "lane_type": "claude" | "codex-cli" | "codex-cloud",
  "tier": "T1" | "T2" | "T3",
  "worktree_path": "C:/Dev/Unit-Talk-v2-main.worktrees/UTV2-###",
  "branch": "fix/utv2-###-short-slug",
  "base_branch": "main",
  "commit_sha": null | "abc123...",
  "pr_url": null | "https://github.com/...",
  "files_changed": [],
  "file_scope_lock": ["apps/api/src/foo.ts", "packages/domain/src/bar.ts"],
  "expected_proof_paths": ["docs/06_status/proof/UTV2-###/evidence.json"],
  "status": "started" | "in_progress" | "in_review" | "merged" | "done" | "blocked" | "reopened",
  "started_at": "2026-04-11T18:00:00Z",
  "heartbeat_at": "2026-04-11T18:30:00Z",
  "closed_at": null | "2026-04-11T20:00:00Z",
  "blocked_by": [],
  "preflight_token": "sha256:...",
  "created_by": "claude" | "codex-cli" | "pm",
  "truth_check_history": [],
  "reopen_history": []
}
```

### 4.2 Field Semantics

| Field | Type | Required? | Mutable? | Notes |
|---|---|---|---|---|
| `schema_version` | int | yes | no | currently `1` |
| `issue_id` | string | yes | no | must match filename |
| `lane_type` | enum | yes | no | determines merge authority |
| `tier` | enum | yes | no | mirrors Linear label; snapshot at start |
| `worktree_path` | string | yes | no | absolute path |
| `branch` | string | yes | no | must exist at start |
| `base_branch` | string | yes | no | usually `main` |
| `commit_sha` | string\|null | yes | yes | populated at merge |
| `pr_url` | string\|null | yes | yes | populated at review |
| `files_changed` | string[] | yes | yes | finalized at merge from GitHub diff |
| `file_scope_lock` | string[] | yes | no | declared at start; see §6 |
| `expected_proof_paths` | string[] | yes | no | declared at start per tier |
| `status` | enum | yes | yes | lifecycle state |
| `started_at` | ISO-8601 | yes | no | |
| `heartbeat_at` | ISO-8601 | yes | yes | updated often |
| `closed_at` | ISO-8601\|null | yes | yes | set by close or reopen-unset |
| `blocked_by` | string[] | yes | yes | issue IDs, reason codes, or both |
| `preflight_token` | string | yes | no | proves preflight passed pre-start |
| `created_by` | enum | yes | no | identity of lane creator |
| `truth_check_history` | array | yes | yes | append-only; each entry is a truth-check result |
| `reopen_history` | array | yes | yes | append-only; each entry `{timestamp, reasons[], detected_by}` |

### 4.3 Optional Fields

| Field | Type | Purpose |
|---|---|---|
| `stale` | bool | set by reconcile when heartbeat 4–24h old |
| `orphaned` | bool | set by reconcile when branch deleted |
| `override` | `{reason, by, at}` | set on PM force-close |
| `parent_lane` | string | for sub-lanes under a plan PR (future) |
| `task_packet_hash` | string | for Codex lanes, hash of dispatched packet for scope-diff |
| `notes` | string | human-readable commentary, non-authoritative |

Optional fields are additive. They do not change truth-check behavior unless explicitly referenced by spec.

### 4.4 `truth_check_history[]` entry shape

```json
{
  "checked_at": "2026-04-11T20:00:00Z",
  "verdict": "pass" | "fail" | "reopen",
  "merge_sha": "abc123...",
  "failures": ["G4"],
  "runner": "ops:lane:close" | "ops:reconcile" | "manual"
}
```

---

## 5. Relationship to Linear and GitHub

| Source | Leads On | Follows From |
|---|---|---|
| **Manifest** | `status`, `heartbeat_at`, `file_scope_lock`, `expected_proof_paths`, `truth_check_history` | — |
| **Linear** | issue intent, acceptance criteria, tier label, ownership | manifest writes Linear on start and close |
| **GitHub** | `commit_sha`, `pr_url`, `files_changed`, CI outcomes | manifest pulls from GitHub on merge and close |

Reconciliation rules:

- If Linear says Done but manifest is not closed → manifest wins, Linear is corrected by `ops:reconcile`.
- If GitHub says merged but manifest is `in_review` → reconcile transitions manifest to `merged`.
- If manifest is `done` but Linear is not → reconcile transitions Linear to Done (this path is only reached via `ops:lane:close`, so it is normally impossible).
- If manifest does not exist but Linear is In Progress → Linear is stale; reconcile transitions Linear to Ready and notifies PM.

**The manifest is never patched from Linear.** Linear is patched from the manifest. This is the enforcement of §1 authority.

---

## 6. File-Scope Lock Behavior

`file_scope_lock` declares the set of files the lane claims exclusive write access to. It is declared at `ops:lane:start` and immutable for the life of the lane.

Rules:

- `ops:lane:start` scans all active manifests (`status ∈ {started, in_progress, in_review, blocked, reopened}`) and refuses if any `file_scope_lock` entries overlap with the incoming lane's declared locks.
- Overlap is computed on glob-expanded absolute paths. `apps/api/src/**` overlaps with `apps/api/src/foo.ts`.
- Overlap refusal is hard; the only resolution is to wait for the conflicting lane to close, or to redefine scope.
- A lane may widen its declared scope only by explicit `ops:lane:relock` which re-runs the overlap check.
- Locks are released on `status ∈ {done}`. Blocked and reopened lanes retain their locks.

Locks are **advisory at the filesystem level** but **enforced at lane-start**. A rogue agent that ignores the manifest can still edit a locked file; the mechanism protects sanctioned `ops:*` flows, not misuse.

A pre-commit hook (future) may promote locks to hard enforcement.

---

## 7. Stranded Lane Detection

Handled by `ops:reconcile` on a cron schedule. Also runs as part of `ops:lane:start` to clean up before creating a new lane.

Detection:

- Stale: 4h < `now - heartbeat_at` ≤ 24h → flag `stale: true`.
- Stranded: `now - heartbeat_at` > 24h → transition to `blocked`, append `blocked_by: ["stranded"]`, append note to `truth_check_history` as `{verdict: "fail", failures: ["stranded"], runner: "ops:reconcile"}`.
- Orphaned: branch not present locally or on origin → flag `orphaned: true`, require `ops:lane:resume --force-orphan` or `ops:lane:close --abandon`.

Stranded detection never merges code, never modifies branches, and never touches Linear outside of marking the issue Blocked with a reason.

---

## 8. Enforcement Placement

| Concern | Mechanism |
|---|---|
| Manifest exists | `ops:lane:start` creates; `ops:truth-check` requires |
| Schema validity | `lane_manifest_v1.schema.json` + validator invoked on every write |
| Append-only history fields | validator + writer refuses overwrites |
| File-scope locks | `ops:lane:start` overlap check |
| Heartbeat freshness | `ops:reconcile` scheduled |
| Status legality | writer refuses illegal transitions |
| One-manifest-per-issue | filename uniqueness; second `ops:lane:start` on same issue refuses unless previous manifest is `done` |

No prose enforces these. Scripts enforce these. Prose only references the scripts.

---

## 9. What the Manifest Is Authoritative For

- Whether a lane exists
- Which branch, worktree, and files a lane owns
- Current lifecycle state between Ready and Done
- Heartbeat freshness and stranded detection
- File-scope locks
- Truth-check history
- Reopen history

## 10. What the Manifest Is **Not** Authoritative For

- Shipped code (→ `main`)
- CI results on merge (→ GitHub)
- Issue intent, acceptance criteria, tier definition (→ Linear + `EXECUTION_TRUTH_MODEL.md`)
- Completion (→ `ops:truth-check` output, which is then recorded *into* the manifest)
- Proof content validity (→ `evidence:validate` + `ops:truth-check`)
- Code review outcomes (→ GitHub PR review)

The manifest points to these sources; it does not replace them.

---

## 11. Versioning

- `schema_version: 1` is the only supported value at launch.
- Schema changes require a new version number. The validator must reject unknown versions.
- Migration between versions is a separate, explicit step (`ops:lane:migrate-manifest`), never implicit.
- Closed manifests are never migrated — they are frozen at the version they were closed on.

---

## 12. Non-Goals

- Manifest does not store narrative progress notes (use Linear comments).
- Manifest does not store test output (use proof files).
- Manifest does not replace Linear or GitHub — it supplements them at a higher rank for *active* state only.
- Manifest does not enforce policy by itself; scripts and CI do, using the manifest as input.
