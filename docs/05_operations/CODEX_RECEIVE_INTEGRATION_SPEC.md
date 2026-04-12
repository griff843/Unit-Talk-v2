# `codex-receive` — Canonical Lane Integration Specification

**Status:** Canonical, implementation-ready
**Authority:** `EXECUTION_TRUTH_MODEL.md` §2 (Lane Lifecycle), `LANE_MANIFEST_SPEC.md` §2 (lane state writers), `TRUTH_CHECK_SPEC.md` §1 (done-gate ownership), `CODEX_DISPATCH_INTEGRATION_SPEC.md` (sister-spec; same architectural pattern)
**Script path (target):** `scripts/codex-receive.ts` (existing; this spec governs the Phase 1 rewrite)
**Package script:** `pnpm codex:receive -- --issue UTV2-### --branch <branch> --pr <url>`
**Phase:** 1 (receive-side only; see §12 for out-of-scope)

`codex-receive` is the Claude-side command that acknowledges returned Codex CLI work and transitions the lane into review. Today it writes `.claude/lanes.json`, runs its own `pnpm type-check` + `pnpm test` verification gate, and has no awareness of the canonical manifest. After the `codex-dispatch` migration landed, the lane state it targets now lives exclusively in `docs/06_status/lanes/<UTV2-###>.json`. This spec defines how `codex-receive` stops writing the legacy registry, stops re-running verification that CI + `ops:truth-check` already own, and becomes a thin client that transitions the canonical manifest to `in_review` with the PR linked.

---

## 1. Purpose

Deterministically answer one question on invocation:

> **"Codex has pushed a branch and opened a PR for `<UTV2-###>`. Is the canonical lane in a state where it can be acknowledged, linked to the PR, transitioned to `in_review`, and handed off to the merge authority — and nothing else?"**

After this spec lands, `codex-receive` must:

1. Never create lane state outside `docs/06_status/lanes/<UTV2-###>.json`.
2. Never write to `.claude/lanes.json` as an authoritative (or coexisting) source.
3. Never run `pnpm type-check`, `pnpm test`, or any other verification gate itself. Branch-level verification is owned by CI on the PR; lane-level done-gate is owned by `ops:truth-check`. Duplicating either creates drift.
4. Never create a manifest if one does not exist for the issue. A `receive` on an unknown issue is a hard error.
5. Never transition the manifest to `done` / `merged`. Receive owns exactly one transition: `{started | in_progress | reopened}` → `in_review`, plus the `pr_url` field write.
6. Post a Linear comment derived from **manifest truth**, not from CLI args. If the manifest and CLI args disagree, abort.

---

## 2. Role realignment

| Concern | Legacy `codex-receive` | Phase 1 `codex-receive` |
|---|---|---|
| Lane registry | writes `.claude/lanes.json` | reads manifest only; writes via canonical ops command |
| Missing lane | auto-creates legacy entry | **hard error**, exit `1` |
| Branch existence | `git fetch` + `rev-parse` | unchanged — local read-only git check |
| Verification gate | `pnpm type-check` + `pnpm test` on the branch | **removed entirely.** CI + truth-check own verification. |
| `--skip-tests` flag | present (waiver) | **removed** (no gate to waive) |
| Manifest transition | none | `in_review` + `pr_url` via canonical writer |
| Heartbeat | none | updated as a side effect of the canonical writer |
| Linear comment | narrative, from CLI args | narrative, from manifest truth |
| Lane type checks | none | must be `codex-cli`; other lane types refused |

The realignment is intentional: receive is a **state transition acknowledgment**, not a verification gate. The verification surface it used to duplicate is already owned by (a) PR CI in GitHub, (b) `ops:truth-check` at lane close, and (c) the tier-specific gates in `DELEGATION_POLICY.md`. Duplicating them here risks three divergent verdicts for the same code.

---

## 3. New command shape (Phase 1)

```
pnpm codex:receive -- --issue <UTV2-###> --branch <branch> --pr <url> [flags]

Required:
  --issue   <UTV2-###>      Linear issue id (case-insensitive; normalized to upper-case)
  --branch  <branch>        branch name that was dispatched (must match manifest.branch)
  --pr      <url>           full PR URL (https://github.com/<owner>/<repo>/pull/<n>)

Optional:
  --dry-run                 run every validation, do not spawn the canonical writer, do not post Linear
  --json                    emit machine-readable result to stdout
  --explain                 emit per-step reasoning to stderr
  --no-linear               skip Linear comment post (still transitions the manifest)
```

The legacy `--skip-tests` flag is **removed**, not aliased. There is no verification gate in Phase 1 receive, so there is nothing to skip. Operators who were passing `--skip-tests` as a convenience were already bypassing the gate the legacy script advertised; removing the flag + removing the gate eliminates both halves of that theater.

### 3.1 Exit codes

| Code | Meaning | Side effects |
|---|---|---|
| `0` | PASS — manifest transitioned to `in_review`, `pr_url` set, Linear comment posted (or skipped per flag) | canonical writer spawned; linear comment posted |
| `1` | FAIL — manifest missing, branch mismatch, status mismatch, lane_type mismatch, canonical writer failed | none (see §8) |
| `2` | NOT APPLICABLE — manifest status already `in_review`, `merged`, or `done` (idempotent no-op with a clear message) | none |
| `3` | INFRA — git unavailable, repo root unresolvable, Linear token missing when `--no-linear` not set | none |

Exit codes mirror `ops:preflight`, `ops:truth-check`, and `codex-dispatch` intentionally.

---

## 4. Canonical flow

The authoritative sequence for a successful receive:

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. parse + validate args (issue, branch, pr url)                    │
│ 2. read manifest at docs/06_status/lanes/<issue>.json               │
│    ├─ missing              → exit 1 (lane_missing)                  │
│    └─ exists               → continue                               │
│ 3. validate manifest invariants vs CLI args                         │
│    ├─ manifest.issue_id === <issue>                                 │
│    ├─ manifest.branch === <branch>                                  │
│    ├─ manifest.lane_type === "codex-cli"                            │
│    └─ manifest.status ∈ {started, in_progress, reopened}            │
│         (in_review/merged/done → exit 2 no-op; blocked → exit 1)    │
│ 4. verify branch exists locally or on origin (read-only)            │
│    └─ neither  → exit 1 (branch_not_found)                          │
│ 5. verify PR url is syntactically valid                             │
│    └─ invalid  → exit 1 (pr_url_invalid)                            │
│ 6. spawn pnpm ops:lane-link-pr <issue> --branch <branch> --pr <url> │
│    ├─ exit 0  → parse emitted JSON (manifest_path, status, pr_url)  │
│    └─ exit ≠0 → propagate exit code, do not post Linear             │
│ 7. re-read the manifest to confirm canonical state                  │
│    ├─ manifest.status === "in_review"                               │
│    ├─ manifest.pr_url === <url>                                     │
│    └─ any mismatch → exit 1 (receive_manifest_drift)                │
│ 8. post Linear comment derived from manifest + issue lookup         │
│    (unless --no-linear; failure is non-fatal, exit still 0)         │
│ 9. emit machine-readable result JSON (--json) or human summary      │
└─────────────────────────────────────────────────────────────────────┘
```

**Laws:**

- `codex-receive` never writes the manifest directly. Only `ops:lane-link-pr` (the new canonical writer; see §5) writes the `in_review`/`pr_url` transition.
- `codex-receive` never runs verification. Branch-level gates are CI; lane-level gate is `ops:truth-check` at close.
- If step 2 or 3 fails, step 6 never runs. No partial state.
- If step 6 fails, step 8 never runs. No Linear comment pointing to a manifest that did not transition.
- If step 8 fails, the receive is still a success — the manifest is authoritative, the Linear comment is narrative.

---

## 5. `ops:lane-link-pr` — new narrow canonical writer

Receive requires a canonical writer for the `in_review` transition. The existing `ops:lane-start`, `ops:lane-close`, and `ops:truth-check` commands do not cover it. Rather than let receive write the manifest directly, Phase 1 adds one small new ops command that mirrors the dispatch → lane-start pattern.

### 5.1 Command shape

```
pnpm ops:lane-link-pr -- <UTV2-###> --branch <branch> --pr <url> [--json]

Positional:
  <UTV2-###>          Linear issue id

Required flags:
  --branch <branch>   must match manifest.branch exactly
  --pr <url>          PR URL to record in manifest.pr_url

Optional flags:
  --json              emit structured result (default on when spawned by receive)
```

### 5.2 Exit codes

| Code | Meaning |
|---|---|
| `0` | Transition applied: `status: in_review`, `pr_url` set, heartbeat updated |
| `1` | Invariant violation (branch mismatch, status not in resumable set, manifest not `codex-cli`, PR URL malformed) |
| `2` | Already `in_review` / `merged` / `done` — no-op, idempotent |
| `3` | Infra error (manifest file unreadable, git unavailable, repo root unresolvable) |

### 5.3 Invariants

`ops:lane-link-pr` must enforce, and emit `code` values for, each of:

- `manifest_missing` — no file at `docs/06_status/lanes/<issue>.json`
- `branch_mismatch` — `manifest.branch !== <branch>`
- `status_not_transitionable` — `manifest.status ∉ {started, in_progress, reopened}` (if already `in_review`, return exit `2` with `code: "already_in_review"`)
- `lane_type_mismatch` — `manifest.lane_type !== 'codex-cli'` (receive is only sanctioned for codex-cli lanes in Phase 1)
- `pr_url_invalid` — fails a narrow regex of `https://github\.com/[^/]+/[^/]+/pull/\d+`
- `transition_rejected` — the existing `TRANSITIONS` table in `shared.ts` would reject `<status> → in_review`

### 5.4 Writes

On successful transition the command writes exactly:

- `manifest.status = "in_review"`
- `manifest.pr_url = <url>`
- `manifest.heartbeat_at = nowIso()`

Nothing else. Specifically: `files_changed`, `commit_sha`, `closed_at`, `truth_check_history`, `reopen_history`, and `blocked_by` are **untouched**. Receive is not the merge event, not the close event, and not a truth-check writer.

### 5.5 Output

```json
{
  "ok": true,
  "code": "lane_linked",
  "issue_id": "UTV2-###",
  "manifest_path": "docs/06_status/lanes/UTV2-###.json",
  "branch": "...",
  "pr_url": "...",
  "status": "in_review",
  "heartbeat_at": "2026-04-11T…Z"
}
```

Failure emits a `{ ok: false, code, message, …details }` object mirroring `lane-start` / `lane-close` conventions.

### 5.6 Why this is a separate command

Three options were considered:

1. **`codex-receive` writes the manifest directly** via `readManifest`/`writeManifest` helpers — rejected, because it makes receive a second canonical writer and breaks the single-writer invariant the dispatch migration established. Scripts in `scripts/` are **orchestrators**; scripts in `scripts/ops/` are **canonical writers**. Mixing the two erodes the rule.
2. **Extend `ops:lane-start` with a `--link-pr` mode** — rejected, because `lane-start` is semantically the lane creation entry point and has preflight-token requirements that do not apply to a PR-link transition.
3. **Add a narrow `ops:lane-link-pr`** — selected. It is the smallest viable canonical writer, it mirrors the `lane-start` / `lane-close` shape, and it aligns with `LANE_MANIFEST_SPEC.md` §2 which already names `ops:lane:link-pr` as the canonical writer for the `in_review` transition.

The new command is narrow, testable, and fully isolated. It is the minimum viable change.

---

## 6. What `codex-receive` must read from the manifest

After a successful `ops:lane-link-pr` spawn, receive re-reads `docs/06_status/lanes/<UTV2-###>.json` and uses these fields (and no others) to produce its output:

| Field | Used for |
|---|---|
| `issue_id` | result JSON, Linear comment |
| `tier` | Linear comment tier annotation, receive human summary |
| `branch` | result JSON (confirmation), Linear comment |
| `worktree_path` | human summary (operator hint only) |
| `pr_url` | result JSON, Linear comment |
| `status` | post-write drift check (must be `in_review`) |
| `file_scope_lock` | Linear comment (reminds PM what scope was locked) |
| `expected_proof_paths` | Linear comment (reminds PM what proof is expected at close) |
| `manifest_path` | result JSON, Linear comment footer |
| `heartbeat_at` | result JSON |

The CLI args are the **request**; the manifest is the **committed truth**. If they differ after the canonical writer returns success, receive aborts with exit `1` and `code: "receive_manifest_drift"`. Same pattern as dispatch `packet_manifest_drift`.

### 6.1 Explicitly not read

- `truth_check_history` — receive is not a truth-check writer
- `reopen_history` — receive is not a reopen writer
- `closed_at` — receive never closes a lane
- `commit_sha` — merge happens after receive, not through receive
- `files_changed` — populated at merge time by a different writer

---

## 7. Linear comment contract

The Linear comment is **narrative**, not authoritative. Authority belongs to the manifest. The comment exists so PM reviewers and Linear-watching observers see a coherent message tied to canonical state.

### 7.1 Canonical body

```
**Codex returned work — <manifest.issue_id>**

PR:       <manifest.pr_url>
Branch:   `<manifest.branch>`
Tier:     <manifest.tier>
Worktree: <manifest.worktree_path>

Lane manifest: <manifest_path>

Status: in_review (transitioned by ops:lane-link-pr)

### Locked file scope
<bulleted list from manifest.file_scope_lock>

### Expected proof paths for close
<bulleted list from manifest.expected_proof_paths>

---

Next step: this lane closes via `ops:lane-close <issue>`, which runs `ops:truth-check`
against the merge SHA and the proof paths above. Verification is CI + truth-check;
codex-receive does not gate merge.
```

Every line is derived from the manifest (plus the `manifest_path` returned by `ops:lane-link-pr`). Request args are not substituted.

### 7.2 Comment failure is non-fatal

If the Linear API call fails, receive logs the failure to stderr and exits `0`. The comment is an advisory artifact; the manifest transition is the authoritative one. This is a deliberate asymmetry with dispatch, where a packet-write failure exits non-zero — packet-write is part of the dispatch contract, Linear comment-post is not.

### 7.3 `--no-linear`

`--no-linear` skips the comment post entirely and does not require `LINEAR_API_TOKEN`. This is the sanctioned way to run receive in environments without Linear credentials (CI replay, local recovery). The manifest transition still happens.

---

## 8. Fail-closed behavior (enumerated)

Receive must abort with a non-zero exit and no side effects in every case below. Each row is a hard invariant.

| Failure | Exit | Side effects allowed |
|---|---|---|
| Missing `--issue` / `--branch` / `--pr` | `1` | none |
| `--issue` fails `requireIssueId` | `1` | none |
| `--branch` fails `validateBranchName` | `1` | none |
| `--pr` not a valid github.com PR URL | `1` | none |
| Manifest file missing | `1` | none |
| `manifest.issue_id` ≠ `<issue>` after normalization | `1` | none |
| `manifest.branch` ≠ `<branch>` | `1` | none |
| `manifest.lane_type` ≠ `"codex-cli"` | `1` | none |
| `manifest.status` ∈ `{in_review, merged, done}` | `2` (no-op) | none |
| `manifest.status` ∈ `{blocked}` | `1` | none |
| Branch not found locally or on origin | `1` | none |
| `ops:lane-link-pr` exits non-zero | propagate | none |
| After canonical writer success, re-read manifest shows `status` ≠ `in_review` or `pr_url` ≠ `<url>` | `1` | none (this indicates a broken writer contract) |
| Linear API failure (comment post) | `0` | warning only; manifest already transitioned |
| `--no-linear` supplied with missing `LINEAR_API_TOKEN` | `0` | transition still applied |
| Git unavailable | `3` | none |
| `--dry-run` on any of the above | same code as non-dry-run, no side effects at all | none |

The one asymmetry is row 14: Linear comment failure is non-fatal. This is intentional per §7.2.

### 8.1 Idempotency

Re-running `codex-receive` for an issue already in `in_review` returns exit `2` with `code: "already_in_review"` and does **not** spawn `ops:lane-link-pr` a second time. The re-run is observable in the heartbeat only when a new transition is applied, not on idempotent exits. This prevents heartbeat thrash from operators re-running the command to "refresh" the comment.

---

## 9. `.claude/lanes.json` — migration stance

Same stance as `codex-dispatch` Phase 1: **freeze + coexistence, with narrower reach** because receive was also a legacy writer.

### 9.1 Phase 1: freeze write access

- `codex-receive` stops writing `.claude/lanes.json`. All writes are deleted.
- The functions `readRegistry()` and `writeRegistry()` in `scripts/codex-receive.ts` are removed.
- `.claude/lanes.json` remains on disk, unchanged, as a historical record. Nothing in the Phase 1 rewrite deletes it.
- The file is **no longer authoritative** for any active lane decision. `docs/06_status/lanes/*.json` is the only source of active lane truth after this rewrite.

### 9.2 Phase 1 read tolerance

`codex-status` and `codex-classify` still read `.claude/lanes.json`. That is tolerated in Phase 1 and explicitly out of scope (§12). Their migration is separate follow-up lanes.

### 9.3 No dual-write

Dual-write is forbidden. Receive must not write to both `.claude/lanes.json` and the manifest. This is the invariant the whole migration exists to enforce.

### 9.4 No migration script, no deletion

Historical entries in `.claude/lanes.json` are not converted to manifests. The file is not deleted. Both are deferred until every legacy reader is migrated.

### 9.5 Banned identifiers (mirror dispatch)

After the rewrite, `scripts/codex-receive.ts` must contain none of:

- `LANES_FILE`
- `readRegistry`
- `writeRegistry`
- `LaneEntry`
- `LaneRegistry`

A static source-grep test (mirroring `codex-dispatch.test.ts`) must assert their absence.

---

## 10. Verification gate: removed

This is the largest behavioral delta and warrants its own section.

### 10.1 Why remove it

The legacy `codex-receive` ran `pnpm type-check` and `pnpm test` on the Codex branch, potentially switching branches and stashing local changes to do so. This was done to produce a human-friendly PASS/FAIL summary before merge.

Every part of that is a drift risk:

1. **PR CI is the authoritative branch-level gate.** It runs the full `pnpm verify` pipeline (env + lint + type-check + build + manifest check + test + test:db) per `REQUIRED_CI_CHECKS.md`. A second local run can (a) disagree with CI because of env drift, (b) pass while CI fails because the local clone has different state, (c) fail while CI passes because the local checkout has unrelated modifications.
2. **`ops:truth-check` is the authoritative lane-level done-gate.** It runs on `ops:lane-close` and checks tier-appropriate proof. Receive duplicating a subset of its checks creates two verdicts for the same code.
3. **Branch-switching + stash operations mutate local state** in a tool that is supposed to be informational. The legacy implementation stashed local changes, checked out the return branch, ran tests, checked back out, and unstashed. Every step there is a recoverability hazard.
4. **The `--skip-tests` flag advertised the duplication as waivable**, which is worse than not having the gate at all — it let operators bypass the illusion of a gate while still thinking one existed.

### 10.2 What replaces it

Nothing, in `codex-receive`. The canonical verification surface is unchanged and already sufficient:

- **PR level:** GitHub Actions runs `pnpm verify` automatically on `pull_request` triggers per `.github/workflows/ci.yml`. That is the branch gate.
- **Lane level:** `pnpm ops:lane-close <issue>` runs `ops:truth-check` per `TRUTH_CHECK_SPEC.md`. That is the done-gate.
- **Tier level:** `/verification` skill + `/t1-proof` skill govern tier-specific evidence. That is the tier gate.

Receive's job is the state transition only.

### 10.3 What receive still does locally

Receive still performs **read-only** local git checks:

- `git fetch origin <branch>` (best-effort; warning on failure)
- `git rev-parse --verify refs/remotes/origin/<branch>` or `refs/heads/<branch>`
- `git merge-base <branch> main` and `git diff --name-only` for a human diff summary (printed; not recorded in the manifest)

These are read-only and do not mutate local state. They exist so receive fails loudly when Codex reports a branch that does not exist. The diff summary is narrative-only (appears in stdout and the Linear comment footer if desired) and is **never written to the manifest**. `files_changed` is populated at merge time by the eventual merge writer, not by receive.

---

## 11. Closeout expectations

Receive is explicitly **not** a close. The canonical close path remains:

1. Codex worker pushes branch and opens PR.
2. Operator runs `pnpm codex:receive -- --issue <ID> --branch <branch> --pr <url>` — transitions manifest to `in_review`, links PR, posts Linear comment.
3. CI goes green on the PR (authoritative branch-level gate).
4. Merge happens (per `DELEGATION_POLICY.md` tier rules; T1 needs PM `t1-approved` label).
5. Post-merge, `manifest.status` is `in_review` still; some reconciliation path (`ops:reconcile` or the merge event itself) transitions to `merged`. This is **out of scope for Phase 1 receive** — receive does not touch the `in_review → merged` edge.
6. Operator runs `pnpm ops:lane-close <UTV2-###>` — runs `ops:truth-check` and transitions to `done`.

Receive owns step 2 exclusively. Steps 3–6 happen elsewhere. Receive must not invoke `ops:truth-check`, `ops:lane-close`, or any merge automation.

---

## 12. Out of scope for Phase 1

Explicitly deferred. Do not bundle into the receive rewrite.

1. **Migration of `codex-status`.** Still reads `.claude/lanes.json`.
2. **Migration of `codex-classify`.** Still reads `.claude/lanes.json`.
3. **Deletion of `.claude/lanes.json`.** Deferred until every reader is migrated.
4. **`in_review → merged` transition writer.** Phase 1 does not define this. The manifest stays in `in_review` until `ops:lane-close` runs truth-check (which permits `in_review → merged → done` as the truth-check flow transitions internally, or via a future `ops:reconcile`). Adding a dedicated merge-transition writer is a separate lane.
5. **Populating `manifest.files_changed` at merge time.** Deferred to a merge-time writer. Receive never writes `files_changed`.
6. **Populating `manifest.commit_sha` at merge time.** Same — deferred to the merge writer.
7. **Auto-detection of PR state via GitHub API** (e.g., receive checking if CI has passed before transitioning). Phase 1 is blind to GitHub CI state. That check lives in `ops:ci-doctor` (cadence) and `ops:truth-check` (merge-time).
8. **Running `ops:lane-link-pr` for `codex-cloud` lanes.** Phase 1 covers `codex-cli` only. `codex-cloud` merge flow is governed separately by `MP_M8_SYNDICATE_MODEL_GOVERNANCE_CONTRACT.md`.
9. **Replacing the Linear comment body with a reusable `ops:lane-report` command.** Deferred. Phase 1 keeps the Linear post inside `codex-receive`.
10. **A `--regen-comment` mode** that re-reads the manifest and re-posts the Linear comment without transitioning state. Deferred. Operators can manually repost if needed.
11. **Manifest drift detection for `file_scope_lock` between dispatch and receive time.** The dispatch drift check already covered this at lane-start; receive trusts it. If Codex touched files outside the scope, that is a merge-time / PR-review concern, not a receive concern.

---

## 13. Acceptance criteria (for the rewrite PR)

The rewrite PR ships when all of the following are mechanically observable:

1. `pnpm codex:receive -- --issue UTV2-XXX --branch <branch> --pr <url> --dry-run` runs validation, does **not** spawn `ops:lane-link-pr`, does **not** post Linear, and exits `0`.
2. `pnpm codex:receive -- --issue UTV2-XXX ...` (non-dry-run) spawns `ops:lane-link-pr`, transitions the manifest to `in_review`, records `pr_url`, posts the Linear comment, and does **not** write `.claude/lanes.json`.
3. `git diff .claude/lanes.json` after a successful receive invocation is empty.
4. Running receive twice for the same issue returns exit `2` (`already_in_review`) on the second call without re-spawning the canonical writer.
5. Running receive with a manifest-branch mismatch exits `1` with `code: "branch_mismatch"` from `ops:lane-link-pr` (not from receive).
6. Running receive on a non-`codex-cli` lane exits `1` with `code: "lane_type_mismatch"`.
7. Running receive on a missing manifest exits `1` with `code: "lane_missing"` **before** spawning the canonical writer.
8. `scripts/codex-receive.ts` contains no references to `LANES_FILE`, `readRegistry`, `writeRegistry`, `LaneEntry`, `LaneRegistry`, `pnpm type-check` (as a verification gate), `pnpm test` (as a verification gate), `--skip-tests`, or `skipTests`.
9. `scripts/codex-receive.ts` spawns `pnpm ops:lane-link-pr` and no longer defines its own `LaneEntry` / `LaneRegistry` types.
10. `scripts/ops/lane-link-pr.ts` exists and exports a `main()` that implements the contract in §5. Unit tests for it live in `scripts/ops/lane-link-pr.test.ts` and cover at minimum: success, `branch_mismatch`, `status_not_transitionable` (started → in_review pass, already `in_review` → exit 2), `pr_url_invalid`, and `lane_type_mismatch`.
11. `pnpm type-check` and `pnpm test` pass.
12. A static source test in `scripts/codex-receive.test.ts` (mirroring the dispatch one) asserts the banned identifiers are absent and that `--skip-tests` is rejected.

Acceptance criterion 12 is the mechanical anti-drift guard. It must exist.

---

## 14. Related documents

| Topic | Document |
|---|---|
| Execution truth model | `docs/05_operations/EXECUTION_TRUTH_MODEL.md` |
| Lane manifest schema + lifecycle | `docs/05_operations/LANE_MANIFEST_SPEC.md` |
| Truth-check spec (done-gate) | `docs/05_operations/TRUTH_CHECK_SPEC.md` |
| Preflight spec | `docs/05_operations/PREFLIGHT_SPEC.md` |
| Codex dispatch integration spec (sister spec) | `docs/05_operations/CODEX_DISPATCH_INTEGRATION_SPEC.md` |
| Delegation policy | `docs/05_operations/DELEGATION_POLICY.md` |
| Required CI checks inventory | `docs/05_operations/REQUIRED_CI_CHECKS.md` |
