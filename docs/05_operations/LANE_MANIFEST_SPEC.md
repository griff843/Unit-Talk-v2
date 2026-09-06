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
| **Create** | `ops:lane-start <issue>` succeeds | file created, `status: started` | `ops:lane-start` |
| **Heartbeat** | any `ops:*` call for the lane, any commit on the lane branch, or explicit `ops:lane:heartbeat` | `heartbeat_at` updated | any `ops:*` tool |
| **Progress** | first commit pushed | `status: in_progress` | `ops:lane-start` or commit hook |
| **Review** | PR opened and linked | `status: in_review`, `pr_url` set | `ops:lane:link-pr` or auto-detect |
| **Merge** | PR merged into `main` | `status: merged`, `commit_sha` set, `files_changed[]` finalized | reconcile or `ops:lane-close` |
| **Close** | `ops:truth-check` passes | `status: done`, `closed_at` set | `ops:lane-close` |
| **Block** | explicit block or heartbeat timeout | `status: blocked`, `blocked_by` populated | `ops:lane:block` or reconcile |
| **Reopen** | truth-check exit code `4` | `status: reopened`, `reopen_history[]` appended | `ops:truth-check` |

**Laws:**
- A manifest file is created **only** by `ops:lane-start`. No manual creation.
- A manifest is never deleted. Closed manifests remain for audit.
- State transitions follow the lifecycle in `EXECUTION_TRUTH_MODEL.md` §2. Illegal transitions are rejected by the writer.
- Concurrent writes are prevented by the file-scope lock mechanism (§6).
- There is no override close transition. Failed closeout conditions require a scoped repair lane and normal PR; they cannot be bypassed in `ops:lane-close`.

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
  "lane_type": "runtime" | "modeling" | "verification" | "hygiene" | "migration" | "governance" | "delivery-ui" | "data-canonical",
  "tier": "T1" | "T2" | "T3",
  "worktree_path": "/home/griff843/code/Unit-Talk-v2/.out/worktrees/UTV2-###",
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
| `issue_id` | string | yes | no | must match filename. Repo-owned work identity: `UTV2-###` **or** `WORK-###` (see §17) |
| `tracker_ref` | string\|null | no | no | optional tracker key (`UTV2-###` / `UNI-###`); explicit `null` declares the lane has no tracker issue; absent means unstated (see §17) |
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
  "runner": "ops:lane-close" | "ops:reconcile" | "manual"
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
- If manifest is `done` but Linear is not → reconcile transitions Linear to Done (this path is only reached via `ops:lane-close`, so it is normally impossible).
- If manifest does not exist but Linear is In Progress → Linear is stale; reconcile transitions Linear to Ready and notifies PM.

**The manifest is never patched from Linear.** Linear is patched from the manifest. This is the enforcement of §1 authority.

---

## 6. File-Scope Lock Behavior

`file_scope_lock` declares the set of files the lane claims exclusive write access to. It is declared at `ops:lane-start`. It can never be widened for the life of the lane, and can be narrowed only through the audited release path in §6.1.

Rules:

- `ops:lane-start` scans all active manifests (`status ∈ {started, in_progress, in_review, blocked, reopened}`) and refuses if any `file_scope_lock` entries overlap with the incoming lane's declared locks.
- Overlap is computed on glob-expanded absolute paths. `apps/api/src/**` overlaps with `apps/api/src/foo.ts`.
- Overlap refusal is hard. The resolutions are: wait for the conflicting lane to close, or have the conflicting lane **release** the contended path if it is not actually using it (§6.1).
- **A lane can never widen its declared scope.** Widening requires an externally authored, GitHub-attested `scope-override/v1` PR comment (UTV2-1521), evaluated per-PR by `scripts/ci/file-scope-guard.ts`; it never comes from an edit to the manifest itself. There is no command that widens a lock.
- Locks are released on `status ∈ {done}`. Blocked and reopened lanes retain their locks.

Locks are **advisory at the filesystem level** but **enforced at lane-start**. A rogue agent that ignores the manifest can still edit a locked file; the mechanism protects sanctioned `ops:*` flows, not misuse.

A pre-commit hook (future) may promote locks to hard enforcement.

### 6.1 Audited scope release (UTV2-1762)

**Correction to an earlier version of this document.** Until UTV2-1762 this section said a lane "may widen its declared scope only by explicit `ops:lane:relock` which re-runs the overlap check". No such command was ever implemented — `relock` matched nothing in `scripts/`, `package.json`, or `.github/workflows/`. The sentence described a mechanism that did not exist, and it described the wrong operation besides: conflict resolution needs *narrowing*, not widening. Do not read the old text as history; nothing was removed, because nothing was ever there.

The consequence was real. A lane that declared a path at lane-start and then never touched it held that path against every other lane until it reached `done` — and §17 already records what that costs when the holder cannot mechanically close. The only escape anyone had found was to falsify the historical `files_changed` record, which was correctly rejected (PR #1288).

`ops:lane-manifest scope-release` is the honest mechanism. It is **removal-only**:

```bash
pnpm ops:lane-manifest -- scope-release UTV2-1729 \
  --pr 1436 \
  --expected-head-sha <exact PR head SHA> \
  --expected-lock-hash <sha256 of the pre-change file_scope_lock> \
  --release-path scripts/ops/truth-check-lib.ts \
  --release-path scripts/ops/truth-check-lib.test.ts \
  --actor griff843 \
  --reason "never touched by PR #1436; blocks UTV2-1759" \
  --json
```

It must run **in the target lane's own worktree, on the target lane's own branch**. Running it from the main control checkout is refused.

Every argument is mandatory because the operation's whole value is that the operator restates what they believe to be true and the tool refuses if live state disagrees. It refuses unless **all** of the following hold, and it collects every refusal before returning, so a partial failure writes nothing:

| Refusal | Condition |
|---|---|
| `not_in_lane_worktree` / `branch_mismatch` | not running in the lane's own worktree and branch |
| `issue_mismatch` / `pr_url_mismatch` | the manifest's identity does not match the request |
| `manifest_lane_inactive` | the lane holds no active scope lock, so there is nothing to release |
| `pr_number_mismatch` / `pr_not_open` / `head_sha_mismatch` | GitHub does not report the expected open PR at the exact expected head |
| `lock_hash_mismatch` | `file_scope_lock` changed since the operator inspected it |
| `path_not_in_lock` | a named path is not already an exact lock entry — this is what makes widening and replacement unrepresentable |
| `path_in_pr_diff` | the lane actually changed the path in this PR |
| `path_in_staged_work` / `path_in_unstaged_work` / `path_in_untracked_work` / `path_in_unpushed_work` | the lane is still working on the path locally |
| `concurrent_lane_dependency` | another active lane already declares the path in its own `file_scope_lock` |
| `empty_resulting_lock` | the release would leave the lock empty |
| `no_release_paths` / `duplicate_release_path` | the request itself is malformed |
| `unexpected_field_mutation` | the release would have altered any field other than `file_scope_lock` and `scope_release_history` |
| `manifest_invalid_after_release` | the resulting manifest would not validate |

On success it appends one `scope_release_history` entry — timestamp, actor, reason, PR number and URL, exact head SHA, previous and resulting lock hashes, the exact released paths, and the verification results — and narrows `file_scope_lock`. It changes nothing else: `files_changed`, issue identity, `status`, `commit_sha`, `pr_url`, proof verdicts, and merge state are all byte-identical across a release, enforced as a post-condition on the value about to be written rather than by an enumeration of forbidden fields.

`scope_release_history` is append-only and hash-chained: each entry's `previous_lock_hash` must equal the prior entry's `resulting_lock_hash`, and the last entry's `resulting_lock_hash` must equal the hash of the manifest's current `file_scope_lock`. `validateManifest` enforces the chain, so a lock edited outside this command — or an entry describing a lock state the manifest does not hold — fails closed.

`scripts/ci/file-scope-guard.ts` honours an audited narrowing from the PR's own head, which is the one manifest-sourced scope change it trusts. Narrowing is safe from that source in a way widening is not: widening grants the PR permissions it did not have, while narrowing only removes the lane's own permissions and releases its hold on other lanes. A PR cannot launder a violation by narrowing — dropping a path makes the guard **stricter** about that path. Anything short of a fully audited, correctly chained narrowing leaves the base-branch baseline in force, so unaudited manifest edits stay inert.

**A released path is not re-acquirable by editing the manifest.** After a release the lane fails its own scope guard if it touches that path again; re-acquiring it requires a new lane.

---

## 7. Stranded Lane Detection

Handled by `ops:reconcile` on a cron schedule. Also runs as part of `ops:lane-start` to clean up before creating a new lane.

Detection:

- Stale: 4h < `now - heartbeat_at` ≤ 24h → flag `stale: true`.
- Stranded: `now - heartbeat_at` > 24h → transition to `blocked`, append `blocked_by: ["stranded"]`, append note to `truth_check_history` as `{verdict: "fail", failures: ["stranded"], runner: "ops:reconcile"}`.
- Orphaned: branch not present locally or on origin → flag `orphaned: true`, require `ops:lane:resume --force-orphan` or `ops:lane-close --abandon`.

Stranded detection never merges code, never modifies branches, and never touches Linear outside of marking the issue Blocked with a reason.

---

## 8. Enforcement Placement

| Concern | Mechanism |
|---|---|
| Manifest exists | `ops:lane-start` creates; `ops:truth-check` requires |
| Schema validity | `lane_manifest_v1.schema.json` + validator invoked on every write |
| Append-only history fields | validator + writer refuses overwrites |
| File-scope locks | `ops:lane-start` overlap check |
| Heartbeat freshness | `ops:reconcile` scheduled |
| Status legality | writer refuses illegal transitions |
| One-manifest-per-issue | filename uniqueness; second `ops:lane-start` on same issue refuses unless previous manifest is `done` |

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

---

## 14. Lane type selection for test-correction work (ops finding 2026-05-29)

**Finding:** Codex defaults to `lane_type: verification` for any test-correction work and names proof files `verification.log`. Both break CI.

**`lane_type: verification` does not permit `apps/api/src/**`** (except `database-smoke.test.ts`). The lane-authority check rejects all other `apps/api/src/` files with `outside_allowed_paths`. Correct type for `apps/api/src/**` changes is `lane_type: runtime`.

**`verification.log` is invisible to the runtime-verifier-gate.** The gate (`scripts/ops/runtime-verifier-gate.ts`) only scans files ending in `.md`. A `verification.log` file is silently skipped — the gate fails with "No runtime-verification file found." even though the file exists. Proof files must be `.md`.

**Required proof file shape for `runtime` lanes:**
- Filename: must contain `verification` or `runtime` (e.g. `verification.md`)
- Extension: `.md` — not `.log`, not `.txt`
- Content: must include a `## Verification` section header (not `## Commands`)
- Content: must mention `pnpm type-check` and `pnpm test` explicitly (checked by P12)
- Content: must include the merge SHA after merge (P3/C4 checks)

**Checklist when a Codex lane touches `apps/api/src/**`:**
1. Confirm `lane_type: runtime` in the manifest (not `verification`)
2. Rename any `verification.log` → `verification.md`
3. Ensure `## Verification` header in the proof file (not `## Commands`)
4. Update `expected_proof_paths` and `.ops/sync/UTV2-###.yml` `proofs:` to reference `.md`

## 13. Manifest housekeeping CI policy

Manifest commits (lane-open, PR-open, lane-close) must not use `[skip ci]` on PR branches. The `[skip ci]` tag suppresses all CI workflows, which prevents required branch-protection checks from running and deadlocks the merge without admin override.

**Canonical policy:** `docs/governance/MANIFEST_HOUSEKEEPING_POLICY.md`

Key rules:
- Lane-open commit (`chore(lanes): UTV2-NNN lane manifest and sync metadata`) — no `[skip ci]`, always followed by implementation commits
- Post-merge closeout on main uses actor guard (`github.actor != 'github-actions[bot]'`) instead of `[skip ci]` to prevent push loops
- Per-issue sync files (`.ops/sync/UTV2-NNN.yml`) replace shared `.ops/sync.yml` mutation, eliminating rebase conflicts
- Manifest-only PRs should carry `tier:T3` so `merge-gate.yml` auto-passes

## 15. Codex model-routing compatibility (UTV2-1526)

Optional field `model_routing` (schema: `docs/05_operations/schemas/lane_manifest_v1.schema.json`) records the deterministic Codex model/reasoning-effort decision three-brain made for a Codex lane:

```json
{
  "model_routing": {
    "profile": "codex-terra-medium",
    "model": "gpt-5.6-terra",
    "reasoning_effort": "medium",
    "selected_by": "three-brain" | "manual-override",
    "policy_version": "1.0.0",
    "legacy_resolved": false,
    "override": { "authorized_by": "griff", "reason": "..." }
  }
}
```

Canonical policy (concrete model IDs, reasoning efforts, enabled/disabled, permitted tiers, PM-authorization requirement): `docs/05_operations/policies/codex-model-routing.json`. This spec never duplicates that mapping.

**Who writes it:** `ops:lane-start` only, at manifest creation, via `scripts/ops/model-routing.ts#resolveModelProfile` — never a later `update`. Required (creation fails without it) for any lane whose `executor` is `codex-cli` or `codex-cloud`. Forbidden (creation fails if present) for `executor: claude`. `validateManifest` independently rejects `model_routing` on a non-Codex `executor` on every write, defending against a hand-edited manifest, not just the creation-time guard.

**Compatibility cutoff:** there is no `schema_version` bump for this field — `schema_version` stays `1`. The cutoff is the field's *presence*. Manifests created by `ops:lane-start` after this field shipped always carry `model_routing`. Manifests created before it simply lack the field, and are never retroactively rewritten to add it — `writeManifest`/`updateManifest` never synthesize a missing `model_routing` for an existing manifest.

**Legacy resolution (execution-time only):** `scripts/ops/codex-exec.ts` detects a missing `model_routing` at the moment it is about to invoke Codex, resolves the policy's documented `legacy_compatibility.default_profile` (`codex-terra-medium`), prints a visible `stderr` warning, and records `legacy_compatibility_used: true` in that run's evidence (`docs/06_status/proof/<issue>/model-routing.json`) and in its own JSON result. This resolution is scoped to that single execution — it is never written back into the manifest file.

**Fail-closed conditions** (creation or execution refuses to proceed): unknown profile, disabled profile, profile not permitted for the lane's tier, missing/invalid manual-override authority+reason on a profile that requires one, manifest's `model`/`reasoning_effort` no longer matching what current policy defines for that profile (drift/tamper), and manifest `model_routing.policy_version` not matching the currently loaded policy's version.

A `model_routing` decision — including any manual override — never implies merge, scope, or tier authority. It only selects which Codex model and reasoning effort execute a lane whose tier, scope, and merge gates were already satisfied independently.

## 16. Verification-lane target (UTV2-1533)

Optional field `verification_target` (schema: `docs/05_operations/schemas/lane_manifest_v1.schema.json`) records the UTV2-### issue a `lane_type: "verification"` lane produces proof for. There is no reliable existing field to derive this from: a verification lane's own `issue_id` is its own tracking issue, not necessarily the issue it verifies, and `file_scope_lock` (test files, `docs/06_status/proof/**`) does not reliably encode a target `UTV2-###` in the path.

```json
{ "verification_target": "UTV2-1327" }
```

**Who writes it:** `ops:lane-start` only, at manifest creation, via the `--verification-target <UTV2-###>` CLI flag — never a later `update`. Required (creation fails without it) for any `schema_version: 2` manifest with `lane_type: "verification"`. Forbidden (creation fails if present) for any other `lane_type`, at any schema version.

**Compatibility cutoff:** `schema_version 2` is the real boundary (same shape as `model_routing`'s UTV2-1526 fix above, and the same reasoning: field presence alone cannot distinguish "predates this field" from "deleted from a schema_version-2 manifest"). `schema_version: 1` verification manifests may lack `verification_target`; `schema_version: 2` verification manifests must carry a valid one, and deleting it fails `validateManifest`.

**What it's for:** `checkConcurrencyLimits()` in `scripts/ops/lane-start.ts` uses it to enforce the per-target Verification cap (`docs/governance/CONCURRENCY_CONFIG.json`'s `type_caps.verification.max_per_target`, default 1 — see `docs/governance/LANE_CONCURRENCY_POLICY.md` §1). An active verification lane whose `verification_target` cannot be determined (a legacy `schema_version: 1` manifest with no target) blocks every new verification lane start until it is resolved or closed — fail-closed, not a silent pass.

## 17. Historical scope vs. active edit-lock ownership (UTV2-1571)

`file_scope_lock` has always served two distinct purposes that were, until this fix, evaluated using the same status set:

1. **Self-scope resolution** — "is this PR's own diff allowed to touch these files?" A manifest reset to `merged` between a PR merging and `ops:lane-close` finishing full closure must still resolve as the trusted scope for its own branch (UTV2-1563).
2. **Conflict-blocking** — "does another lane's declared scope block a *different* lane's diff?" A `merged` manifest's code is already shipped; it should not indefinitely hold active edit-lock capacity over anyone else once merged, unless something is genuinely still resuming it (which manifests as a status transition back to an active state, most commonly `reopened` — see the `TRANSITIONS` map in `scripts/ops/shared.ts`).

`scripts/ci/file-scope-guard.ts` (the CI PR gate) previously used one `ACTIVE_STATUSES` set (including `merged`) for both roles. This let a **merged-but-not-yet-`done`** manifest whose truth-check can never mechanically pass (see UTV2-1550 below) permanently block every other lane from touching any path in its `file_scope_lock`, with no way to release that lock short of falsifying the historical `files_changed` record (rejected — PR #1288). The sanctioned narrowing path added in UTV2-1762 (§6.1) is the answer to that "no way to release"; the status-set split described here remains the fix for the blocking behaviour itself.

The fix splits the guard's status sets:
- `SELF_SCOPE_STATUSES` (role 1, includes `merged`) — unchanged from UTV2-1563.
- `LOCK_CONFLICT_STATUSES` (role 2, excludes `merged`) — matches `ACTIVE_LOCK_STATUSES` in `scripts/ops/shared.ts`, the set every other `ops/*.ts` consumer (`ops:lane-start`'s `activeManifestOverlap`, `execution-state.ts`'s `isActiveLane`, `merge-risk.ts`'s `activeLanesOnly`, `lane-maximizer.ts`) already used for this exact purpose. `scripts/ci/file-scope-guard.ts` cannot import `scripts/ops/shared.ts` directly (the CI workflow extracts and runs this file standalone from `origin/main` with no sibling `scripts/ops/` tree available at that path), so the set is intentionally duplicated rather than imported.

**`files_changed` is never read by either role.** Only `file_scope_lock` (current/declared-at-lane-start edit-scope) ever participates in scope or conflict evaluation, in both the guard and in `ops:lane-start`'s own overlap check. This was already true before this fix; the fix only corrects *which manifests'* `file_scope_lock` counts toward blocking others. The immutable historical record (`files_changed`) remains exactly as GitHub's merged diff produced it, and truth-check's `S1` (files_changed ⊆ file_scope_lock ∪ expected_proof_paths) and `G5` (no post-merge touches without a linked follow-up) checks continue to run against it unchanged.

**Scope note:** this fix does not implement LANE_MANIFEST_SPEC §2's "Override close" event — that remains documented-but-unimplemented, unchanged by UTV2-1571. UTV2-1550's own terminal closure is a separate, narrower question (see the UTV2-1571 proof bundle for the specific mechanical gap and the manual, PM-reviewed path required to close it).

---

## 17. Repo-owned work identity and `tracker_ref` (UTV2-1837)

Ratified 2026-09-05, `docs/mission/intent.md` § "Execution must not depend on the
tracker": scope, ownership, dependencies and traceability are preserved and carried by
**repository-owned work identity** where an identifier is genuinely needed. The tracker
is a record of execution, never a precondition for it.

`issue_id` is therefore the lane's **repo-owned identity**, and it accepts `WORK-###`
alongside `UTV2-###`. It remains immutable and must match the manifest filename. It is
the primary key for the manifest filename, sync filename, proof directory, branch name,
worktree path, preflight-token path and file-scope lifecycle grant — all repo-local.

`tracker_ref` is the separate, optional, explicitly nullable **tracker key**. It is
three-valued and the distinction is load-bearing:

| Value | Meaning |
|---|---|
| `"UTV2-1837"` / `"UNI-42"` | this lane's tracker issue |
| `null` | this lane declares it has **no** tracker issue |
| absent | unstated — `resolveTrackerRef()` falls back to `issue_id` when that is itself a tracker key |

**Absent is never read as `null`.** Every manifest written before this field existed is
absent, and treating that silence as an opt-out would silently skip closeout checks the
lane never opted out of. `resolveTrackerRef()` (`scripts/ops/shared.ts`) is the single
resolver; nothing reads the field directly.

`WORK-###` is deliberately **not** a valid `tracker_ref` — a repo-minted identity is not
a tracker key, and admitting it would let the two namespaces silently merge.

### Known bound — a `WORK-###` lane is not yet mergeable

`merge-gate.yml`, `p0-protocol.yml` and `executor-result-validator.yml` still resolve a
lane by `UTV2-###`. All three are **reserved surfaces** (merge authority, `intent.md`
reserved decision 7) and are not changed here. A `WORK-###` lane is therefore usable for
discovery, delegation, verification and closeout, and is **not yet mergeable**. Closing
that gap is a PM decision on the merge gate, not an ordinary lane.

