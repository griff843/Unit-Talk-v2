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
pnpm supabase:types    # regenerate database.types.ts after a migration

# Run a single test file
tsx --test apps/api/src/submission-service.test.ts
```

Environment loads `local.env` > `.env` > `.env.example`, parsed by `@unit-talk/config` (no dotenv). Supabase project ref: `zfzdnfwdarxucxtaojxm`.

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

## Active build — Phase 7A: Governance Brake

**Charter:** `docs/06_status/PHASE7_PLAN_DRAFT.md`
**Ratification:** `docs/06_status/PHASE7R_RATIFICATION.md`

Phase 7A focus: `awaiting_approval` lifecycle state + governance brake on autonomous sources. Phases 1–6 closed; their boundary rules are shipped and no longer load-bearing in governance.

---

## Lane execution expectations

Start a lane with `ops:lane:start <UTV2-###>`. Close with `ops:lane:close <UTV2-###>`. These are the only sanctioned transitions. No Done without `ops:truth-check` pass.

Before starting: preflight token valid, tier label set, file scope declared, no overlap with active lanes.
Before closing: tier-appropriate verification complete, proof tied to merge SHA, CI green on merge SHA.

Procedural details: `/lane-management` and `/verification` skills.
Canonical specs: `docs/05_operations/LANE_MANIFEST_SPEC.md`, `docs/05_operations/TRUTH_CHECK_SPEC.md`.

---

## Verification expectations

| Tier | Verification | Proof | Merge Authority |
|---|---|---|---|
| T1 | type-check + test + test:db + runtime proof | Evidence bundle v1, SHA-tied | PM `t1-approved` label |
| T2 | type-check + test + issue-specific | Diff summary + verification log | Orchestrator on green |
| T3 | type-check + test | Green CI on merge SHA | Orchestrator on green |

**Static proof** alone is never sufficient for T1. **Runtime proof** must run against real Supabase, not in-memory repos. Details: `/verification` skill.

---

## Authoritative documents

| Topic | Document |
|---|---|
| Execution truth model | `docs/05_operations/EXECUTION_TRUTH_MODEL.md` |
| Done-gate (`ops:truth-check`) | `docs/05_operations/TRUTH_CHECK_SPEC.md` |
| Lane manifest schema + lifecycle | `docs/05_operations/LANE_MANIFEST_SPEC.md` |
| Delegation policy (tiers, reshaping) | `docs/05_operations/DELEGATION_POLICY.md` |
| Evidence bundle template | `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` |
| Docs authority map | `docs/05_operations/docs_authority_map.md` |
| Program status | `docs/06_status/PROGRAM_STATUS.md` |
| Codebase guide (architecture reference) | `docs/CODEBASE_GUIDE.md` |
| Phase 7 charter | `docs/06_status/PHASE7_PLAN_DRAFT.md` |
| SGO / provider knowledge | `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` |
| Known debt | `docs/06_status/KNOWN_DEBT.md` |
| Governed loop (PR schemas + gates) | `docs/05_operations/GOVERNED_LOOP_SPEC.md` |
| Executor result schema | `docs/05_operations/schemas/executor-result-v1.md` |
| PM verdict schema | `docs/05_operations/schemas/pm-verdict-v1.md` |
| Proof template | `docs/06_status/proof/PROOF-TEMPLATE.md` |

---

## Skills (invoke by name)

| Skill | When to use |
|---|---|
| `/execution-truth` | deciding if work is Done; reconciling narrative vs artifacts |
| `/lane-management` | starting, progressing, blocking, closing any lane |
| `/verification` | before any merge claim or `ops:truth-check` call |
| `/code-structure` | touching package/app boundaries, imports, or generated files |
| `/betting-domain` | touching CanonicalPick, scoring, promotion, lifecycle, CLV, grading |
| `/outbox-worker` | touching outbox polling, delivery adapter, retry, circuit breaker |
| `/system-state-loader` | session start or after `/clear` |
| `/t1-proof` | assembling a T1 evidence bundle |
| `/linear-sync` | updating Linear state |
| `/db-verify` | live DB verification |
| `/systematic-debugging` | structured debugging when a fix resists quick diagnosis |

All skills live in `.claude/commands/`. Add new skills there; do not expand this file.

---

## Session discipline

- Before any work, run `git fetch origin && git pull --ff-only origin main` to ensure local main matches remote. Stale local state produces false premises.
- Run `/clear` at major task boundaries.
- After `/clear`, re-read this file and invoke `/system-state-loader`.
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
