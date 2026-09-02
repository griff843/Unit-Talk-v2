# CLAUDE.md

Thin root instruction file for Claude Code working in Unit Talk V2. This file is stable and pointer-based. Detailed rules live in skills and canonical docs.

If this file and a canonical doc disagree, **the canonical doc wins**. Update the doc, not this file.

---

## Mission

Unit Talk V2 is a contract-first, fail-closed sports-betting pick pipeline. The current mission is
**Production Recovery** (`docs/mission/intent.md`): finish the product and get it trustworthy in
production. Claude owns the engineering plan, decomposition, sequencing and continuation; Griff owns
product intent and the reserved decisions. Execution state is the plan, the branches, the PRs and the
live runtime — not a ticket system.

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
pnpm ops:codex-packet  # run Codex against a mission work packet (see docs/mission/packets/)

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
| 2 | **Live runtime / database state** | what the system actually does right now |
| 3 | **Open PRs + their check runs** | work in flight and whether it is actually green |
| 4 | **Canonical contracts** (`docs/mission/spec.md` index) | required behavior |
| 5 | **`docs/mission/plan.md`** | current engineering intent and sequencing |
| 6 | **Linear** | portfolio and history only — never execution authority |
| 7 | **Chat / memory / agent claims / prior terminals** | context only — never authoritative |

Higher ranks win unconditionally. Historical handoffs and Linear issues are discovery material, not
current state. Lane manifests are no longer a truth rank; where one still exists it describes a
legacy lane, not the system.

---

## Core invariants (never violate)

1. `main` is shipped truth. Agent claims are never authoritative.
2. Every change lands via PR on green CI. Direct-`main` bypass is prohibited.
3. One work unit → one branch → one PR. Parallel work runs in its own worktree.
4. Evidence must bind to the code it describes. Stale evidence is invalid.
5. A diff that touches a reserved surface (`RESERVED_RISK_SURFACES.json`) merges only with Griff's
   approval artifact. Nothing else requires a human relay.
6. Production containment stays fail-closed until a mission milestone explicitly authorizes change.
7. Domain (`@unit-talk/domain`) is pure. No I/O, no DB, no HTTP, no env.
8. Apps own side effects. Packages never import from apps. Apps never import from apps.
9. Postgres outbox is the only delivery queue. Exactly one `DeliveryOutcome` per attempt.
10. Fail closed — never silent fallback to `qualified`, `pass`, or `done`.
11. If a rule can be enforced mechanically, it must not live only in prose.

---

## Current mission — Production Recovery

**Intent (human-owned):** `docs/mission/intent.md`
**Live plan (Claude-owned, rewritten as reality changes):** `docs/mission/plan.md`

Recover Unit Talk into a finished, trustworthy, production-ready product. Milestone 1 is a contained
internal Smart Form "Track Only" pilot; done is the production-readiness contract actually passing on
live evidence. Read the plan before acting — it, not this file, holds current state.

---

## Execution substrate

Work unit = a plan item in `docs/mission/plan.md`. There is no admission ceremony: if the plan says
it is executable and it touches no reserved surface, do it.

```
plan item -> worktree + branch -> commits -> PR -> green CI -> merge -> plan update
```

- **One work unit -> one branch -> one PR.** Parallel work goes in its own git worktree; the main
  checkout is the control and merge checkout. Do not branch-switch the main checkout to run parallel work.
- **Every change lands via PR on green CI.** Direct-`main` bypass stays prohibited
  (`docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md`).
- **Merge, branch-refresh and post-merge `main` sync go through `pnpm ops:merge-wrapper`** — it owns
  the merge mutex. Never call raw `gh pr merge`, `gh pr update-branch`, `git pull origin main`,
  `git merge origin/main`, or `git rebase origin/main`.
- **`docs/mission/plan.md` is updated as reality changes** — that update is part of finishing the
  work, not a separate report.
- **Delegating to Codex:** write a packet from `docs/mission/packets/TEMPLATE.md` and run
  `pnpm ops:codex-packet --packet <path>`. No lane manifest, no Linear issue.

**Lane manifests, `ops:lane-start` / `lane-close` / `truth-check`, and proof-bundle closeout are
legacy.** They still work and still govern lanes that are open today; use `/legacy:lane-recovery` to
finish those. Do not admit new work through them.

---

## Verification expectations

Verification depth follows **risk**, not lane admission. Classify with the same policy the merge gate
uses — `docs/05_operations/RESERVED_RISK_SURFACES.json` via `scripts/ops/merge-authority.cjs` — and
verify to that level.

| Diff classification | Verification | Evidence |
|---|---|---|
| `auto`, no runtime behavior change | `pnpm verify` green on the PR | green required checks |
| `auto`, changes runtime behavior | `pnpm verify` + tests that fail without the change | green checks + the test itself |
| `auto`, touches DB read/write paths | the above + `pnpm test:db` against real Supabase | pasted `test:db` output in the PR |
| `human` (reserved surface) | the above + an explicit statement of the production effect and its reversal | PR body + Griff's approval artifact |

**Evidence is a claim someone can check, not a ceremony.** A pasted command output in the PR body is
evidence. A generated bundle whose numbers nothing verifies is not. Proof bundles under
`docs/06_status/proof/**` are no longer required for ordinary work; when one is written it must still
be true, and the commit-time validator still enforces its shape.

**Static proof alone is never sufficient for a runtime claim.** Runtime claims must run against real
Supabase, not in-memory repos. Details: `/verification` skill.

**Merge Authority is defined once, mechanically, by `.github/workflows/merge-gate.yml`** — now
Risk-Scoped Merge Authority (RMA/v1), ratified 2026-09-02 under `docs/mission/intent.md`. It
supersedes the lane-manifest tier model for merge authorization. If this section and the workflow
diverge, the workflow wins and this section is stale.

Authority follows what a diff **touches**, not how its work was admitted:

| Classification | Condition | Requirement |
|---|---|---|
| `auto` | diff touches no reserved surface | green CI only — `verify`, `P0 Protocol`, `Executor Result Validation` remain independently required |
| `human` | diff touches a reserved surface | `griff-approved` label **and** a head-SHA-bound `pm-verdict/v1` APPROVED comment from CODEOWNERS — both, neither alone |

Reserved surfaces are enumerated in `docs/05_operations/RESERVED_RISK_SURFACES.json` and classified
by `scripts/ops/merge-authority.cjs`: production DDL/data, member-delivery activation, secrets,
pricing/tier authority, production containment, and merge authority itself. That last one is what
makes RMA non-self-amending — widening authority always requires a human.

Fail-closed throughout: an unreadable policy, an unavailable diff, or any unclassifiable condition
reserves the merge rather than releasing it. `governance:pause` is a hard block regardless.

The GitHub-review approval path was removed: GitHub blocks self-approval and every executor opens
PRs under the same `griff843` identity, so it was unusable in practice.

A reserved diff may be **written and opened as a PR** without Griff. The human gate is at merge, not
at the keyboard: it blocks that change, not the mission.

---

## Authoritative documents

**Mission (read first):**

| Topic | Document |
|---|---|
| **Mission intent (human-owned)** | `docs/mission/intent.md` |
| **Canonical contract index** | `docs/mission/spec.md` |
| **Live engineering plan (Claude-owned)** | `docs/mission/plan.md` |
| **Reserved surfaces requiring Griff** | `docs/05_operations/RESERVED_RISK_SURFACES.json` |
| Production readiness (the definition of done) | `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` |

`docs/mission/spec.md` indexes every canonical contract — domain, delivery, DB, safety. Use it
instead of enumerating contracts here.

**Standing references:**

| Topic | Document |
|---|---|
| Codebase guide (architecture reference) | `docs/CODEBASE_GUIDE.md` |
| Standing guardrails | `docs/05_operations/STANDING_GUARDRAILS.md` |
| Required CI checks | `docs/05_operations/REQUIRED_CI_CHECKS.md` |
| Incident response | `docs/05_operations/INCIDENT_RUNBOOK.md` |
| Advisory Gemini review (non-blocking) | `docs/05_operations/GEMINI_ADVISORY_REVIEW.md` |
| Codex work packets | `docs/mission/packets/TEMPLATE.md` |
| SGO / provider knowledge | `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` |
| Known debt | `docs/06_status/KNOWN_DEBT.md` |
| PM verdict schema | `docs/05_operations/schemas/pm-verdict-v1.md` |

**Legacy — history, not execution authority.** `LANE_MANIFEST_SPEC.md`, `TRUTH_CHECK_SPEC.md`,
`WORKFLOW_SPEC.md`, `DELEGATION_POLICY.md`, `OPERATING_MODEL_SONNET5.md`,
`EVIDENCE_BUNDLE_TEMPLATE.md`, `R1_R5_OPERATING_RULE.md`, `EXECUTION_MAP.md`. The truth *hierarchy*
in `EXECUTION_TRUTH_MODEL.md` stands; its lane lifecycle does not gate work. See
`docs/mission/spec.md` → "Deprecated as execution authority".

---

## Skills (invoke by name)

**Mission-native (primary):**

| Skill | When to use |
|---|---|
| `/mission` | orient on the mission: current plan, executable work, what is reserved |
| `/verification` | before any merge claim — what must actually be green |
| `/three-brain` | executor routing for a work unit (Claude / Codex / Explore / Griff) |
| `/pr-unblock` | a PR is red, BLOCKED, or stalled and the cause is not obvious |
| `/systematic-debugging` | structured debugging when a fix resists quick diagnosis |
| `/db-verify` | live DB verification |
| `/mutation-test` | proving a control, guard, or test actually fails on the condition it names |
| `/code-structure` | touching package/app boundaries, imports, or generated files |
| `/betting-domain` | touching CanonicalPick, scoring, promotion, lifecycle, CLV, grading |
| `/outbox-worker` | touching outbox polling, delivery adapter, retry, circuit breaker |
| `/verify-pick` | verify a specific pick end-to-end against live data |
| `/operator-runbook` | health-check, rollback, replay |

**Legacy (`/legacy:*`) — the prior Linear/lane primitive.** Retained for reading historical lanes and
for repairing lanes that are still open. They are not the execution path and must not be used to
admit new work: `legacy:dispatch`, `legacy:dispatch-board`, `legacy:loop-dispatch`,
`legacy:lane-management`, `legacy:lane-recovery`, `legacy:lane-reconciler`.

All skills live in `.claude/commands/`. Add new skills there; do not expand this file.

---

## Session discipline

- Before any work, run `git fetch origin && git pull --ff-only origin main`. Stale local state produces false premises.
- Run `/clear` at major task boundaries. After `/clear`, re-read this file and `docs/mission/plan.md`.
- Standing guardrails live in `docs/05_operations/STANDING_GUARDRAILS.md` and are auto-injected every prompt by the `UserPromptSubmit` hook. PM: edit that file instead of re-pasting guardrails in chat.
- If context degrades, clear immediately.
- Prefer code and runtime over docs for truth. If uncertain, say "check actual implementation" and check.
- Do not stop for administrative state. Stop only for the conditions in `docs/mission/intent.md` → Stop conditions.

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
