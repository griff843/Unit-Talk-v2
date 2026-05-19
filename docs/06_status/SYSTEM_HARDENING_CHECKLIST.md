# System Hardening Checklist

Tracking document for the orchestration hardening initiative (2026-05-19).
Implementation order: Phase 1 → Phase 2 → Phase 3. Do not start Phase 2 until Phase 1 PRs merge. Do not start Phase 3 until Phase 2 PRs merge.

---

## Phase 1 — Determinism (run in parallel)

| # | Item | File(s) | Status | PR |
|---|------|---------|--------|-----|
| 1.1 | lane-governor mandatory before every dispatch | `dispatch.md`, `dispatch-board.md` | ✅ merged | #778 |
| 1.2 | Codex health check at session start | `session-start.sh` | ✅ merged | #784 |
| 1.3 | agent-brief guaranteed in every execution packet | `execution-packet.ts` | ✅ merged | #781 |
| 1.4 | Fix settings.json hook wiring (linear-sync-reminder + Stop/Bash bug + fragile inline) | `settings.json`, new `untracked-scripts-check.sh` | ✅ merged | #785 |
| 1.5 | Clean permissions model | `settings.local.json` | ✅ live (gitignored, local only) | — |

---

## Phase 2 — State Integrity (start after Phase 1 merges)

| # | Item | File(s) | Status | PR |
|---|------|---------|--------|-----|
| 2.1 | Automatic reconciler on session start | `session-start.sh` | ✅ merged | #786 |
| 2.2 | Ops brief injected at session start | `session-start.sh` | ✅ merged | #786 |
| 2.3 | Codex path deterministic — single canonical CLI wrapper | `scripts/ops/codex-exec.ts`, `dispatch.md` | ✅ merged | #788 |
| 2.4 | Post-compact injects slot counts + Codex health | `post-compact-reinjector.sh` | ✅ merged | #787 |

---

## Phase 3 — Autonomous Orchestration (start after Phase 2 merges)

| # | Item | File(s) | Status | PR |
|---|------|---------|--------|-----|
| 3.1 | Policy-as-code schema + initial rule objects | `docs/05_operations/policies/`, `scripts/ops/policy-engine.ts` | ✅ merged | #790 |
| 3.2 | Codex-return review trigger (GitHub Actions on codex/ branch PR) | `.github/workflows/codex-return-review.yml` | ✅ merged | #789 |
| 3.3 | Post-merge QA enforcement via policy engine | policy-engine.ts + QA trigger hook | ⬜ open | — |
| 3.4 | Continuous dispatch loop (wire /loop to /dispatch-board) | `.claude/commands/loop-dispatch.md`, `CLAUDE.md` | 🔄 PR open | #792 |

---

## Architectural Addition — Policy-as-Code

Convert narrative rules (three-brain Rule 8, dispatch rules, T1 gates) into machine-readable policy objects. Format:

```json
{
  "id": "post-merge-qa",
  "trigger": "post_merge",
  "conditions": {
    "tier": ["T2", "T3"],
    "paths": ["apps/worker/**", "apps/command-center/**"]
  },
  "actions": ["pnpm qa:experience"],
  "escalate_to_griff": false
}
```

Enforced by `policy-engine.ts` at runtime, not by prose in skill files. Skill files reference policy IDs, not duplicate logic.

**Implementation sequence:** schema design → initial policy objects → hook integration → retire the prose equivalents.

---

## Notes

- Phase 3 autonomous loop is intentionally last. Autonomous amplification of drift is worse than manual execution. Determinism + state integrity must be verified on main before enabling continuous dispatch.
- All Phase 1 branches: T3 governance lanes, no PM_VERDICT required, merge on green CI.
- PRs will reference this checklist. Update Status + PR columns as work lands.
