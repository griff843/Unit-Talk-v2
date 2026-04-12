# `codex-dispatch` — Canonical Lane Integration Specification

**Status:** Canonical, implementation-ready
**Authority:** `EXECUTION_TRUTH_MODEL.md` §2 (Lane Lifecycle), `LANE_MANIFEST_SPEC.md` §2 (lane start gating), `PREFLIGHT_SPEC.md` §1 (preflight ownership)
**Script path (target):** `scripts/codex-dispatch.ts` (existing file; this spec governs the Phase 1 rewrite)
**Package script:** `pnpm codex:dispatch -- --issue UTV2-### [...flags]`
**Phase:** 1 (dispatch-side only; see §11 for out-of-scope)

`codex-dispatch` is the Claude-side command that prepares a bounded Codex CLI work packet for a Linear issue. Today it writes to a legacy `.claude/lanes.json` registry and performs its own file-overlap detection. This creates two independent lane truth sources, which violates `EXECUTION_TRUTH_MODEL.md` §2 ("the lane manifest is the sole authority for active lane state"). This spec defines how `codex-dispatch` becomes a thin client of the canonical `ops:preflight` → `ops:lane-start` flow.

---

## 1. Purpose

Deterministically answer one question on invocation:

> **"Can I safely hand `<UTV2-###>` to a Codex CLI worker right now — with a valid preflight token, a canonical lane manifest, a locked file scope, a created worktree, and a packet that reflects that canonical truth?"**

After this spec lands, `codex-dispatch` must:

1. Never create lane state outside `docs/06_status/lanes/<UTV2-###>.json`.
2. Never decide file-scope validity itself — delegate to `ops:lane-start`.
3. Never write to `.claude/lanes.json` as an authoritative source.
4. Refuse to emit a packet if the canonical lane was not created.
5. Produce a packet that references the canonical manifest path, the created worktree path, the canonical branch, and the locked file scope — all read from the manifest `ops:lane-start` wrote.

---

## 2. New command shape (Phase 1)

```
pnpm codex:dispatch -- --issue <UTV2-###> --tier <T1|T2|T3> --branch <branch> --files <path> [--files <path> ...] [flags]

Required:
  --issue    <UTV2-###>        Linear issue id (case-insensitive; normalized to upper-case)
  --tier     <T1|T2|T3>        tier to pass through to ops:lane-start
  --branch   <branch>          branch name (must satisfy validateBranchName)
  --files    <path>            repeatable file-scope entry; at least one required

Optional:
  --preflight-token <path>     relative path to an existing valid preflight token; if omitted dispatch runs ops:preflight itself (see §4)
  --forbidden <csv>            advisory-only list surfaced in the packet; NOT enforced by ops:lane-start
  --packet-out <path>          override default packet output path
  --dry-run                    run every validation, do not run ops:lane-start, do not write packet, print what would be done
  --json                       emit machine-readable result to stdout
  --explain                    emit per-step reasoning to stderr
```

The legacy `--allowed "a,b,c"` CSV flag is **removed**. Phase 1 adopts `--files` (repeatable) to match the canonical `ops:lane-start` argument shape exactly. There is no aliasing and no shim: operators must update their invocations. This is a deliberate breaking change — see §9.

### 2.1 Exit codes

| Code | Meaning | Side effects |
|---|---|---|
| `0` | PASS — packet emitted, manifest created, lane is live | worktree + branch + manifest + packet file written |
| `1` | FAIL — preflight failed, lane-start failed, Linear fetch failed, or file overlap detected | no manifest, no packet |
| `2` | NOT APPLICABLE — issue not Ready / tier label missing (surfaced by preflight exit `2`) | no manifest, no packet |
| `3` | INFRA — local env broken, Linear token missing, git unavailable | no manifest, no packet |

Exit codes mirror `ops:preflight` and `ops:truth-check` intentionally.

---

## 3. Canonical flow

The authoritative sequence for a successful dispatch:

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. parse + validate args (issue, tier, branch, files, token path)   │
│ 2. fetch Linear issue (title, description, labels, branchName)      │
│ 3. ensure a valid preflight token exists for (issue, branch, HEAD)  │
│    ├─ token path supplied  → validate it via shared.ts              │
│    └─ token path omitted   → run pnpm ops:preflight -- ...          │
│ 4. run pnpm ops:lane-start <issue> --tier <T> --branch <B>          │
│                                --files <f> [--files <f>...]         │
│    ├─ exit 0  → parse emitted JSON (manifest_path, worktree_path,   │
│    │           file_scope_lock, preflight_token)                    │
│    └─ exit ≠0 → propagate exit code, do not continue                │
│ 5. read the newly-written manifest from docs/06_status/lanes/...    │
│ 6. generate packet from (Linear issue fields + manifest fields)     │
│ 7. write packet to .claude/codex-queue/<issue>.md                   │
│ 8. print packet to stdout (unchanged)                               │
│ 9. emit machine-readable result JSON (--json) or human summary      │
└─────────────────────────────────────────────────────────────────────┘
```

**Laws:**

- `codex-dispatch` never writes the manifest directly. Only `ops:lane-start` is permitted to create a lane manifest, per `LANE_MANIFEST_SPEC.md` §2.
- `codex-dispatch` never performs its own file-overlap check. `activeManifestOverlap()` inside `ops:lane-start` is the single source of overlap truth.
- If step 4 fails, step 5 never runs and step 7 never writes. Fail-closed is absolute.
- The packet text is derived from the manifest, not from the CLI args. If `ops:lane-start` normalizes file paths or the branch name, the packet reflects the normalized values.

---

## 4. Preflight coupling

Preflight ownership is non-negotiable: no lane starts without a valid token. `codex-dispatch` has two sanctioned modes for satisfying that contract.

### 4.1 Token-supplied mode (preferred for CI/automation)

Caller runs `pnpm ops:preflight` first, captures the token path, and passes `--preflight-token <path>` to dispatch. Dispatch validates existence before calling `ops:lane-start`. This mode is preferred when an upstream orchestrator is already running preflight for its own reasons (digest, status page, etc).

### 4.2 Auto-preflight mode (default for interactive PM use)

If `--preflight-token` is omitted, `codex-dispatch` runs `pnpm ops:preflight -- <issue> --tier <T> --branch <B>` as a child process before attempting `ops:lane-start`. On any preflight failure (exit 1/2/3), dispatch propagates the exit code and never reaches the lane-start step.

Auto-preflight is a convenience, not a relaxation. The contract is still that a valid token exists before `ops:lane-start` is invoked. Dispatch does not write the token itself; preflight owns the token file.

### 4.3 What dispatch must not do

- Skip preflight.
- Re-implement any preflight check.
- Waive a preflight check via its own flag. Waivers live in `pnpm ops:preflight --skip ...` per `PREFLIGHT_SPEC.md` §5. Dispatch passes through; it does not decide.
- Accept a stale token. Token validation happens via `validatePreflightToken()` in `scripts/ops/shared.ts` — the same function `ops:lane-start` calls. No second implementation.

---

## 5. Lane creation

`codex-dispatch` spawns `pnpm ops:lane-start <issue> --tier <T> --branch <B> --files <f> [--files <f>...]` as a child process and parses its emitted JSON. The canonical side effects (branch creation, worktree creation, manifest write, heartbeat init) are entirely `ops:lane-start`'s responsibility.

### 5.1 Required manifest fields dispatch relies on

After a successful `ops:lane-start` run, dispatch re-reads the manifest at `docs/06_status/lanes/<UTV2-###>.json` and extracts:

| Field | Used for |
|---|---|
| `issue_id` | packet header |
| `tier` | packet header (tier-conditional verification sections) |
| `branch` | packet header; "Branch to work on" line |
| `worktree_path` | packet header; operator cwd hint |
| `file_scope_lock` | packet "Allowed files" section (replaces the prior CLI-echoed list) |
| `expected_proof_paths` | packet "Verification" section (reminds Codex where proof is expected to land) |
| `manifest_path` | packet footer; back-reference for the receiver step |
| `preflight_token` | packet footer; audit trail |

The packet **must not** derive any of these from its own CLI args. The manifest is the source. This enforces the invariant that two tools agree on lane state.

### 5.2 Required manifest field `lane_type`

`ops:lane-start` must record `lane_type: "codex-cli"` on manifests created through `codex-dispatch`. Since `ops:lane-start` does not currently take a `--lane-type` flag, dispatch has two options in Phase 1:

1. **Preferred:** add a `--lane-type codex-cli` pass-through flag to `ops:lane-start` in the same PR, and have dispatch pass it. This is a one-line addition to `lane-start.ts` (already described in `LANE_MANIFEST_SPEC.md` §4.1).
2. **Acceptable fallback:** dispatch reads the manifest after creation and patches `lane_type` and `created_by` in a second, named-author write via a new `ops:lane-start --created-by` helper. **Rejected** — this would make dispatch a manifest writer, violating §3.

Implementation must take option 1. If `ops:lane-start` does not yet accept `--lane-type`, the same PR that lands the dispatch rewrite lands the flag. No two-phase merge.

---

## 6. Packet generation (canonical form)

The packet layout is largely unchanged from the legacy form, with these canonical-truth substitutions:

| Section | Source (legacy) | Source (Phase 1) |
|---|---|---|
| Branch | `issue.branchName ?? feat/<id>-<slug>` | manifest `branch` |
| Worktree hint | absent | manifest `worktree_path` |
| Allowed files | CLI `--allowed` CSV | manifest `file_scope_lock` |
| Forbidden files | CLI `--forbidden` CSV | CLI `--forbidden` CSV (advisory-only, labeled as such) |
| Verification block | static | tier-aware — read `tier` from manifest and include the matching tier row from `EXECUTION_TRUTH_MODEL.md` §5 |
| Manifest back-reference | absent | manifest path + preflight token relative path in a footer |
| Receiver hint | `pnpm codex:receive -- --issue ... --branch ... --pr ...` | unchanged for Phase 1; see §8 for receiver evolution |

The packet continues to be printed verbatim to stdout so the operator can paste it into the Codex CLI terminal. The packet file continues to be written to `.claude/codex-queue/<issue>.md`. Packet file location is an operator convenience, not an authoritative source — if the file diverges from the manifest, the manifest wins.

### 6.1 Packet header contract

```
# Codex Task Packet — UTV2-###

Generated: <iso>
Issue URL: <linear-url>
Priority: <P#>  Project: <name>  Labels: <csv>

Lane manifest: docs/06_status/lanes/UTV2-###.json
Branch:        <manifest.branch>
Worktree:      <manifest.worktree_path>
Tier:          <manifest.tier>
Preflight:     <manifest.preflight_token>

---
```

These six lines after `---` are the canonical truth block. If any differ from the manifest at packet-generation time, dispatch must abort with exit `1` and code `packet_manifest_drift`.

---

## 7. File scope / allowed files

### 7.1 How file scope is passed in

Operator supplies one or more `--files <path>` flags. Dispatch passes them through unchanged to `ops:lane-start`. Normalization (trimming, case handling, separator conversion, glob rejection) happens inside `ops:lane-start` via `normalizeFileScope()` in `scripts/ops/shared.ts`. Dispatch never modifies the list.

### 7.2 Overlap handling

Overlap with an active lane is detected by `activeManifestOverlap()` inside `ops:lane-start`. If overlap exists, `ops:lane-start` exits `1` with `code: "file_scope_conflict"` and a JSON body naming the conflicting issue and overlapping files. Dispatch propagates that exit code and body without any added logic.

Dispatch **must not** re-implement overlap detection against `.claude/lanes.json`. The legacy `checkFileOverlap` function in `scripts/codex-dispatch.ts` lines 95–115 is deleted in the rewrite.

### 7.3 Forbidden files

The `--forbidden` flag is retained as an **advisory** list that appears in the packet text only. It is not passed to `ops:lane-start` and is not stored in the manifest. Codex is expected to honor it as a human instruction. There is no mechanical enforcement. This preserves the existing packet semantics without drifting manifest scope.

---

## 8. Branch / worktree / lane ownership alignment

After a successful dispatch the canonical state is:

```
Manifest    : docs/06_status/lanes/UTV2-###.json         (created by ops:lane-start)
Branch      : <branch> (created by ops:lane-start; tracks origin/main)
Worktree    : C:/Dev/Unit-Talk-v2-main.worktrees/UTV2-### (created by ops:lane-start)
Packet file : .claude/codex-queue/UTV2-###.md           (created by codex-dispatch)
Legacy reg. : .claude/lanes.json                        (untouched by Phase 1 dispatch)
```

Ownership rules:

- The **manifest** owns lifecycle, file-scope lock, heartbeat, tier, and proof expectations.
- The **branch** is GitHub's property after it is pushed; dispatch only creates the local branch via `ops:lane-start`.
- The **worktree** is a local filesystem artifact owned by the lane for the duration of the lane; `ops:lane-close` removes it per `LANE_MANIFEST_SPEC.md`.
- The **packet file** is an operator convenience; it can be regenerated from the manifest at any time via `pnpm codex:dispatch ... --regen` (deferred, see §11).
- The **legacy registry** is read-only for historical tooling (`codex-status`, `codex-classify`) and is never written by `codex-dispatch` after this rewrite lands.

If any of these four canonical artifacts (manifest, branch, worktree, packet) is missing at end of a `dispatch` invocation, exit must be non-zero.

---

## 9. `.claude/lanes.json` — migration stance

This is an explicit Phase 1 decision. The three sanctioned options are: **retire**, **compatibility mode**, **migration path**. We adopt a mix — call it **freeze + coexistence**, defined below.

### 9.1 Phase 1: freeze write access

- `codex-dispatch` stops writing to `.claude/lanes.json`. All writes are deleted. The functions `readRegistry()`, `writeRegistry()`, and `checkFileOverlap()` in `scripts/codex-dispatch.ts` are removed.
- `.claude/lanes.json` remains on disk, unchanged, as a historical record. Nothing in the Phase 1 rewrite deletes it.
- The file is **no longer authoritative** for any active lane decision. The canonical manifest directory (`docs/06_status/lanes/*.json`) is the only source of active lane truth after Phase 1.
- `.gitignore` / tracking status of `.claude/lanes.json` is unchanged. If it was tracked, it remains tracked; if it was ignored, it remains ignored. This is out of scope for the rewrite.

### 9.2 Phase 1 read tolerance

`codex-status`, `codex-classify`, and `codex-receive` still read `.claude/lanes.json`. That is tolerated in Phase 1 and flagged as technical debt. Each of those tools will be migrated to read the canonical manifest directory in a separate, tracked follow-up lane (see §11). Phase 1 does not touch their code.

### 9.3 No dual-write

Under no circumstances may `codex-dispatch` Phase 1 write to both `.claude/lanes.json` and the canonical manifest. Dual-write creates two truth sources and is exactly the drift class this integration exists to eliminate. If backwards compat for a third-party reader is required, that reader must either be migrated or explicitly marked "reads stale data" in its own spec.

### 9.4 No migration script

We do not convert historical `.claude/lanes.json` entries into canonical manifests. Historical lanes are closed; the data is immutable; the cost of migration exceeds its value. The historical file stands as an append-only historical record. If audit ever needs the full lane history, it concatenates `.claude/lanes.json` entries with the canonical manifest directory.

### 9.5 Deletion is deferred

`.claude/lanes.json` is not deleted in Phase 1. Deletion happens after every legacy reader (`codex-status`, `codex-classify`, `codex-receive`) has been migrated to the canonical manifest. That is a governance decision for a later lane, not a file change for this one.

---

## 10. Closeout expectations

Phase 1 defines closeout for dispatch lanes without changing the `codex-receive` code path.

### 10.1 Canonical closeout

The canonical close for any Codex-CLI lane is:

1. Codex worker opens a PR on the lane branch.
2. Operator runs `pnpm codex:receive -- --issue <ID> --branch <branch> --pr <url>` (unchanged legacy command) to transition legacy registry state. *Flagged as transitional; see §11.*
3. CI goes green on the PR, merge happens (per `DELEGATION_POLICY.md` tier rules).
4. Operator runs `pnpm ops:lane-close <UTV2-###>` to run `ops:truth-check` and transition the canonical manifest to `done`.

Step 4 is the canonical close. Steps 2 and 3 are legacy / GitHub steps that continue to work as before.

### 10.2 What dispatch must ensure for closeout

At dispatch time, `codex-dispatch` must set up preconditions for canonical close:

- The manifest must be created with `expected_proof_paths` populated. `ops:lane-start` does this via `defaultProofPaths(issueId, tier)`. Dispatch relies on that; it does not override.
- The packet footer must tell Codex exactly which proof files the canonical close will verify. This is derived from the manifest's `expected_proof_paths` at packet-generation time. If Codex produces proof anywhere else, `ops:lane-close` will fail and the lane will not close — that is correct fail-closed behavior.

### 10.3 What dispatch must not do

- Write a `closed_at` field. Dispatch never closes a lane.
- Transition `status` to anything. Only sanctioned writers do that.
- Remove a worktree. Only `ops:lane-close` does that.

---

## 11. Fail-closed behavior (enumerated)

Dispatch must abort with a non-zero exit and no side effects in every case below. Each row is a hard invariant.

| Failure | Exit | Side effects allowed |
|---|---|---|
| `LINEAR_API_TOKEN` missing | `3` | none |
| Linear issue fetch 4xx/5xx | `1` | none |
| Linear issue not Ready / wrong state | `2` | none |
| `--tier` missing, malformed, or rejected by `validateTier` | `1` | none |
| `--branch` missing or fails `validateBranchName` | `1` | none |
| `--files` empty | `1` | none |
| `--preflight-token` path given but file missing | `1` | none |
| Auto-preflight exits `1`/`2`/`3` | propagate | none |
| `ops:lane-start` exits non-zero | propagate | none |
| Manifest file missing after `ops:lane-start` exit 0 | `1` | none (abort — indicates broken writer contract, treat as infra) |
| Manifest `branch` / `worktree_path` / `file_scope_lock` disagrees with CLI args after normalization | `1` | none (indicates `ops:lane-start` rewrote inputs — packet would drift) |
| `file_scope_conflict` from `ops:lane-start` | `1` | none |
| Packet write I/O error | `1` | abort after manifest already written; print manual regenerate hint (see §11.1) |
| `--dry-run` on any of the above | same code, no side effects at all | none |

### 11.1 Packet write failure after manifest write

There is exactly one unavoidable window: `ops:lane-start` may succeed (creating the canonical manifest and worktree) and the packet file write may then fail (disk full, perms). In that case:

- The lane **is** live (canonical manifest exists).
- The packet is **not** on disk but **is** printed to stdout.
- Dispatch exits `1` with a clear message: "lane created, packet not written; copy from stdout or re-run `pnpm codex:dispatch --regen --issue <ID>` once disk issue is resolved."
- No rollback of manifest or worktree. The canonical lane is committed. Rolling it back would require an unsanctioned manifest delete, which this spec forbids.

This is acceptable because the packet is not the source of truth; the manifest is. `--regen` is a deferred feature (§12) but the failure mode is documented now so the exit code and message are stable.

---

## 12. Out of scope for Phase 1

These items are explicitly deferred. Do not bundle them into the Phase 1 rewrite.

1. **Migration of `codex-receive` to write the canonical manifest.** Still writes `.claude/lanes.json`. Will be handled in its own lane after dispatch Phase 1 ships.
2. **Migration of `codex-status` to read the canonical manifest directory.** Still reads `.claude/lanes.json`. Deferred.
3. **Migration of `codex-classify` to read the canonical manifest directory.** Still reads `.claude/lanes.json`. Deferred.
4. **Deletion of `.claude/lanes.json`.** Deferred until every reader is migrated.
5. **`--regen` flag to regenerate a packet from an existing manifest.** Documented as a known gap in §11.1; not implemented.
6. **Automatic tier detection from Linear labels.** Dispatch takes `--tier` explicitly in Phase 1. Label-based inference is a later ergonomic win and would couple dispatch to label semantics that `PREFLIGHT_SPEC.md` already owns.
7. **`codex-cloud` lane type.** Phase 1 covers `codex-cli` only. `codex-cloud` is covered under `MP_M8_SYNDICATE_MODEL_GOVERNANCE_CONTRACT.md` and has separate packet requirements.
8. **Parallel packet generation for multiple issues in one invocation.** Dispatch is one issue per call.
9. **Capacity limit (`3 active codex-cli lanes`) enforcement.** The legacy `activeCodexCli >= 3` check in `scripts/codex-dispatch.ts` lines 324–333 is removed; capacity is an operator-side policy, not a dispatch-side mechanical check. If we want mechanical enforcement, it belongs in `ops:lane-start` against the canonical manifest directory, not in dispatch.

---

## 13. Acceptance criteria (for the rewrite PR)

The rewrite PR ships when all of the following are mechanically observable:

1. `pnpm codex:dispatch -- --issue UTV2-XXX --tier T2 --branch feat/utv2-xxx-foo --files apps/api/src/foo.ts --dry-run` produces the full validation sequence output, does not write the manifest, does not write the packet, and exits `0`.
2. `pnpm codex:dispatch -- --issue UTV2-XXX ...` (non-dry-run) creates a canonical manifest at `docs/06_status/lanes/UTV2-XXX.json`, creates the worktree, creates `.claude/codex-queue/UTV2-XXX.md`, and does **not** write to `.claude/lanes.json`.
3. `git diff` on `.claude/lanes.json` after a successful dispatch invocation is empty.
4. Running dispatch twice for the same issue with overlapping `--files` against an already-active lane exits `1` with `code: "file_scope_conflict"` from `ops:lane-start` (not from dispatch).
5. Running dispatch without a valid preflight token exits per §4 with the propagated preflight exit code.
6. Running dispatch with a stale preflight token (HEAD has moved) is rejected by `validatePreflightToken()` and dispatch exits `1`.
7. `scripts/codex-dispatch.ts` contains no references to `LANES_FILE`, `readRegistry`, `writeRegistry`, `checkFileOverlap`, or `activeCodexCli` capacity checks.
8. `scripts/codex-dispatch.ts` spawns `pnpm ops:lane-start` and no longer defines its own `LaneEntry` / `LaneRegistry` types.
9. `pnpm type-check` and `pnpm test` pass.
10. A follow-up integration test asserts that a fresh dispatch invocation produces exactly one new file under `docs/06_status/lanes/` and does not modify `.claude/lanes.json`.

Acceptance criterion 10 is the mechanical anti-drift guard. It must exist.

---

## 14. Related documents

| Topic | Document |
|---|---|
| Execution truth model | `docs/05_operations/EXECUTION_TRUTH_MODEL.md` |
| Lane manifest schema + lifecycle | `docs/05_operations/LANE_MANIFEST_SPEC.md` |
| Preflight spec | `docs/05_operations/PREFLIGHT_SPEC.md` |
| Truth-check (done-gate) | `docs/05_operations/TRUTH_CHECK_SPEC.md` |
| Delegation policy | `docs/05_operations/DELEGATION_POLICY.md` |
| ci-doctor spec | `docs/05_operations/CI_DOCTOR_SPEC.md` |
| Required secrets inventory | `docs/05_operations/REQUIRED_SECRETS.md` |
| Required CI checks inventory | `docs/05_operations/REQUIRED_CI_CHECKS.md` |
