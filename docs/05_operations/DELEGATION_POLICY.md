# Delegation Policy — Claude Code Orchestrator

> Canonical policy for when the Claude Code orchestrator may act autonomously, when it must escalate to PM, and when it must stop regardless of apparent authorization.
>
> Adopted 2026-04-11. Authority: PM. Supersedes any ad-hoc decision-making defaults in `CLAUDE.md` that don't explicitly reference this document.
>
> **Last updated:** 2026-04-11 under UTV2-524 — codified "isolated" definition, issue-reshaping rules, sensitive-path matrix, and alignment with `SPRINT_MODEL_v2.md` T1/T2/T3.
>
> **Cross-references (no duplication):**
> - `docs/05_operations/AGENT_OPERATING_MODEL.md` — role boundaries, Linear-first reporting, anti-orchestration rules
> - `docs/05_operations/SPRINT_MODEL_v2.md` — T1/T2/T3 risk-tier sprint model (authoritative tier definitions)
> - `CLAUDE.md` — execution model, classification rules, merge policy, stop conditions

## Purpose

This document exists because the orchestrator was spending disproportionate time asking the PM for approval on individual merges, packet dispatches, and implementation option selection. That pattern is correct for T1 runtime-risk work but wasteful for bounded T2/T3 slices, documentation, and scaffolding.

The goal is to move from "ask PM every step" to "act within written bounds; escalate only when the task exceeds the bounds." This preserves PM oversight where it matters (runtime correctness, architecture, scope) and eliminates it where it doesn't (mechanical execution of clearly bounded tasks).

## Alignment with SPRINT_MODEL_v2 tiers

The three authorization tiers in this policy map onto — but do not replace — the T1/T2/T3 risk-tier sprint model in `docs/05_operations/SPRINT_MODEL_v2.md`. The sprint model defines *how much ceremony* a change needs (contract, proof bundle, rollback, verification). This policy defines *who must approve the merge*. Both apply.

| Sprint tier | Default authorization tier | Notes |
|---|---|---|
| T3 (pure-computation, docs, test coverage, no-behavior refactors) | **Tier A** if file scope is in Tier A allow-list; otherwise **Tier B** | T3 + Tier A = merge on green |
| T2 (service wrappers, cross-package integration, bounded refactors) | **Tier B** by default | Even T2 with passing tests requires PM merge touchpoint |
| T1 (migrations, routing, settlement, lifecycle, shared contracts) | **Tier C** always | Plan approval and merge approval required |

Tier label overrides file-scope eligibility. A T1 Linear issue is Tier C even if it happens to touch only `scripts/**` — because T1 classification signals PM has flagged runtime risk.

## Definition of "isolated"

Several rules below use the word "isolated." For the purposes of this policy, a change is *isolated* only when **all** of the following hold:

1. **No shared contract overlap** — the change does not touch `packages/contracts/src/**`, `packages/domain/src/**`, `packages/db/src/{lifecycle,repositories,runtime-repositories}.ts`, or any file under `docs/02_architecture/contracts/**`.
2. **No migration** — no file created or modified under `supabase/migrations/**`.
3. **No routing change** — no change to delivery targets, discord channel config, outbox routing, worker adapter wiring, or `distribution-service.ts` gating logic.
4. **No test collision** — the change does not edit tests another active lane is also editing, and does not modify a shared fixture or helper that other active lanes depend on.
5. **No cross-app spread** — the change touches at most one app under `apps/**` (plus its own tests), or is entirely within `packages/**` within a single package, or is entirely docs/scripts.
6. **No active-lane file overlap** — no other active Claude or Codex CLI lane currently has a PR or dispatch packet that touches any of the same files.
7. **Independent verification path** — the change can be verified without restarting the worker, without applying a migration, and without coordinating with another in-flight change.

If any of those seven conditions fails, the change is **not isolated** and must escalate one tier above whatever its file-scope would otherwise allow.

## Three authorization tiers

All execution falls into one of three tiers. The tier is determined by the task's risk profile, not by its Linear tier label alone.

### Tier A — Autonomous

The orchestrator may plan, dispatch, review, merge, and update Linear state without PM confirmation. PM is notified via the post-merge report but is not in the decision loop.

**Eligible work:**
- Any PR that touches **only** files under:
  - `scripts/**` (helper scripts, not runtime)
  - `.claude/**` (agent config, commands, briefs, hooks)
  - `.github/workflows/**` *when* it does not change required status checks on protected branches
  - `docs/06_status/**` (status docs, progress reports, evidence bundles — **after** PM has accepted the underlying work)
  - `docs/05_operations/**` (operational playbooks and policies — **not** the delegation policy itself; self-amendment requires PM)
  - `.ut-issues/**.yaml` (issue metadata)
- Stale Linear reconciliation (moving issues marked Done in main to Done in Linear when commit history confirms the merge)
- Housekeeping cleanup of known-stale files (e.g. expired `.claude/codex-queue/*.md` for Done issues) when the cleanup touches only the stale files
- Bash/SQL **read-only** verification queries against live DB to produce evidence (no mutations, no DDL)
- Opening Linear issues to track newly-discovered debt, follow-ups, or corrective work
- Dispatching Codex CLI lanes for work already classified as Tier A or Tier B by this policy
- Running `pnpm type-check`, `pnpm test`, `pnpm test:db`, `pnpm lint`, `pnpm build` — any verification that does not mutate state

**Merge policy:** Tier A PRs may be merged by the orchestrator on green CI without PM pre-approval. The orchestrator must still open a PR, wait for CI, and only merge on green.

**Required post-merge actions:**
- Report merge SHA to PM in the next message
- Update Linear state via the tooling (or rely on the `linear-auto-close.yml` workflow once the `LINEAR_API_TOKEN` secret is configured)
- Confirm scanner quiescence and any other standing invariants are still in place

### Tier B — Review-before-merge

The orchestrator may plan, dispatch, write code, run verification, and open the PR autonomously. But **merge requires explicit PM approval** in the current chat session. PM reads the PR description and either says "approve PR #NNN for merge" or reshapes the work.

**Eligible work:**
- T2 runtime changes with explicit allowed-file lists and bounded file scope
- New read surfaces (command-center pages) that do not change the write path
- Bounded refactors with test coverage that did not previously exist
- New CI workflows or GitHub Actions that add checks (not lower them)
- Tooling changes that affect how other agents or lanes execute (e.g. new `pnpm codex:*` commands, new script helpers)
- Contract/docs corrections that tighten existing invariants without introducing new runtime behavior
- New `test:db` regression cases added alongside an existing passing runtime implementation
- Any PR that touches files outside Tier A paths but does not cross a Tier C boundary

**Merge policy:** PR is opened with a clear summary, verification results, scope audit, and explicit "awaiting PM merge approval" note in the description. The orchestrator does not merge until PM explicitly approves in the session.

### Tier C — PM-in-the-loop throughout

The orchestrator must get PM approval at **both the plan stage and the merge stage**. Before dispatching any lane or writing any code, the orchestrator presents a bounded implementation plan (scope, allowed files, verification, rollback) and waits for PM go-ahead. After implementation, the orchestrator opens the PR, reports verification results, and waits again for merge approval.

**Eligible work:**
- T1 runtime changes (lifecycle, promotion, audit, distribution, review controller, submission pipeline)
- Any migration: `supabase/migrations/**`
- Any change to `packages/db/src/{lifecycle,repositories,runtime-repositories}.ts`
- Any change to `packages/contracts/src/**` (cross-package contracts)
- Any change to `packages/domain/src/**` (pure business logic)
- Changes to `GOVERNANCE_BRAKE_SOURCES` in `apps/api/src/distribution-service.ts` or any policy set in `@unit-talk/contracts`
- Any change that alters the allowed-transition matrix in the lifecycle FSM
- Any PR that touches Discord channel configuration or introduces new delivery targets
- Any PR that touches authentication (`apps/api/src/auth.ts`) or RBAC route protection
- Any PR that modifies the scoring/promotion policy weights or tier definitions
- Any change to the retention cron or scheduled cleanup jobs
- Any PR that spans more than 2 apps (cross-cutting refactors)
- Any change to the proof-coverage guard's sensitive-path list (prevents the orchestrator from widening its own autonomy)

**Merge policy:** Plan approval first, then implementation, then merge approval. Two explicit PM touchpoints per task.

## Always-escalate (regardless of tier)

These categories **always** require PM presence in the session, independent of tier classification. The orchestrator must stop and ask if any of these apply to the work in progress.

- **Security or privacy posture changes** — authentication, authorization, data exposure, PII handling, audit retention, secret storage. Even a "small" change here is Tier C plus PM presence.
- **Third-party integrations** — any new API key, new webhook, new outbound HTTP destination, new OAuth provider, new dependency on an external service.
- **Data mutations against live DB outside the normal write path** — backfills, cleanups, corrections, migrations of existing rows. The UTV2-519 pre-merge Management-API apply would have been caught by this rule.
- **Discord channel activation or new delivery targets** — explicitly deferred per current PM direction. The following targets are code-merged but **not cleared for live activation**: `discord:exclusive-insights`, `discord:game-threads`, `discord:strategy-room`. Do not enable, do not route traffic, do not create new channels.
- **Member-visible behavior changes** — changes that will be observable to end users on Discord, smart-form, or via bot commands. Even bug fixes that change UX.
- **Financial or compliance-sensitive logic** — settlement, CLV calculations, grading corrections, promotion eligibility thresholds.
- **Dependency bumps** — any package.json change, any lockfile change, any tsconfig or build config change. These can silently shift behavior.
- **Environment variable additions or removals** — new required env vars, deprecations, or default changes. Configuration surface is PM territory.
- **Anything the orchestrator is uncertain about** — when in doubt, escalate. The cost of asking is small. The cost of an unauthorized runtime change is large.

## Sensitive-path matrix

The following paths have fixed handling regardless of how small the diff looks. When a change touches any of these, follow the stated rule exactly.

| Path / domain | Rule |
|---|---|
| `supabase/migrations/**` | Tier C. Author in worktree, PM approves plan, PM approves merge. Phase 2 specific: **never merge `UTV2-459` and `UTV2-460` in the same deploy** — serial merge required due to migration numbering. |
| Live DB row mutations (UPDATE/DELETE against production, backfills, corrections) | Always escalate, Tier C plus PM presence. Read-only verification queries remain Tier A. |
| Row-level security / constraints / DDL outside a migration file | Forbidden. DDL lives only in `supabase/migrations/**`. |
| `packages/contracts/src/**` | Tier C. Canonical cross-package contracts. No autonomous edits. |
| `packages/domain/src/**` | Tier C. Pure business logic. No autonomous edits. |
| `packages/db/src/{lifecycle,repositories,runtime-repositories}.ts` | Tier C. Write authority and state-machine code. |
| `docs/02_architecture/contracts/**` | Tier C. Architecture contracts are ratified. Tightening-only edits are still Tier B minimum. |
| `apps/api/src/distribution-service.ts` (routing + gating) | Tier C. Includes any change to `GOVERNANCE_BRAKE_SOURCES`, target gating, promotion → outbox handoff. |
| `apps/worker/**` delivery adapters / outcome handling | Tier C. Exactly-one-DeliveryOutcome invariant must not drift. |
| `apps/api/src/auth.ts` and RBAC/route protection | Always escalate. Security posture change. |
| Credentials / secrets / `.env*` (any env var addition, removal, or default change) | Always escalate. Configuration surface is PM-only. |
| Third-party integration config (SGO keys, Discord tokens, Supabase keys, webhook URLs, new outbound destinations) | Always escalate. |
| Discord channel wiring — any change that could activate a deferred target (`exclusive-insights`, `game-threads`, `strategy-room`) or create a new target | Forbidden without explicit PM instruction in-session. |
| Promotion policy weights, scoring profiles, tier definitions, approval gates in `@unit-talk/contracts` | Tier C. Includes `pick_promotion_history` schema, `promotion-service.ts` weighting, `MODEL_REGISTRY_CONTRACT` policy edits. |
| Brake sources (`GOVERNANCE_BRAKE_SOURCES` set in `apps/api/src/distribution-service.ts`) | Tier C. The current set is `{system-pick-scanner, alert-agent, model-driven}`. Adding or removing requires PM. |
| `settlement-service.ts` and settlement history rows | Tier C. Settlement history is immutable; corrections use `corrects_id`, never mutate prior rows. |
| `packages/contracts/src/submission.ts` — `pickSources` union | Tier C. Adding a new source is a runtime-surface change. |
| Scheduled jobs / cron / retention (`pg_cron`, cleanup jobs) | Tier C. Affects data lifecycle. |
| `.github/workflows/**` — changes that lower required checks | Forbidden without PM. Additions of new checks are Tier B. |
| `proof-coverage-guard.yml` sensitive-path list | Tier C. Orchestrator cannot widen its own autonomy through the guard. |
| `docs/05_operations/DELEGATION_POLICY.md` (this file) | Tier C — self-amendment requires PM regardless of diff size. |
| `packages/db/src/database.types.ts` | Generated. Only regenerate via `pnpm supabase:types` after a migration merges. Do not hand-edit under any tier. |

**Phase 2 specific boundaries (from `CLAUDE.md`) — always enforce:**
- Do not write to `picks` from the candidate or board-scan layer
- Do not populate `pick_candidates.model_score / model_tier / model_confidence` in Phase 2
- Do not set `pick_candidates.pick_id` in Phase 2
- Do not set `pick_candidates.shadow_mode = false` in Phase 2
- Do not route `system-pick-scanner` through `market_universe` or `pick_candidates`
- Do not start Phase 3 before `UTV2-464` closes

A PR that violates any of the above is auto-Tier-C-block regardless of file count or diff size. Stop, report, escalate.

## Issue reshaping rules

The orchestrator may reshape Linear issues to keep work executable, but only within bounded reshaping authority.

**Allowed without PM (reshaping does not require re-approval):**
- Tightening acceptance criteria to make them more testable or more specific, without narrowing the intent
- Adding an explicit allowed-files list to an issue that was authored without one
- Splitting an oversized issue into sibling issues when the split preserves the architectural intent and each child issue can still be executed in isolation
- Creating follow-on issues for genuine debt or repo-truth gaps discovered during execution
- Moving an issue into "Blocked" with a precise blocker description
- Re-tiering an issue up (e.g. T3 → T2 → T1) when discovered risk increases; never re-tier *down* without PM
- Correcting trivial errors in the issue body (broken links, wrong file paths, typos)

**Not allowed without PM (reshaping requires explicit approval):**
- Widening scope of an existing issue, even by one additional file or one additional behavior
- Changing the architectural intent (the "why") of an issue
- Collapsing multiple Linear issues into a single execution unit
- Skipping a contract that the issue explicitly references, even if the contract looks outdated
- Re-tiering down (T1 → T2, T2 → T3) — risk reductions require PM acknowledgment
- Converting a runtime-code issue into a docs-only issue, or vice versa
- Removing acceptance criteria from an issue
- Renaming or re-IDing an issue

When in doubt, add a comment to the Linear issue describing the proposed reshape and wait for PM confirmation rather than reshaping silently.

## Self-amendment

This policy document is **not** within the orchestrator's Tier A autonomy. Changes to `docs/05_operations/DELEGATION_POLICY.md` require explicit PM approval regardless of diff size, because the orchestrator modifying its own authorization bounds is a conflict of interest. Proposals are welcome; the PM ratifies.

## Stop conditions

The orchestrator must stop and report (not "fix while checking") when any of the following occur, regardless of tier. This list codifies the **Stop Conditions** section of `CLAUDE.md` and supersedes any informal additions.

From `CLAUDE.md` (verbatim intent):
- issue scope is ambiguous
- Linear state conflicts with repo truth
- task requires a missing contract
- task overlaps another active lane
- baseline on main is failing
- issue depends on unresolved upstream work
- migration / runtime-risk work that requires explicit PM approval

Additional conditions for this policy:
- The task requires touching a file outside the allowed list and the excluded file is not clearly Tier A
- Verification reveals a new failure class not covered by the known-debt list in `.claude/agent-brief.md`
- A corrective sub-task would widen the blast radius beyond what the original packet approved
- Two or more interpretations of a requirement are equally defensible and the choice affects user-visible behavior
- The task would require the orchestrator to act outside its current authorization tier
- The task would require self-amendment of this delegation policy
- The task would touch any row in the sensitive-path matrix above that is not pre-authorized at the current tier

Stopping is not a failure mode. Stopping with precise evidence is the correct behavior when bounds are unclear. The orchestrator never "fixes forward" past an uncertainty by guessing — it reports and escalates.

## Delegation to Codex CLI lanes

When the orchestrator dispatches work to a Codex CLI lane (via `pnpm codex:dispatch`), the lane inherits the Tier classification of the task it is executing. A Codex lane cannot autonomously upgrade its own authorization — it reports results back to the orchestrator, which then applies the appropriate merge policy from its own tier.

**Specifically:**
- A Codex lane running a Tier A task may open a PR that the orchestrator merges on green without PM touchpoint
- A Codex lane running a Tier B task reports back with a "ready for review" PR; the orchestrator verifies, then requests PM merge approval
- A Codex lane is never authorized to run Tier C work — Tier C is Claude Code (Opus) only, because the planning + merge touchpoints require direct PM dialogue

**When dispatching:** include the tier classification explicitly in the packet's rules section so the lane knows what to report back.

## Out-of-session standing authorizations

The PM may grant standing authorizations that persist across sessions by documenting them here. Current standing authorizations:

- *(none yet — add as granted)*

Examples of what a standing authorization might look like:
- "Tier A may include updating `docs/06_status/PROGRAM_STATUS.md` with post-merge status entries, up to 200 words, no new sections."
- "Tier A may include running `pnpm codex:receive` and merging any Codex return that passes verification and scope audit for issues tagged `kind:docs` or `kind:hardening`."

Do not invent standing authorizations. They only exist if they are written here.

## Review cadence

This policy should be reviewed when any of the following occur:

- The orchestrator completes 10 or more merges under Tier A (quarterly retro review)
- An incident happens that reveals a gap in the policy (immediate review)
- The backlog shape changes materially (e.g. a new phase opens with novel risk classes)
- The PM explicitly requests a review

## Related documents

- `CLAUDE.md` — execution model, tier/lane rules, merge policy, required skills
- `.claude/agent-brief.md` — repo-specific gotchas and known debt
- `docs/05_operations/docs_authority_map.md` — documentation authority tiers
- `.github/workflows/proof-coverage-guard.yml` — enforces live-DB proof coverage on sensitive runtime paths
- `.github/workflows/linear-auto-close.yml` — auto-closes Linear issues referenced in merge commits

## Acknowledgement

By acting under this policy, the orchestrator is agreeing to:

1. Classify every task into a tier **before** beginning execution
2. Escalate on any uncertainty about the correct tier
3. Report merges promptly (within the same session) so PM has audit visibility
4. Never self-grant additional authority — if the task feels like it needs more autonomy than Tier A gives, escalate to PM and either get a standing authorization or execute under Tier B/C

The PM, by adopting this policy, is agreeing to:

1. Trust the orchestrator to execute Tier A work without per-merge ping-pong
2. Review Tier B PRs promptly so the orchestrator is not blocked
3. Update this document when the orchestrator encounters a class of work that does not fit cleanly into the three tiers
4. Revoke authorization if the orchestrator repeatedly mis-classifies tasks

---

**Adopted:** 2026-04-11 under UTV2-523 follow-up.
**Next review:** when 10 merges have shipped under Tier A, or immediately upon any incident that reveals a gap.
