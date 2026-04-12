# `ops:truth-check` — Specification

**Status:** Canonical, implementation-ready
**Authority:** `EXECUTION_TRUTH_MODEL.md` §3 (Done-State Law)
**Implementer:** Codex-safe after this spec is ratified
**Script path (target):** `scripts/ops/truth-check.ts`
**Package script (target):** `pnpm ops:truth-check -- <UTV2-###>`

This spec defines the mechanical done-gate for all Unit Talk V2 lanes. Truth-check is the single authority that decides whether an issue is Done. It is run by `ops:lane:close`, by scheduled reconciliation, and on demand.

Implementation must not deviate from this spec without an update to this document.

---

## 1. Purpose

Deterministically answer one question: **"Is this Linear issue actually Done, per repo and artifact truth, right now?"**

Truth-check never infers. It mechanically checks conditions against rank-1 and rank-2 sources (GitHub main, proof bundle) and rank-3 (lane manifest). It does not read chat, memory, or agent claims.

---

## 2. Inputs

### Required
- `issue_id` (string, format `UTV2-\d+`) — the Linear issue under test.

### Derived (from repo + manifest + Linear)
- **Lane manifest** at `docs/06_status/lanes/<issue_id>.json` — must exist.
- **Linear issue record** — fetched via Linear API.
- **GitHub merge commit** — derived from `manifest.pr_url` → merge SHA.
- **Proof artifact paths** — from `manifest.expected_proof_paths`.
- **Tier label** — from Linear issue labels.

### Environment
- `LINEAR_API_KEY`
- `GITHUB_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY` (only if tier requires runtime proof)

Missing env → exit code `3` (infrastructure failure), never `1` (truth failure). These exit codes must not overlap.

---

## 3. CLI Form

```
pnpm ops:truth-check -- <UTV2-###> [flags]

Flags:
  --json              emit machine-readable output to stdout (required for CI, lane-close)
  --tier <T1|T2|T3>   override tier derivation (audit only; logged as override)
  --since <sha>       re-check as of a historical SHA (for post-merge reopen detection)
  --no-runtime        skip runtime proof checks (T2/T3 only; rejected for T1)
  --explain           emit per-check reasoning to stderr
```

**Exit codes:**
| Code | Meaning |
|---|---|
| `0` | Truth-check PASS — issue is Done |
| `1` | Truth-check FAIL — one or more checks failed (see output) |
| `2` | Issue not eligible for truth-check (not merged yet, still Ready, etc.) |
| `3` | Infrastructure failure (env missing, API unreachable, manifest missing) |
| `4` | Reopen condition detected on previously-Done issue |

Code `2` is not a failure — it means "come back later." Code `4` is distinct from `1` because it triggers reopen automation, not a fix.

---

## 4. Checks Performed

Checks run in declared order. First failure determines exit code, but **all checks run** and all results are emitted in JSON output. This is critical for PM review — seeing all failures at once is faster than iterating.

### 4.1 Manifest Checks (always)

| ID | Check | Fail Exit |
|---|---|---|
| `M1` | Manifest file exists at `docs/06_status/lanes/<issue_id>.json` | `3` |
| `M2` | Manifest schema validates against `lane_manifest_v1.schema.json` | `3` |
| `M3` | `manifest.issue_id` matches CLI arg | `3` |
| `M4` | `manifest.status ∈ {merged, done}` (else exit `2`) | `2` |
| `M5` | `manifest.pr_url` is set and parseable | `1` |
| `M6` | `manifest.commit_sha` is set | `1` |
| `M7` | `manifest.expected_proof_paths` is non-empty for T1/T2 | `1` |

### 4.2 GitHub Checks (always)

| ID | Check | Fail Exit |
|---|---|---|
| `G1` | PR at `manifest.pr_url` exists and is in `MERGED` state | `1` |
| `G2` | PR merge commit SHA == `manifest.commit_sha` | `1` |
| `G3` | Merge commit is reachable in `main` first-parent history | `1` |
| `G4` | CI check runs on merge commit are all green (required checks only) | `1` |
| `G5` | No commits on `main` after merge SHA touch `files_changed` without a linked follow-up issue (24h window) | `4` |

### 4.3 Linear Checks (always)

| ID | Check | Fail Exit |
|---|---|---|
| `L1` | Linear issue exists | `3` |
| `L2` | Linear issue has exactly one tier label (`t1`, `t2`, or `t3`) | `1` |
| `L3` | Linear issue `state` ∈ permitted states for lane phase (In Review or Done) | `1` |
| `L4` | Linear issue PR attachment matches `manifest.pr_url` | `1` |
| `L5` | If tier == T1, Linear PR carries label `t1-approved` | `1` |

### 4.4 Proof Checks (tier-gated)

**All tiers:**

| ID | Check | Fail Exit |
|---|---|---|
| `P1` | Every path in `expected_proof_paths` exists | `1` |
| `P2` | Each proof file is non-empty and readable | `1` |
| `P3` | Each proof file contains `manifest.commit_sha` in its header or a machine-parsed `merge_sha:` field | `1` |
| `P4` | Proof file `mtime` is ≥ merge commit timestamp (stale rejection) | `1` |

**T1 additions:**

| ID | Check | Fail Exit |
|---|---|---|
| `P5` | At least one proof path resolves to an evidence bundle matching `evidence_bundle_v1.schema.json` | `1` |
| `P6` | Evidence bundle declares `schema_version: 1` | `1` |
| `P7` | Evidence bundle has both `static_proof` and `runtime_proof` sections populated | `1` |
| `P8` | `static_proof` references test run logs tied to merge SHA | `1` |
| `P9` | `runtime_proof` references live DB queries, row counts, or receipts captured against the merged code | `1` |
| `P10` | `verifier.identity` is set and not equal to the implementing agent's lane identity | `1` |

**T2 additions:**

| ID | Check | Fail Exit |
|---|---|---|
| `P11` | Proof includes a diff summary file | `1` |
| `P12` | Proof includes a verification log referencing at least `pnpm type-check` and `pnpm test` outcomes | `1` |

**T3:** no additional proof checks beyond P1–P4; green CI on the merge SHA is sufficient.

### 4.5 Runtime Proof Checks (T1 only, skippable with `--no-runtime` on T2/T3)

| ID | Check | Fail Exit |
|---|---|---|
| `R1` | `runtime_proof.queries` run against Supabase (read-only) return expected row counts / states | `1` |
| `R2` | No `failed` / `dead_letter` rows introduced in monitored tables within the merge window | `1` |
| `R3` | Phase-boundary invariants (grep guard patterns from `phase-boundary-guard`) hold at merge SHA | `1` |

**Static proof** = things verifiable without running the merged code (CI logs, diffs, schema validation, file contents).
**Runtime proof** = things that require the merged code to have run against live or staging infrastructure (row counts, receipts, audit log entries, delivery outcomes).

T1 requires **both**. T2 may substitute runtime proof with a verification log. T3 requires neither beyond CI.

---

## 5. Output

### 5.1 Machine-readable (`--json`)

```json
{
  "schema_version": 1,
  "issue_id": "UTV2-###",
  "tier": "T1",
  "verdict": "pass" | "fail" | "ineligible" | "reopen" | "infra_error",
  "exit_code": 0,
  "merge_sha": "abc123...",
  "pr_url": "https://github.com/...",
  "checked_at": "2026-04-11T18:30:00Z",
  "checks": [
    { "id": "M1", "status": "pass", "detail": "..." },
    { "id": "G4", "status": "fail", "detail": "required check 'type-check' failed on merge SHA" }
  ],
  "failures": ["G4"],
  "reopen_reasons": [],
  "manifest_path": "docs/06_status/lanes/UTV2-###.json"
}
```

Output must be written to stdout. Logs and explanations go to stderr. No other stdout output is permitted when `--json` is set.

### 5.2 Human-readable (default)

- One line per check: `[PASS|FAIL] <id> — <short description>`
- Summary line: `VERDICT: <verdict>  (<N> checks, <M> failures)`
- Exit code matches JSON.

---

## 6. Pass/Fail Behavior

- **Pass (`0`):** Write pass record into manifest `truth_check_history[]` with `checked_at` and merge SHA. `ops:lane:close` proceeds. Linear transitioned to Done. Manifest `status` → `done`, `closed_at` set.
- **Fail (`1`):** Write fail record into manifest. Lane stays in `merged` or previous state. Do not transition Linear. Emit failures to stderr for agent visibility.
- **Ineligible (`2`):** No state mutation. Caller should retry later.
- **Infra error (`3`):** No state mutation. Alert PM via daily digest if persistent.
- **Reopen (`4`):** Manifest `status` → `reopened`, `reopen_history[]` appended with reasons, Linear transitioned back to In Progress, PM notified via digest. This is the only automated Linear transition out of Done.

Truth-check is idempotent for `0` and `2`. For `1` and `4`, each run appends to history.

---

## 7. Tier-Specific Behavior Summary

| Check Group | T1 | T2 | T3 |
|---|:-:|:-:|:-:|
| Manifest (M1–M7) | required | required | required |
| GitHub (G1–G5) | required | required | required |
| Linear (L1–L5) | required | required | L5 skipped |
| Proof base (P1–P4) | required | required | required |
| Proof T1 (P5–P10) | required | — | — |
| Proof T2 (P11–P12) | — | required | — |
| Runtime (R1–R3) | required | optional | skipped |

---

## 8. Stale Proof Rejection

A proof file is **stale** if any of:

- `mtime` < merge commit timestamp
- Header `merge_sha:` does not match `manifest.commit_sha`
- Evidence bundle `generated_at` predates merge commit
- File content references a prior SHA that is not reachable from the merge SHA

Stale proof fails `P3` or `P4` and cannot be waived by `--no-runtime` or any other flag. The only fix is to regenerate proof against the current merge SHA.

---

## 9. Reopen Trigger Behavior

Truth-check is the **only** automated source of reopens.

A previously-Done issue is re-checked on:
- scheduled `ops:reconcile` cron (daily) for the last 7 days of Done issues
- any commit on `main` touching files in a closed manifest's `files_changed` (hook-driven, later phase)

If re-check returns exit `4`:
1. Manifest `status` → `reopened`.
2. `reopen_history[]` gets `{timestamp, reasons[], detected_by}`.
3. Linear issue transitioned to In Progress.
4. PM notified via daily digest.
5. A new lane **may not** be started on the same issue until the reopen reason is acknowledged by `ops:lane:resume <issue_id> --ack <reason_id>`.

---

## 10. Machine-Readable Output Requirements

- Output must match `truth_check_result_v1.schema.json` (to be authored alongside implementation).
- `schema_version` is required and versioned independently of the script.
- The exit code and `verdict` field must always agree; agreement is a unit-testable invariant.
- No stdout output other than the JSON object when `--json` is set.
- Timestamps are ISO-8601 UTC.
- Check IDs (`M1`, `G4`, etc.) are stable contracts — never renumber. Additions append.

---

## 11. Non-Goals

- Truth-check does not fix anything. It reports.
- Truth-check does not evaluate code quality, test coverage, or "good enough."
- Truth-check does not parse prose. If a check is not mechanically expressible, it does not belong here.
- Truth-check does not consult agent memory or session context.

---

## 12. Implementation Notes (non-binding, helpful)

- Prefer `@octokit/rest` for GitHub, the existing Linear SDK for Linear, and the existing Supabase service client for runtime checks.
- All external calls must have a 10s timeout and 1 retry; timeouts → exit `3`.
- Unit tests must cover each check ID with a pass and a fail fixture.
- Integration test: run `ops:truth-check` against a real merged T3 issue and assert `verdict: pass`.
- The script must be idempotent, side-effect-free **except** for writing to the manifest's `truth_check_history[]` and, on pass/reopen, transitioning Linear.
