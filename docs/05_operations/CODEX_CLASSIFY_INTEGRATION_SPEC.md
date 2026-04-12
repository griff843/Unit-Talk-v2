# `codex-classify` — Canonical Lane Integration Specification

**Status:** Canonical, implementation-ready
**Authority:** `EXECUTION_TRUTH_MODEL.md` §2 (Lane Lifecycle), `LANE_MANIFEST_SPEC.md` §2 (manifest as sole authority), `CODEX_DISPATCH_INTEGRATION_SPEC.md` + `CODEX_RECEIVE_INTEGRATION_SPEC.md` + `CODEX_STATUS_INTEGRATION_SPEC.md` (sister specs)
**Script path (target):** `scripts/codex-classify.ts` (existing; this spec governs the Phase 1 rewrite)
**Package script:** `pnpm codex:classify [--states "..."] [--limit N] [--json]`
**Phase:** 1 (classify-side only; see §8 for out-of-scope)

`codex-classify` is the Claude-side command that auto-classifies Linear issues as `claude-only`, `codex-safe`, `blocked`, or `needs-contract` so operators know which issues are safe to dispatch to Codex CLI. Today it consumes Linear via GraphQL **and** reads `.claude/lanes.json` for two narrow purposes: (1) constructing a set of "issue IDs already owned by an active lane" to disqualify them from Codex dispatch, and (2) printing an active Codex-lane count footer. Both uses now target a stale legacy registry. This spec defines how those two lookups move to the canonical manifest directory without touching the classification rules themselves.

---

## 1. Purpose

Deterministically answer one question on invocation:

> **"Given a set of Linear issues, which are claude-only, codex-safe, blocked, or needs-contract — using canonical manifest truth for 'already-owned-by-an-active-lane' disqualification?"**

After this spec lands, `codex-classify` must:

1. Never read `.claude/lanes.json`.
2. Never write anything. Classification is purely display.
3. Derive the `activeIssueIds` set from `docs/06_status/lanes/*.json` filtered to statuses in the active-lock set.
4. Derive the active Codex-lane footer count from the same canonical source filtered to `lane_type === "codex-cli"`.
5. Preserve the existing classification rules and Linear fetch path unchanged. This spec is strictly about migrating the two legacy-registry read sites.

---

## 2. Role realignment

| Concern | Legacy `codex-classify` | Phase 1 `codex-classify` |
|---|---|---|
| Linear fetch | unchanged | unchanged |
| Classification rules (CLAUDE_ONLY_SIGNALS, etc.) | unchanged | unchanged |
| `activeIssueIds` source | `registry.lanes.filter(l => l.status ∈ {active, review})` | manifests under `docs/06_status/lanes/*.json` filtered to `status ∈ {started, in_progress, in_review, blocked, reopened}` |
| Active Codex lane footer | `registry.lanes.filter(l => l.owner === 'codex-cli' && l.status === 'active')` | manifests filtered to `lane_type === 'codex-cli' && status ∈ active-lock set` |
| `allowedFiles` consumption | type-declared but **unused** in classify (no file-overlap check) | removed (type and field both deleted) |
| Writes | none | none — reconfirmed |
| `.claude/lanes.json` access | reads | **removed** |

The rewrite is narrow: two read sites migrate to `readAllManifests()` from `scripts/ops/shared.ts`. Nothing else about `codex-classify` changes.

---

## 3. Command shape (Phase 1)

```
pnpm codex:classify [--states "Ready,In Progress,In Review"] [--limit 50] [--json]
```

CLI surface is **unchanged** from the legacy command. No flag additions, no flag removals. Classification output format is unchanged. Only the internal `activeIssueIds` and footer count derive from a different source.

### 3.1 Exit codes

| Code | Meaning |
|---|---|
| `0` | Success — issues classified and displayed (even if empty) |
| `1` | Linear fetch failed (unchanged from legacy) |
| `3` | Infra — `docs/06_status/lanes/` unreadable, git unavailable, `LINEAR_API_TOKEN` missing |

No new exit codes. Legacy exit codes unchanged.

---

## 4. Canonical flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. parse args (--states, --limit, --json)                           │
│ 2. validate LINEAR_API_TOKEN present → exit 3 if missing            │
│ 3. fetch issues from Linear                                         │
│ 4. read all canonical manifests via readAllManifests()              │
│    ├─ directory missing → activeIssueIds = empty set, no error     │
│    └─ directory unreadable → exit 3                                 │
│ 5. build activeIssueIds:                                            │
│    manifests.filter(m => m.status ∈ active-lock set).map(m => m.id) │
│ 6. build codexActive footer set:                                    │
│    manifests.filter(m => lane_type === 'codex-cli'                  │
│                       && status ∈ active-lock set)                  │
│ 7. classify each issue using existing rules (unchanged)             │
│    passing activeIssueIds for the overlap-disqualification check    │
│ 8. emit output (human display or JSON)                              │
│ 9. print codexActive footer                                         │
└─────────────────────────────────────────────────────────────────────┘
```

**Laws:**

- `codex-classify` never writes anything.
- `codex-classify` never calls any `ops:*` command. It is a pure reader.
- `codex-classify` never reads `.claude/lanes.json`. Frozen per the migration stance.
- `codex-classify` never reads GitHub or Supabase. Linear is the only remote, and that is unchanged from legacy.
- Classification rules do not change. This is a source-swap migration, not a semantic migration.

---

## 5. Active-lock set

Use `ACTIVE_LOCK_STATUSES` from `scripts/ops/shared.ts` directly. Do not redefine. Current value: `{started, in_progress, in_review, blocked, reopened}`.

The legacy set `{active, review}` corresponded (roughly) to this canonical set. The migration expands slightly: a `blocked` or `reopened` manifest now also disqualifies its issue from fresh Codex dispatch, which is the correct behavior — a blocked lane still owns its issue and should not have a concurrent dispatch.

---

## 6. `activeIssueIds` use inside classify

The `classifyIssue` function (legacy logic, unchanged) receives a `Set<string>` of issue identifiers as its second argument and uses it to mark an issue `blocked` if `activeIssueIds.has(issue.identifier)`. The Phase 1 rewrite:

- **Does not** change the `classifyIssue` signature.
- **Does not** change the `classifyIssue` behavior.
- **Does** change how `activeIssueIds` is constructed: from canonical manifest filenames / `issue_id` fields instead of legacy registry entries.

Manifest filenames are already canonical `UTV2-###` strings (per `LANE_MANIFEST_SPEC.md` §4.1 and `scripts/ops/shared.ts:258`), so the Set content is identical in shape.

---

## 7. Footer count

The legacy footer shows `Active Codex CLI lanes: N/3` with a list of `l.id: l.owner — active`. Phase 1:

- Field source moves from `registry.lanes` to `readAllManifests()`.
- Filter becomes `lane_type === 'codex-cli' && status ∈ active-lock set`.
- The `N/3` capacity cap **is removed** from classify output — same reason as `codex-status` (§2 table of that spec): capacity enforcement is not a display concern, and re-asserting a cap here duplicates a policy that no longer exists in dispatch.
- The footer becomes: `Active Codex CLI lanes: N` followed by a bullet list of `{issue_id} — {status}`.
- If `N === 0`, the footer is omitted entirely (matches legacy behavior).

---

## 8. Out of scope for Phase 1

Explicitly deferred. Do not bundle into the classify rewrite.

1. **Classification rule changes.** `CLAUDE_ONLY_SIGNALS` regex list, codex-safe criteria, needs-contract detection — all unchanged. Semantic updates are a separate lane.
2. **File-overlap classification.** The legacy `LaneEntry` type declared `allowedFiles?: string[]` but classify never used it for overlap detection. Phase 1 deletes the field. True file-overlap detection is already enforced by `ops:lane-start` at dispatch time (see `CODEX_DISPATCH_INTEGRATION_SPEC.md` §7.2); classify is a pre-dispatch advisory filter only.
3. **`ops:reconcile` integration.** Classify does not trigger reconciliation.
4. **GitHub API cross-checks.** Classify stays Linear-only.
5. **Tier-aware classification.** If a T1 issue should be classified differently than a T2/T3 issue, that rule lives in the classification logic, not in the manifest-source migration.
6. **`.claude/lanes.json` deletion.** Deferred until **both** `codex-status` and `codex-classify` (this spec) have been migrated. After this lane ships, every legacy reader is canonical and deletion is unblocked — but the actual deletion is still a governance decision for a later lane.
7. **`ops:lane-list` general command** that could replace the internal `readAllManifests` + filter pattern. Deferred; not blocking.
8. **Capacity cap restoration.** Stays removed.

---

## 9. Fail-closed behavior

Classify is a read-only display command with Linear dependency. Fail-closed rules:

| Failure | Exit | Display |
|---|---|---|
| `LINEAR_API_TOKEN` missing | `3` | stderr message "LINEAR_API_TOKEN required" |
| Linear API failure (fetch rejected) | `1` | stderr error |
| `docs/06_status/lanes/` missing | `0` | proceed with empty `activeIssueIds`, classify normally |
| `docs/06_status/lanes/` unreadable (perm denied) | `3` | stderr infra error |
| Individual manifest file fails schema validation | `0` for overall run | skip the offending manifest with a dim warning; other lanes still count toward `activeIssueIds` |
| Git unavailable | `3` | stderr infra error |

Row 3 is deliberately non-blocking: a fresh clone with no lanes should still be able to classify fresh Linear issues. An empty `activeIssueIds` set is valid. Only an **unreadable** directory (permission denied, not missing) is an infra error.

Row 5 mirrors `codex-status` §9: a single bad manifest does not block the tool. A visible warning is emitted so the operator notices.

---

## 10. Banned identifiers (mirror dispatch + receive + status)

After the rewrite, `scripts/codex-classify.ts` must contain none of:

- `LANES_FILE`
- `readRegistry`
- `writeRegistry`
- `LaneEntry`
- `LaneRegistry`

A static source-grep test (mirroring the dispatch / receive / status patterns) must assert their absence.

---

## 11. Acceptance criteria (for the rewrite PR)

The rewrite PR ships when all of the following are mechanically observable:

1. `pnpm codex:classify --limit 5` on a clone with no manifests proceeds normally with empty `activeIssueIds` and classifies any fetched issue as codex-safe/claude-only/etc. per the unchanged rules.
2. `pnpm codex:classify --limit 5` with a `lane_type: "codex-cli"` manifest for `UTV2-999` in `started` status causes a Linear issue with `identifier: "UTV2-999"` to be classified as blocked (the overlap branch of `classifyIssue`).
3. `pnpm codex:classify` does not read `.claude/lanes.json`. Assert by running classify with a deliberately-corrupted `.claude/lanes.json` on disk and observing success.
4. `git diff .claude/lanes.json` after running classify is empty.
5. `pnpm codex:classify --json` emits JSON output identical in shape to the legacy output (same `ClassifiedIssue` record). No shape change.
6. `pnpm codex:classify` footer prints `Active Codex CLI lanes: N` (no `/3`) based on canonical manifests.
7. `scripts/codex-classify.ts` contains no references to the banned identifiers in §10.
8. A static source test in `scripts/codex-classify.test.ts` asserts banned-identifier absence and that the script imports `readAllManifests` (or equivalent) from `scripts/ops/shared.ts`.
9. `pnpm type-check` and `pnpm test` pass.

---

## 12. Related documents

| Topic | Document |
|---|---|
| Execution truth model | `docs/05_operations/EXECUTION_TRUTH_MODEL.md` |
| Lane manifest schema + lifecycle | `docs/05_operations/LANE_MANIFEST_SPEC.md` |
| Codex dispatch integration spec | `docs/05_operations/CODEX_DISPATCH_INTEGRATION_SPEC.md` |
| Codex receive integration spec | `docs/05_operations/CODEX_RECEIVE_INTEGRATION_SPEC.md` |
| Codex status integration spec (sister spec) | `docs/05_operations/CODEX_STATUS_INTEGRATION_SPEC.md` |
