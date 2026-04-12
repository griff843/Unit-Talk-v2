# `codex-status` — Canonical Lane Integration Specification

**Status:** Canonical, implementation-ready
**Authority:** `EXECUTION_TRUTH_MODEL.md` §2 (Lane Lifecycle), `LANE_MANIFEST_SPEC.md` §2 (manifest as sole authority for active lane state), `CODEX_DISPATCH_INTEGRATION_SPEC.md` + `CODEX_RECEIVE_INTEGRATION_SPEC.md` (sister specs; same architectural pattern)
**Script path (target):** `scripts/codex-status.ts` (existing; this spec governs the Phase 1 rewrite)
**Package script:** `pnpm codex:status [--all] [--json]`
**Phase:** 1 (status-side only; see §8 for out-of-scope)

`codex-status` is the Claude-side display command that shows the current state of all Codex CLI lanes. Today it reads `.claude/lanes.json` exclusively and renders a color-coded table from the legacy schema. After `codex-dispatch` and `codex-receive` migrated to canonical lane truth, `.claude/lanes.json` is no longer authoritative for any active lane state — yet `codex-status` still reads it. This spec defines how `codex-status` becomes a read-only consumer of `docs/06_status/lanes/*.json`.

---

## 1. Purpose

Deterministically answer one question on invocation:

> **"What is the current state of every active Codex CLI lane, as recorded in the canonical manifest directory?"**

After this spec lands, `codex-status` must:

1. Never read `.claude/lanes.json`.
2. Never write anything. Status is purely display.
3. Derive every piece of on-screen data from `docs/06_status/lanes/*.json`, filtered to `lane_type === "codex-cli"`.
4. Use canonical status vocabulary (`started`, `in_progress`, `in_review`, `merged`, `done`, `blocked`, `reopened`) — not the legacy vocabulary (`active`, `review`, `merged`, `abandoned`).
5. Refuse to invent a capacity limit or any other enforcement. Display only.

---

## 2. Role realignment

| Concern | Legacy `codex-status` | Phase 1 `codex-status` |
|---|---|---|
| Source of truth | `.claude/lanes.json` | `docs/06_status/lanes/*.json` |
| Filter | `owner === 'codex-cli'` | `lane_type === 'codex-cli'` |
| Status vocabulary | `active`, `review`, `merged`, `abandoned` | `started`, `in_progress`, `in_review`, `merged`, `done`, `blocked`, `reopened` |
| Hidden-by-default | `status !== 'merged'` | `status ∉ {merged, done}` |
| Age computation | `createdAt` from legacy entry | `started_at` from manifest |
| Stale detection | `>4h since createdAt` on active | `>4h since heartbeat_at` on any active lock status |
| Capacity enforcement | `>=3 active` warns/blocks display | **removed.** Capacity is not a status-display concern. Display is display. |
| PR column | `pr` number from legacy registry | `pr_url` from manifest |
| Packet-file existence hint | reads `.claude/codex-queue/<id>.md` | unchanged (packet file is still the dispatch output location) |
| Allowed-files display | `allowedFiles` from legacy entry | `file_scope_lock` from manifest |
| Writes | none | none — reconfirmed |

The realignment is mechanical: **same display, different input source**. No UX redesign is in scope. The table column set may shift slightly to reflect canonical field names, but the output posture (bold header, color-coded rows, dim hints) stays identical.

---

## 3. Command shape (Phase 1)

```
pnpm codex:status [--all] [--json]

Optional:
  --all     include merged and done lanes (default: hide them)
  --json    emit machine-readable array of lane summaries (default: human display)
```

The legacy CLI shape is preserved. Only `--all` and `--json` are sanctioned flags in Phase 1. `--json` output is an addition to support scripting by operators and CI digest consumers.

### 3.1 Exit codes

| Code | Meaning |
|---|---|
| `0` | Success — lanes read and displayed (even if the list is empty) |
| `3` | Infra — `docs/06_status/lanes/` unreadable, git unavailable, repo root unresolvable |

Note there is no exit `1`. Status is a display command; a failure to find any lane is not an error — it is displayed as "no Codex CLI lanes active." Only an inability to **read** the manifest directory is an error.

---

## 4. Canonical flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. parse args (--all, --json)                                       │
│ 2. read all manifest files under docs/06_status/lanes/*.json        │
│    via readAllManifests() from scripts/ops/shared.ts                │
│    ├─ directory missing → exit 0 with "no lanes" message            │
│    │   (fresh clone, no lanes yet — not a failure)                  │
│    └─ directory unreadable → exit 3                                 │
│ 3. filter manifests: lane_type === "codex-cli"                      │
│ 4. unless --all, also filter: status ∉ {merged, done}               │
│ 5. sort by started_at descending                                    │
│ 6. compute derived display fields per lane:                         │
│    ├─ age = now - started_at                                        │
│    ├─ heartbeat_age = now - heartbeat_at                            │
│    ├─ stale = status ∈ active-lock set AND heartbeat_age > 4h       │
│    └─ packet_present = fs.existsSync(.claude/codex-queue/<id>.md)   │
│ 7. emit output (human table or JSON array)                          │
└─────────────────────────────────────────────────────────────────────┘
```

**Laws:**

- `codex-status` never writes anything. No file, no registry, no remote call.
- `codex-status` never calls any `ops:*` command. It is a pure reader.
- `codex-status` never reads `.claude/lanes.json`. The file is frozen as a historical record per the dispatch / receive migration stances.
- `codex-status` never reads Linear, GitHub, or Supabase. Display only uses what the manifest records.

---

## 5. Canonical status mapping

The legacy display used a four-value status vocabulary. The canonical manifest has seven. The Phase 1 mapping for display purposes is:

| Canonical status | Display bucket | Color | Notes |
|---|---|---|---|
| `started` | **active** | yellow | new lane, no commits yet |
| `in_progress` | **active** | yellow | worker is executing |
| `in_review` | **in-review** | yellow | PR linked, awaiting merge |
| `merged` | **merged** | green | merge event recorded, close pending |
| `done` | **done** | green | `ops:lane-close` ran, truth-check passed |
| `blocked` | **blocked** | red | explicit block or stranded |
| `reopened` | **reopened** | red | truth-check detected a reopen |

**Active-lock set** (used for stale detection and the summary count): `{started, in_progress, in_review, blocked, reopened}`. This mirrors the `ACTIVE_LOCK_STATUSES` constant already exported from `scripts/ops/shared.ts`. Do not redefine this set in `codex-status.ts`.

The summary header becomes:

```
  Active: N    In Review: N    Merged: N    Done: N    Blocked: N
```

Capacity annotations (`N/3`) are **removed**. Capacity is not a status-display concern (see §2 table). If a capacity cap is ever reintroduced, it belongs in `ops:lane-start` against the canonical manifest directory, not in a display command.

---

## 6. Stale detection

Stale detection moves from `now - createdAt > 4h` (legacy) to `now - heartbeat_at > 4h` on any lane in the active-lock set (canonical, per `LANE_MANIFEST_SPEC.md` §3).

Rules:

- If `heartbeat_age > 4h` and `status ∈ active-lock set` → mark row stale (red `(STALE)` suffix).
- If `heartbeat_age > 24h` → mark row stranded (red `(STRANDED)` suffix). Same threshold as `LANE_MANIFEST_SPEC.md` §3.
- Stale/stranded annotation is cosmetic. `codex-status` does not trigger any transition — reconciliation is `ops:reconcile`'s job (deferred to a future lane per `LANE_MANIFEST_SPEC.md` §3).

---

## 7. JSON output contract

`--json` emits a top-level array (not an object), one entry per displayed lane:

```json
[
  {
    "issue_id": "UTV2-###",
    "lane_type": "codex-cli",
    "tier": "T2",
    "branch": "codex/utv2-###-slug",
    "worktree_path": "C:/Dev/Unit-Talk-v2-main/.out/worktrees/codex__utv2-###-slug",
    "status": "in_review",
    "display_bucket": "in-review",
    "started_at": "2026-04-11T…Z",
    "heartbeat_at": "2026-04-11T…Z",
    "age_minutes": 47,
    "heartbeat_age_minutes": 12,
    "stale": false,
    "stranded": false,
    "pr_url": "https://github.com/...",
    "file_scope_lock": ["scripts/foo.ts"],
    "expected_proof_paths": ["docs/06_status/proof/UTV2-###/evidence.json"],
    "packet_present": true,
    "manifest_path": "docs/06_status/lanes/UTV2-###.json"
  }
]
```

The array is filtered and sorted exactly as the human display is. `--json` and human modes must produce identical lane sets for identical args — this is a testable invariant.

---

## 8. Out of scope for Phase 1

Explicitly deferred. Do not bundle into the status rewrite.

1. **Capacity enforcement.** Removed from `codex-status`. If re-introduced, it belongs in `ops:lane-start`.
2. **`ops:reconcile`** stranded-lane cleanup. `codex-status` only annotates; it does not act.
3. **GitHub API cross-checks** (CI status of the PR, merge state). Status is offline.
4. **Linear cross-checks** (issue state, assignee). Status is offline.
5. **Showing non-codex-cli lanes.** Phase 1 `codex-status` remains a Codex-specific view. A general `ops:lane-list` across all `lane_type` values is a separate deferred lane.
6. **History view** (closed/done lanes older than N days). Out of scope.
7. **`.claude/lanes.json` deletion.** Deferred until both `codex-status` (this spec) and `codex-classify` are migrated.
8. **Packet drift detection** (packet file exists but manifest does not, or vice versa). Display-only status tool, not an integrity checker.

---

## 9. Fail-closed behavior

Status is a read-only display command. Fail-closed semantics are narrow.

| Failure | Exit | Display |
|---|---|---|
| `docs/06_status/lanes/` missing but parent `docs/06_status/` exists | `0` | "No Codex CLI lanes registered." |
| `docs/06_status/` missing entirely | `3` | "docs/06_status not found; are you in a Unit Talk V2 clone?" |
| Individual manifest file fails schema validation | `0` for the overall run | Offending lane is skipped with a dim warning line; other lanes still display |
| Git unavailable (repo root unresolvable) | `3` | clear infra error to stderr |
| No lanes after filter | `0` | normal "no matching lanes" message |

The one deliberate non-fail-closed path is row 3: a single malformed manifest does not block display of the other lanes. This is because status is an observability tool — the cost of one missing row is lower than the cost of hiding all rows because one was bad. A visible warning is emitted so the operator notices.

---

## 10. Banned identifiers (mirror dispatch + receive)

After the rewrite, `scripts/codex-status.ts` must contain none of:

- `LANES_FILE`
- `readRegistry`
- `writeRegistry`
- `LaneEntry`
- `LaneRegistry`

A static source-grep test (mirroring `codex-dispatch.test.ts` and `codex-receive.test.ts`) must assert their absence.

---

## 11. Acceptance criteria (for the rewrite PR)

The rewrite PR ships when all of the following are mechanically observable:

1. `pnpm codex:status` on a fresh clone with no manifests exits `0` with "no lanes" message.
2. `pnpm codex:status` with one `lane_type: "codex-cli"` manifest in `started` displays it in the "active" bucket.
3. `pnpm codex:status` with one `lane_type: "codex-cli"` manifest in `in_review` displays it in the "in-review" bucket.
4. `pnpm codex:status` without `--all` hides manifests in `merged` and `done`.
5. `pnpm codex:status --all` shows every `codex-cli` manifest regardless of status.
6. `pnpm codex:status --json` emits a JSON array with the exact field set in §7, sorted by `started_at` descending.
7. `pnpm codex:status` with a `lane_type: "claude"` manifest present does **not** display it (it is filtered out).
8. `pnpm codex:status` does not read `.claude/lanes.json`. Assert by running status with a deliberately-corrupted `.claude/lanes.json` on disk and observing success.
9. `git diff .claude/lanes.json` after running status is empty.
10. `scripts/codex-status.ts` contains no references to the banned identifiers in §10.
11. A static source test in `scripts/codex-status.test.ts` asserts banned-identifier absence and that the script imports `readAllManifests` (or equivalent) from `scripts/ops/shared.ts`.
12. `pnpm type-check` and `pnpm test` pass.

---

## 12. Related documents

| Topic | Document |
|---|---|
| Execution truth model | `docs/05_operations/EXECUTION_TRUTH_MODEL.md` |
| Lane manifest schema + lifecycle | `docs/05_operations/LANE_MANIFEST_SPEC.md` |
| Codex dispatch integration spec | `docs/05_operations/CODEX_DISPATCH_INTEGRATION_SPEC.md` |
| Codex receive integration spec | `docs/05_operations/CODEX_RECEIVE_INTEGRATION_SPEC.md` |
| Codex classify integration spec (sister spec) | `docs/05_operations/CODEX_CLASSIFY_INTEGRATION_SPEC.md` |
