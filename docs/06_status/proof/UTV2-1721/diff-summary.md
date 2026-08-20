# PROOF: UTV2-1721 — diff summary

MERGE_SHA: 3ca047fa8fcae2a8768d2ba63cace8019a5a76ca

## Summary

Bounded mechanical port of the still-valid harness and documentation corrections from PR #1429 (`chore/harness-model-depin`, head `bc4c51fd`), plus the two exact-head review findings raised against that PR. **The model de-pinning change is deliberately NOT ported.**

## Scope decision — what was ported and what was refused

PR #1429 changed 18 files (+82/-88). It bundled a model-routing policy reversal with mechanical corrections. Per the PM disposition on UTV2-1721, only the mechanical corrections are admitted.

### Ported (7 files)

| File | Category |
|---|---|
| `.claude/commands/dispatch.md` | Phase-0 gate parity; event-driven pacing (selective hunks only) |
| `.claude/commands/dispatch-board.md` | Phase-0 gate parity (`ops:substrate-guard` first, fail-closed) |
| `.claude/commands/loop-dispatch.md` | Event-driven pacing; gate-sequence parity; harvest obligation at cycle cap |
| `.claude/commands/operator-runbook.md` | Linux/WSL remediation (PowerShell -> bash) + review finding B |
| `.claude/commands/verification.md` | T2 Merge Authority table + review finding A |
| `.claude/hooks/bash-safety-guard.sh` | Exit-2 semantics documentation |
| `.claude/hooks/pre-proof-validator.sh` | Exit-2 semantics documentation |

### Refused (11 files) — model-routing policy, not cleanup

| File(s) | Why refused |
|---|---|
| `.claude/agents/*.md` (8 files) | Each change is a bare `-model: claude-sonnet-5` deletion — the de-pin itself |
| `.claude/commands/three-brain.md` | Planning/critique model-tier policy table |
| `docs/05_operations/OPERATING_MODEL_SONNET5.md` | Declares §1 model-pinning superseded |
| `.claude/agent-brief.md` | Factual doc drift, outside the four PM-named categories |

Routing policy changes belong to UTV2-1597, not to a harness cleanup lane.

### Model-control preservation — verified, not asserted

Every `model:` reference in `.claude/commands/dispatch.md` is retained byte-for-byte:

- L175 planning-subagent prose pinning `model: "sonnet"` for T1
- L181 planning `Agent({ model: "sonnet" })`
- L231 Outcome Contract body `Planning model: sonnet`
- L242 implementation `Agent({ model: "sonnet" })`
- L308 critique `Agent({ model: touchesTierC ? "opus" : "sonnet" })`
- L326 Tier C detection prose

Only three non-model hunks were taken from `dispatch.md`: the canonical-gate-sequence note, two `run_in_background: true` removals (the `Agent` tool has no such parameter — subagents run in the background natively), and the Monitor/background-Bash guidance rewrite.

## Review findings corrected

### Finding A — T2 Merge Authority omitted the executor-result path

PR #1429 asserted: *"the orchestrator's own `gh pr review --approve` after diff review satisfies the PR-review branch; no PM presence is mechanically required."*

That is wrong, and the correction is verified against the workflow rather than restated from the PR. `.github/workflows/merge-gate.yml` lines 502-543 accept **three** T2 artifacts:

1. `pm-verdict/v1` APPROVED comment from a CODEOWNERS member (L521-527)
2. a GitHub PR review approval (L516)
3. `EXECUTOR_RESULT: READY_FOR_REVIEW` / `schema: executor-result/v1` from an `AUTHORIZED_REVIEWERS` member (L528-535, UTV2-1523)

Path 3 exists precisely because author and reviewer share the `griff843` identity, so GitHub refuses the self-review. `verification.md` now documents all three and explicitly warns against assuming self-approval succeeds.

### Finding B — operator runbook env loading never reached child processes

PR #1429 instructed `source local.env`. Two defects: a bare `source` creates shell variables only, so `gh`, `psql` and `pg_restore` never see them; and selecting a single file misrepresents the loader. `loadEnvironment()` (`packages/config/src/env.ts:175-191`) parses `.env.example`, `.env` and `local.env` and merges them **per variable** in ascending precedence, so a value present only in `.env` survives when `local.env` exists.

Corrected to reproduce that layered merge under `set -a`, with the rejected first-match pattern named explicitly so it is not reintroduced. Executed across three cases — Case 1 layered merge, Case 2 the rejected first-match loop dropping a `.env`-only credential, Case 3 fail-closed with no layer present. See `verification.md` §4.

## Out of scope, recorded for follow-up

- `.claude/hooks/tier-c-path-guard.sh` header still documents exit 2 as a "non-blocking warning" while its own line 133 records the opposite. Same defect class as the two hooks corrected here, but the file is outside this lane's `file_scope_lock`.
- `.claude/agent-brief.md` factual drift (scanner flag, UTV2-520 remediation, section renumbering) from PR #1429, not ported.
- `CLAUDE.md`'s Merge Authority table carries the same two-path omission as `verification.md` did; it was not in PR #1429's diff. Assigned to UTV2-1723.

## Blast radius

Documentation and harness-guidance only. No runtime code, no schema, no migration, no dependency change. `lane_type: governance` -> `static` proof profile.
