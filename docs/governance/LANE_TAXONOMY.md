# Lane Taxonomy — Unit Talk V2

**Status:** Canonical  
**Authority:** `docs/05_operations/EXECUTION_TRUTH_MODEL.md` §2  
**Issued under:** UTV2-955  
**Effective:** 2026-05-15  

This document formalizes the eight execution lane types in Unit Talk V2. Each type carries binding rules on paths, proof, merge authority, and concurrency. Lane concurrency limits and forbidden combinations are in `LANE_CONCURRENCY_POLICY.md`.

---

## How to use this document

Every active lane must declare a `lane_type` in its manifest. The type is immutable once the lane is started. If a task spans multiple types, it must be split into one lane per type before dispatch.

The executor routing layer (`/three-brain`) uses this taxonomy to determine executor assignment and required ceremony. CI may enforce type-specific rules via `proof-coverage-guard.yml`.

---

## Lane types

### 1. Runtime Lane

**Purpose:** Changes to the live pick pipeline: submission, lifecycle FSM, promotion, grading, distribution, outbox, delivery adapters, and settlement.

| Dimension | Value |
|---|---|
| **Tier** | T1 mandatory |
| **Default executor** | Claude (Opus) |
| **Codex eligible?** | No — T1 requires direct PM dialogue |

**Allowed paths:**
- `apps/api/src/` (full access within T1 scope)
- `apps/worker/src/`
- `packages/db/src/lifecycle.ts`, `packages/db/src/repositories.ts`, `packages/db/src/runtime-repositories.ts`
- `packages/domain/src/` (with Tier C approval)
- `packages/contracts/src/` (with Tier C approval)
- `supabase/migrations/**` (see Migration lane for separation rules)

**Forbidden paths:**
- `apps/command-center/**`, `apps/discord-bot/**`, `apps/smart-form/**` (UI — use Delivery/UI lane)
- `docs/**` except proof artifacts
- `scripts/**` except scripts that are direct runtime dependencies
- Any file under another active Runtime lane's `file_scope_lock`

**Required proof artifacts:**
- Evidence bundle (`docs/06_status/proof/UTV2-###/evidence.json`) tied to merge SHA
- `pnpm test:db` green — last 30 lines in PR body under `## Live-DB proof`
- R-level compliance output in PR body

**Merge authority:** PM `t1-approved` label required. Orchestrator never merges autonomously.

**CI expectations:**
- Full `pnpm verify` green on merge SHA
- `proof-coverage-guard.yml` must pass
- No open concurrent Runtime or Migration lane

**Lifecycle states:** `started → in_progress → in_review → merged → done`

**Forbidden concurrent lane types:** Migration (see `LANE_CONCURRENCY_POLICY.md` §3)

---

### 2. Modeling Lane

**Purpose:** Model development, scoring logic, CLV calculation, shadow scoring, prediction evaluation, and model-driven pick scoring.

| Dimension | Value |
|---|---|
| **Tier** | T1 or T2 depending on whether scoring weights enter the live pick path |
| **Default executor** | Claude |
| **Codex eligible?** | T2 shadow-only work only |

**Allowed paths:**
- `packages/domain/src/models/` and model evaluation code
- `apps/api/src/model-driven/` (if isolated to model scoring, not pick lifecycle)
- `scripts/live-data-lab-runner.ts`, `scripts/shadow-scoring-runner.ts`
- `docs/05_operations/MODELING_SEQUENCE.md` (documentation updates only)

**Forbidden paths:**
- `apps/api/src/distribution-service.ts` (routing — Tier C, Runtime lane)
- `supabase/migrations/**` (Migration lane)
- `packages/db/src/lifecycle.ts` (Runtime lane)
- Any path that would activate `shadow_mode = false` in Phase 2

**Required proof artifacts:**
- Shadow scoring report at `artifacts/shadow-report.json`
- Live-data-lab output if `r2-determinism` rule triggers
- If T1: evidence bundle + `pnpm test:db`

**Merge authority:**
- T2 shadow-only: orchestrator on green after Claude diff-review
- T1 live path: PM `t1-approved` label required

**CI expectations:**
- `pnpm verify` green
- Shadow report artifact present if any scoring logic changed
- No concurrent Modeling lane

**Lifecycle states:** `started → in_progress → in_review → merged → done`

**Forbidden concurrent lane types:** No concurrent Modeling lanes. May coexist with Hygiene and Governance lanes.

---

### 3. Verification Lane

**Purpose:** Assembling proof bundles, running runtime verification, gathering live-DB evidence, and producing evidence bundles for T1 closes. This lane type generates artifacts; it does not implement features.

| Dimension | Value |
|---|---|
| **Tier** | T2 (verification coordination) or T3 (evidence-only) |
| **Default executor** | Claude |
| **Codex eligible?** | No — requires direct DB access and PM-gated exit |

**Allowed paths:**
- `docs/06_status/proof/**`
- `scripts/ops/` (verification scripts, read-only DB queries)
- Test files for the issue under verification (adding coverage, not changing behavior)

**Forbidden paths:**
- Source code of the feature being verified (verification is read-only; implementation is a separate Runtime/Modeling lane)
- `supabase/migrations/**`
- `packages/domain/src/**` or `packages/contracts/src/**` (no contract changes from verification)

**Required proof artifacts:**
- Evidence bundle at `docs/06_status/proof/UTV2-###/evidence.json` tied to merge SHA
- `pnpm test:db` output for T1 verification targets

**Merge authority:** Orchestrator on green for T3 evidence-only. T2 verification requires PM review of the evidence bundle before close.

**CI expectations:**
- `pnpm verify` green (only docs and scripts change — fast pass)
- Evidence bundle validates against schema

**Lifecycle states:** `started → in_proof → in_review → merged → done`

**Forbidden concurrent lane types:** At most one Verification lane per target issue. Multiple Verification lanes across different target issues are allowed.

---

### 4. Hygiene Lane

**Purpose:** Non-behavioral cleanup: dead code removal, lint fixes, comment corrections, type annotation tightening, test coverage additions (without behavior change), unused import removal, dependency cleanup within a single package.

| Dimension | Value |
|---|---|
| **Tier** | T3 (by definition — any behavioral change escalates to T2) |
| **Default executor** | Codex (T2 clear-scope) or Claude (T3) |
| **Codex eligible?** | Yes — preferred executor for bounded hygiene |

**Allowed paths:**
- Any single app or single package within declared `file_scope_lock`
- Test files (adding coverage without changing test subject behavior)
- `scripts/**` (non-runtime helpers)

**Forbidden paths:**
- `supabase/migrations/**`
- `packages/contracts/src/**`
- `packages/domain/src/**` lifecycle or scoring logic
- `apps/api/src/distribution-service.ts`
- Any file in another active lane's `file_scope_lock`
- Any change that would alter observable pick pipeline behavior (auto-escalates to Runtime lane)

**Required proof artifacts:**
- None beyond CI green; `pnpm verify` pass

**Merge authority:** Orchestrator on green. No PM touchpoint required if all of the following hold: (1) T3 label, (2) no Tier C path touches, (3) CI green on merge SHA.

**CI expectations:**
- `pnpm verify` green
- Diff review confirms zero behavioral changes
- R-level check: only `r0-ci` should trigger (no r2/r3/r4 artifacts required)

**Lifecycle states:** `started → in_progress → in_review → merged → done`

**Forbidden concurrent lane types:** No two Hygiene lanes may touch the same file. Up to 3 Hygiene lanes total across distinct file scopes.

---

### 5. Migration Lane

**Purpose:** Schema migrations, DDL changes, Supabase migration files, row-level security policy updates, and generated type regeneration. The highest-blast-radius lane type.

| Dimension | Value |
|---|---|
| **Tier** | T1 mandatory |
| **Default executor** | Claude only |
| **Codex eligible?** | No — never |

**Allowed paths:**
- `supabase/migrations/` (the migration file itself)
- `packages/db/src/database.types.ts` (generated — only via `pnpm supabase:types` after migration merges)
- Minimal README or ops documentation for the migration

**Forbidden paths:**
- All source code outside migration scope (split into a separate Runtime lane if code changes are needed)
- Any file another active lane has locked
- `packages/db/src/lifecycle.ts`, `repositories.ts`, `runtime-repositories.ts` (Runtime lane; separate PR)

**Required proof artifacts:**
- Evidence bundle with rollback drill confirmation
- `pnpm test:db` green
- Migration file reviewed and signed off in PR description
- Proof that serial deploy order is respected (cite any related migration that must precede/follow)

**Merge authority:** PM `t1-approved` label. Orchestrator never merges autonomously. Serial deploy: no concurrent Migration lane, no concurrent Runtime lane.

**CI expectations:**
- `pnpm verify` green
- DB smoke test green on merge SHA
- No other Migration or Runtime PR open at time of merge

**Lifecycle states:** `started → in_progress → in_review → merged → done`

**Forbidden concurrent lane types:** ALL other Migration lanes; Runtime lanes; any lane with a `file_scope_lock` touching `supabase/**` or `packages/db/src/**`.

---

### 6. Governance Lane

**Purpose:** Documentation, operational policies, contracts-as-prose, specs, taxonomy definitions, and authority documents. No code behavior changes. This issue is itself a Governance lane.

| Dimension | Value |
|---|---|
| **Tier** | T3 default; T2 if the doc tightens existing runtime constraints; Tier C if it amends `DELEGATION_POLICY.md` or the proof-coverage-guard's sensitive-path list |
| **Default executor** | Claude |
| **Codex eligible?** | No — governance requires human judgment on policy semantics |

**Allowed paths:**
- `docs/05_operations/**` (operational playbooks and policies)
- `docs/governance/**` (this directory)
- `docs/02_architecture/**` (architecture documents)
- `docs/06_status/**` (status docs, non-proof)
- `.claude/commands/**` (skill definitions)
- `.github/**` (CI workflows, additions only — not lowering checks)

**Forbidden paths:**
- `apps/**`, `packages/**`, `supabase/**` — any code changes
- `docs/06_status/proof/**` (Verification lane owns proof artifacts)
- `docs/05_operations/DELEGATION_POLICY.md` without PM Tier C approval in session (self-amendment protection)

**Required proof artifacts:**
- None beyond PR review and governance review confirmation in PR body
- For T2 (constraint-tightening): note which runtime invariant is tightened and confirm no code change is needed to enforce it

**Merge authority:**
- T3 docs: orchestrator on green
- T2 constraint docs: orchestrator + PM confirmation
- Tier C (delegation policy, proof-coverage-guard sensitive paths): PM `t1-approved` equivalent — explicit PM in-session approval

**CI expectations:**
- `pnpm verify` green (fast — no code to compile for docs-only)
- If `.github/**` touched: `tier-label-check` and required CI checks must remain intact

**Lifecycle states:** `started → in_progress → in_review → merged → done`

**Forbidden concurrent lane types:** No restrictions. Up to 3 Governance lanes may coexist across distinct doc sections.

---

### 7. Delivery/UI Lane

**Purpose:** Consumer-facing surfaces: command-center pages, Discord bot response formatting, smart-form UX flows. Changes to what members see and interact with. Does not touch the write path.

| Dimension | Value |
|---|---|
| **Tier** | T2 default (member-visible); T3 for isolated non-member-facing scaffolding |
| **Default executor** | Codex (T2 clear-scope) or Claude |
| **Codex eligible?** | Yes for bounded, isolated UI changes |

**Allowed paths:**
- `apps/command-center/**`
- `apps/discord-bot/**`
- `apps/smart-form/**`
- `apps/qa-agent/**` (QA scaffolding for the above)
- Shared UI component libraries within the app boundary

**Forbidden paths:**
- `packages/domain/src/**` (business logic — Runtime lane)
- `packages/contracts/src/**` (cross-package contracts — Tier C)
- `apps/api/src/distribution-service.ts` (routing — Runtime lane)
- Any Discord channel activation for deferred targets (`exclusive-insights`, `game-threads`, `strategy-room`) — always-escalate regardless of tier
- Creating new delivery targets or Discord channels without explicit PM in-session instruction

**Required proof artifacts:**
- QA-experience report (`pnpm qa:experience --regression --mode fast`) if applicable
- Playwright screenshot evidence or passing QA test for visual changes
- For T2: orchestrator diff-review confirming no write-path touches

**Merge authority:**
- T2 clear-scope (Codex): orchestrator merge on green + Claude diff-review, no PM_VERDICT required
- T2 Claude: orchestrator after PM in-session review
- Any new delivery target or Discord channel wiring: always-escalate

**CI expectations:**
- `pnpm verify` green
- QA experience report present if visual regression is possible
- No deferred Discord channel code activated

**Lifecycle states:** `started → in_progress → in_review → merged → done`

**Forbidden concurrent lane types:** No two Delivery/UI lanes may touch the same app. One lane per app at a time.

---

### 8. Data/Canonical Lane

**Purpose:** Canonical truth definitions: market type mappings, provider aliases, canonical pick schema extensions, and data correctness scripts. The write path for canonical reference data that the pipeline reads from.

| Dimension | Value |
|---|---|
| **Tier** | T1 if canonical data drives live scoring or distribution; T2 if isolated to reference tables only |
| **Default executor** | Claude |
| **Codex eligible?** | T2 isolated reference-table work only |

**Allowed paths:**
- `packages/db/src/` (read patterns and canonical reference queries)
- `scripts/data-canonical/` (canonical data correction scripts)
- `docs/02_architecture/**` (canonical data model docs)
- `supabase/migrations/**` for canonical schema additions (promotes to Migration lane; separate PR required)

**Forbidden paths:**
- Live DB row mutations outside the normal write path (always-escalate)
- `packages/domain/src/` lifecycle logic (Runtime lane)
- `apps/api/src/distribution-service.ts` (Runtime lane)

**Required proof artifacts:**
- Database truth query output confirming canonical data state after change
- Evidence bundle for T1 changes; `pnpm test:db` for any change touching live canonical tables
- If a migration is involved: Migration lane proof bundle required separately

**Merge authority:**
- T1 live canonical data: PM `t1-approved` label
- T2 reference-only: orchestrator after Claude diff-review confirms no live-path impact

**CI expectations:**
- `pnpm verify` green
- `pnpm test:db` for T1 and any change touching `provider_market_aliases`, `market_type_id`, or canonical offer tables
- No concurrent Migration lane

**Lifecycle states:** `started → in_progress → in_review → merged → done`

**Forbidden concurrent lane types:** Migration lanes; any lane touching the same canonical reference tables.

---

## Lane type summary table

| Lane | Tier | Executor | Codex OK? | PM gate? | Max concurrent |
|---|---|---|---|---|---|
| Runtime | T1 | Claude | No | Yes (merge) | 1 |
| Modeling | T1/T2 | Claude | T2 shadow only | T1: yes | 1 |
| Verification | T2/T3 | Claude | No | T1 target: yes | Unlimited (1 per target) |
| Hygiene | T3 | Codex/Claude | Yes | No | 3 (distinct files) |
| Migration | T1 | Claude | No | Yes (plan+merge) | 1; blocks Runtime |
| Governance | T3/T2 | Claude | No | T3: no; Tier C: yes | 3 (distinct sections) |
| Delivery/UI | T2/T3 | Codex/Claude | T2 clear-scope | T2 member-visible | 1 per app |
| Data/Canonical | T1/T2 | Claude | T2 ref-only | T1: yes | 1; no concurrent Migration |

---

## Determining lane type for a new issue

Use this decision tree:

1. Does the issue touch `supabase/migrations/**`? → **Migration lane** (regardless of anything else)
2. Does the issue change live pick lifecycle, promotion, grading, distribution, or outbox? → **Runtime lane**
3. Does the issue change model scoring weights or shadow scoring paths? → **Modeling lane**
4. Does the issue change only canonical reference data (market types, aliases)? → **Data/Canonical lane**
5. Does the issue change only consumer-facing UI (command-center, Discord bot, smart-form)? → **Delivery/UI lane**
6. Does the issue produce proof artifacts for a closed or in-flight implementation? → **Verification lane**
7. Does the issue change only documentation, specs, or operational policies? → **Governance lane**
8. Does the issue clean up non-behavioral code (lint, types, unused imports)? → **Hygiene lane**

If the issue spans more than one type, it must be split. Cross-type single-lane issues are not permitted.

---

## Authoritative references

- `docs/05_operations/DELEGATION_POLICY.md` — authorization tiers (Tier A/B/C), sensitive-path matrix, always-escalate categories
- `docs/05_operations/LANE_MANIFEST_SPEC.md` — manifest schema, file-scope lock rules
- `docs/05_operations/EXECUTION_TRUTH_MODEL.md` — truth hierarchy, lifecycle transitions
- `docs/governance/LANE_CONCURRENCY_POLICY.md` — concurrency matrix and forbidden combinations
- `docs/governance/PROOF_BUNDLE_STANDARD.md` — per-lane proof bundle requirements (detail)
