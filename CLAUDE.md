# CLAUDE.md

Thin root instruction file for Claude Code working in Unit Talk V2. This file is stable and pointer-based. Detailed rules live in skills and canonical docs.

If this file and a canonical doc disagree, **the canonical doc wins**. Update the doc, not this file.

---

## Mission

Unit Talk V2 is a contract-first, fail-closed sports-betting pick pipeline. Claude Code is the execution orchestrator: work the Linear backlog, merge on green per tier policy, and keep execution truth mechanical rather than narrative.

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

## Build status — Phase 7A: Governance Brake (SHIPPED)

**Ratification:** `docs/06_status/PHASE7R_RATIFICATION.md`
**Execution plan:** `docs/06_status/PHASE7E_EXECUTION_PLAN.md`

Phase 7A shipped: `awaiting_approval` lifecycle state + governance brake on autonomous sources. Phases 1–7A closed; boundary rules are in production. Current focus: system hardening, live-proof gating, and infrastructure provisioning (Hetzner, SGO).

---

## Lane execution expectations

Start a lane with `ops:lane-start <UTV2-###>`. Close with `ops:lane-close <UTV2-###>`. These are the only sanctioned transitions. No Done without `ops:truth-check` pass.

Before starting: preflight token valid, tier label set, file scope declared, no overlap with active lanes.

**Pre-closure checklist (7 steps — all required before `ops:lane-close`):**
1. `pnpm verify` green on the branch
2. R-level lookup in `docs/05_operations/r1-r5-rules.json` — all triggered `required[]` artifacts present
3. Proof SHA binding automated — `post-merge-lane-close.yml` runs `ops:proof-generate --merge-sha` after merge; no manual append needed
4. CI green on merge SHA (not just branch CI)
5. For T1: `pnpm test:db` green + evidence bundle generated and validated
6. Tier label auto-applied by `ops:lane-finalize`; verify tier label is set in Linear
7. `ops:truth-check` runs and exits 0

`ops:lane-close <ID>` is already the one-command post-merge entry point: it runs `ops:truth-check` internally, and on success marks the manifest `done` and transitions the Linear issue to Done — no separate manual truth-check invocation is required first. If the manifest is missing its merge SHA or drifted from the merged PR, `ops:lane-close <ID> --repair-merged` repairs it directly from GitHub's authoritative merge state (`pr.mergeSha`) before running truth-check, instead of requiring a manual `ops:lane-manifest record-merge` step. `ops:lane-finalize <ID>` remains a required separate call for tier-label application (step 6); `ops:lane-close` does not apply tier labels.

Procedural details: `/lane-management` and `/verification` skills.
Canonical specs: `docs/05_operations/LANE_MANIFEST_SPEC.md`, `docs/05_operations/TRUTH_CHECK_SPEC.md`.

---

## Verification expectations

| Tier | Verification | Proof | Merge Authority |
|---|---|---|---|
| T1 | type-check + test + test:db + runtime proof | Evidence bundle v1, SHA-tied | PM `t1-approved` label |
| T2 | type-check + test + issue-specific | Diff summary + verification log | Orchestrator on green (no PM_VERDICT) |
| T3 | type-check + test | Green CI on merge SHA | Orchestrator on green |

**Static proof** alone is never sufficient for T1. **Runtime proof** must run against real Supabase, not in-memory repos. Details: `/verification` skill.

---

## Authoritative documents

| Topic | Document |
|---|---|
| Master execution map (phases 1–8) | `docs/05_operations/EXECUTION_MAP.md` |
| Master modeling sequence (elite-core / human-like-core) | `docs/05_operations/MODELING_SEQUENCE.md` |
| Three-lane workflow spec | `docs/05_operations/WORKFLOW_SPEC.md` |
| Execution truth model | `docs/05_operations/EXECUTION_TRUTH_MODEL.md` |
| Done-gate (`ops:truth-check`) | `docs/05_operations/TRUTH_CHECK_SPEC.md` |
| Lane manifest schema + lifecycle | `docs/05_operations/LANE_MANIFEST_SPEC.md` |
| Delegation policy (tiers, reshaping) | `docs/05_operations/DELEGATION_POLICY.md` |
| Sonnet-5-era operating model (Outcome Contracts, PM gates, runtime validation by tier, cutover) | `docs/05_operations/OPERATING_MODEL_SONNET5.md` |
| Evidence bundle template | `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` |
| Docs authority map | `docs/05_operations/docs_authority_map.md` |
| Program status | `docs/06_status/PROGRAM_STATUS.md` |
| Codebase guide (architecture reference) | `docs/CODEBASE_GUIDE.md` |
| Phase 7 ratification + execution plan | `docs/06_status/PHASE7R_RATIFICATION.md`, `docs/06_status/PHASE7E_EXECUTION_PLAN.md` |
| SGO / provider knowledge | `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` |
| Known debt | `docs/06_status/KNOWN_DEBT.md` |
| Executor result schema | `docs/05_operations/schemas/executor-result-v1.md` |
| PM verdict schema | `docs/05_operations/schemas/pm-verdict-v1.md` |
| Proof template | `docs/06_status/proof/PROOF-TEMPLATE.md` |

---

## Skills (invoke by name)

| Skill | When to use |
|---|---|
| `/dispatch-board` | "clear the board" — routes entire Linear backlog, runs full loop autonomously |
| `/loop-dispatch` | continuous dispatch loop — runs /dispatch-board repeatedly until board empty or all blocked |
| `/dispatch` | execute a specific issue or pick top candidates (single dispatch cycle) |
| `/three-brain` | executor routing decision for any issue (Claude / Codex CLI / Codex Cloud / Explore / QA / Griff) |
| `/execution-truth` | deciding if work is Done; reconciling narrative vs artifacts |
| `/lane-management` | starting, progressing, blocking, closing any lane |
| `/verification` | before any merge claim or `ops:truth-check` call |
| `/code-structure` | touching package/app boundaries, imports, or generated files |
| `/betting-domain` | touching CanonicalPick, scoring, promotion, lifecycle, CLV, grading |
| `/outbox-worker` | touching outbox polling, delivery adapter, retry, circuit breaker |
| `/system-state-loader` | forced state reload after `/clear` or when hook data is suspected stale |
| `/t1-proof` | assembling a T1 evidence bundle |
| `/db-verify` | live DB verification |
| `/systematic-debugging` | structured debugging when a fix resists quick diagnosis |
| `/verify-pick` | verify a specific pick end-to-end against live data |

All skills live in `.claude/commands/`. Add new skills there; do not expand this file.

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
