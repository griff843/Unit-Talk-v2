# CLAUDE.md

Thin root instruction file for Claude Code working in Unit Talk V2. This file is stable and pointer-based. Detailed rules live in skills and canonical docs.

If this file and a canonical doc disagree, **the canonical doc wins**. Update the doc, not this file.

---

## Mission

Unit Talk V2 is a contract-first, fail-closed sports-betting pick pipeline. Claude Code is the execution orchestrator: work the Linear backlog, merge on green per tier policy, and keep execution truth mechanical rather than narrative.

---

## Mission — mandatory context

Mission card (compact; the full files are read on demand, not imported). Unit Talk is recovering to a finished, trustworthy, revenue-generating product. Current goal (Griff, 2026-10-13): quantity, diversity, truthful completion and reconciliation of real **Track Only** pick lifecycles with zero member delivery; no calendar pilot. SGO purchase/activation is a separate Griff gate.

**Reserved for Griff (never decide or act on these yourself; surface with prepared evidence and one recommendation):**
1. Production DDL and production data deletion
2. Member-delivery activation
3. Paid provider / subscription commitments
4. Secrets
5. Pricing and tier authority
6. Changes to production containment while containment is mandated
7. Changes to merge authority itself — the merge gate, its policy inputs, CODEOWNERS, branch protection
8. Dispatching a production deployment (`deploy.yml` is `workflow_dispatch`-only and nothing promotes on its own)

**Standing holds (until Griff changes them):** all four delivery targets (`official-picks`, `best-bets`, `trader-insights`, `exclusive-insights`) stay kill-switched; Track Only never creates delivery, and `human-capper` containment cannot deliver on its own; do not requeue or alter pick `706b136b`; never unpark anything on your own initiative (no provider or syndicate-machine unparking, containment change or member delivery); no clearing of stranded canary `processing` rows or re-enabling cron job 5; no direct-`main` bypass (all work lands by PR on green CI). Manual-fallback picks are labeled and claim neither provider verification nor CLV; never fabricate provider evidence. `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` is the only readiness threshold. PRs #1491, #1492 and #1495 are frozen pending PM architecture review (do not commit to, resume or design against them); #1451 is production DDL.

**Operating model:** changes to execution authority, merge authority, tiering, agent routing or the lane/dispatch system are PM architecture decisions, proposed in their own PR and never adopted unilaterally or bundled into a PR about something else.

**Stop conditions:** the mission runs continuously. Return to Griff only at a reserved decision with nothing else safe executable, a hard safety boundary that cannot be resolved within existing authority, or mission completion. These are NOT stop conditions: waiting on CI, review or a PR; finishing a lane or PR; having something to report; Griff asking a question, issuing a correction or giving steering (answer it, fold it in, continue). A reserved gate blocks only the work that depends on it: surface it and continue every other safe path. Continuing never licenses working around the lane, tier, proof or merge-authority contracts.

**Before planning, executing, reviewing, delegating or resuming work (including after compaction), Read `docs/mission/plan.md` §0 (Direction) and the plan section for the task at hand. Read `docs/mission/intent.md` in full when the work touches a reserved decision, authority, the operating model or a stop condition, and `docs/mission/spec.md` for contract questions.** This card carries the reserved list, standing holds and stop conditions, so it is enough to start ordinary work. `intent.md` is Griff-owned: do not change its intent without Griff ratification. `plan.md` is Claude-owned: reconcile it against live GitHub and runtime truth. Live evidence establishes current state, and canonical contracts remain authoritative for their domains. Dated readings (current truth, production position, evidence batch) live in `docs/mission/plan-readings.md`; re-measure before relying on any figure. If the card and those files disagree, the files win. Claude owns orchestration from this context; do not require Griff to restate the mission in chat.

@docs/05_operations/STANDING_GUARDRAILS.md

---

## Commands

```bash
pnpm test              # all unit tests (node:test + tsx --test)
pnpm test:db           # DB smoke test against live Supabase (runtime proof)
pnpm type-check        # TypeScript project-references build check
pnpm build             # compile all packages and apps
pnpm lint              # ESLint
pnpm verify            # env:check + lint + type-check + build + test
pnpm verify:parallel   # lint + type-check in parallel, then build + test (faster)
pnpm verify:quick      # fast pre-flight: sync-check + env + lint + type-check only
pnpm supabase:types    # regenerate database.types.ts after a migration
pnpm ops:brief         # current system state: lanes, Linear queue, runtime status
pnpm ops:digest        # daily dispatch digest — surfaces executable candidates
pnpm ops:truth-check   # done-gate for a lane (pass UTV2-### as argument)
pnpm ops:scope-suggest # auto-suggest file scope before ops:lane-start (pass --issue UTV2-###)

# Run a single test file
tsx --test apps/api/src/submission-service.test.ts
```

Environment loads `local.env` > `.env` > `.env.example`, parsed by `@unit-talk/config` (no dotenv). Supabase project ref: `zfzdnfwdarxucxtaojxm`.

Before writing any SQL against Supabase (via MCP `execute_sql` or otherwise), read `packages/db/src/database.types.ts` (or run `mcp list_tables`) for real table/column names — never guess. Regenerate it with `pnpm supabase:types` after a migration; stale types are worse than none.

Never `sleep`-then-poll for CI/merge status — the harness blocks bare sleep chains before a check command. Use a background `Monitor` until-loop or `ScheduleWakeup`, and report results proactively rather than waiting to be asked for a status update. `.github/workflows/track-a-monitor.yml` is the durable replacement for ad hoc session-cron monitoring — extend it rather than hand-rolling a new temporary cron.

---

## Truth hierarchy (ranked)

| Rank | Source | Authoritative For |
|---|---|---|
| 1 | **GitHub `main`** | shipped code, merge SHAs, CI on merge |
| 2 | **Proof bundle** (tied to merge SHA) | completion evidence |
| 3 | **Lane manifest** (`docs/06_status/lanes/*.json`) | active lane state |
| 4 | **Linear** | workflow intent, tier label, ownership |
| 5 | **Chat / memory / agent claims** | context only — never authoritative |

Higher ranks win unconditionally. Full spec: `docs/05_operations/EXECUTION_TRUTH_MODEL.md`.

---

## Core invariants (never violate)

1. `main` is shipped truth. Agent claims are never authoritative.
2. No lane without preflight. No Done without `ops:truth-check` pass.
3. One issue → one lane → one branch → one PR.
4. Proof must tie to the merge SHA. Stale proof is invalid.
5. Tier label (T1/T2/T3) is required before Ready.
6. Lane manifest is the sole authority for active lane state.
7. Domain (`@unit-talk/domain`) is pure. No I/O, no DB, no HTTP, no env.
8. Apps own side effects. Packages never import from apps. Apps never import from apps.
9. Postgres outbox is the only delivery queue. Exactly one `DeliveryOutcome` per attempt.
10. Fail closed — never silent fallback to `qualified`, `pass`, or `done`.
11. If a rule can be enforced mechanically, it must not live only in prose.

---

## Current build status

Deliberately not recorded here. This file is stable and pointer-based; a "current focus" paragraph goes stale the moment it is written and is then read as truth.

Current state, what is executable, what is blocked, and what requires Griff: **`docs/mission/plan.md`**, reconciled against live GitHub and runtime truth.

---

## Lane execution expectations

Start a lane with `ops:lane-start <UTV2-###>`. Close with `ops:lane-close <UTV2-###>`. These are the only sanctioned transitions. No Done without `ops:truth-check` pass.

Before starting: preflight token valid, tier label set, file scope declared, no overlap with active lanes.

Before closing: `pnpm verify` green, triggered R-level artifacts present, CI green on the merge SHA, T1 runtime proof, and `ops:truth-check` exit 0. The full 7-step pre-closure checklist and how `ops:lane-close` / `--repair-merged` / `ops:lane-finalize` fit together are in the `/lane-management` skill.

Procedural details: `/lane-management` and `/verification` skills.
Canonical specs: `docs/05_operations/LANE_MANIFEST_SPEC.md`, `docs/05_operations/TRUTH_CHECK_SPEC.md`.

---

## Verification expectations

| Tier | Verification | Proof | Merge Authority |
|---|---|---|---|
| T1 | type-check + test + test:db + runtime proof | Evidence bundle v1, SHA-tied | `t1-approved` label **and** `pm-verdict/v1` APPROVED comment from CODEOWNERS |
| T2 | type-check + test + issue-specific | Diff summary + verification log | GitHub PR review approval, **or** `pm-verdict/v1` APPROVED comment, **or** `executor-result/v1` self-attestation comment from a CODEOWNERS member |
| T3 | type-check + test | Green CI on merge SHA | Green CI + valid executor result — no PM verdict |

**Static proof** alone is never sufficient for T1. **Runtime proof** must run against real Supabase, not in-memory repos. Details: `/verification` skill.

**Merge Authority is defined once, mechanically, by `.github/workflows/merge-gate.yml`**; if this table and the workflow diverge, the workflow wins. PM approval is never a chat message. How T2 is satisfied in practice (the `executor-result/v1` self-attestation) is in the `/verification` skill.

---

## Authoritative documents

The full topic → document index is `docs/05_operations/AUTHORITATIVE_DOCS.md`, read on demand. The ones most often needed:

- Current state and what is executable: `docs/mission/plan.md`
- Execution truth, done-gate and lane manifest: `docs/05_operations/EXECUTION_TRUTH_MODEL.md`, `TRUTH_CHECK_SPEC.md`, `LANE_MANIFEST_SPEC.md`
- Smart Form product intent (required reading before changing Smart Form behaviour, backend included): `docs/03_product/smart-form/intent.md`
- Command Center: `docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md` is the sole authority; everything under `docs/archive/command-center/` is history only.

---

## Skills (invoke by name)

Skills live in `.claude/commands/`; each one's `description` says when to use it, and the app lists them every session. Add new skills there; do not expand this file.

---

## Session discipline

- Before any work, run `git fetch origin && git pull --ff-only origin main` to ensure local main matches remote. Stale local state produces false premises.
- Run `/clear` at major task boundaries.
- After `/clear`, re-read this file. The `UserPromptSubmit` hook auto-injects system state — invoke `/system-state-loader` only if the hook data appears stale or missing.
- Standing guardrails (things no agent may do regardless of a directive) live in `docs/05_operations/STANDING_GUARDRAILS.md` and are auto-injected every prompt by the same hook. PM: edit that file instead of re-pasting guardrails in chat.
- If context degrades, clear immediately.
- Never self-certify Done. The done-gate is `ops:truth-check`, not narrative.
- PM reviews artifacts, not narrative summaries. T1 approval is a GitHub label, not a chat message.
- Prefer code over docs for truth. If uncertain, say "check actual implementation" and check.
- The mission runs continuously. Waiting on CI, finishing a lane or PR, and having a status to report are
  not stop conditions; a reserved gate blocks only the work that depends on it, so surface it and continue
  every other safe executable path. The authoritative list of what does and does not end a session is
  `docs/mission/intent.md` § "Stop conditions" — read it there rather than inferring from this line.

---

## What this file is not

This file is not the place for:
- detailed procedural rules → skills
- schema facts or type references → `docs/CODEBASE_GUIDE.md` + generated types
- phase-specific enforcement detail → the phase's contract doc
- provider knowledge → `PROVIDER_KNOWLEDGE_BASE.md`
- execution-truth spec → `EXECUTION_TRUTH_MODEL.md`
- anti-drift prose lists → encoded as CI checks or skill red flags

If you feel the urge to add procedural detail here, add it to a skill instead.
