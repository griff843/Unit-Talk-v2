# Delegation Policy — Claude Code Orchestrator

> Canonical policy for when the Claude Code orchestrator may act autonomously, when it must escalate to PM, and when it must stop regardless of apparent authorization.
>
> Adopted 2026-04-11. Authority: PM. Supersedes any ad-hoc decision-making defaults in `CLAUDE.md` that don't explicitly reference this document.

## Purpose

This document exists because the orchestrator was spending disproportionate time asking the PM for approval on individual merges, packet dispatches, and implementation option selection. That pattern is correct for T1 runtime-risk work but wasteful for bounded T2/T3 slices, documentation, and scaffolding.

The goal is to move from "ask PM every step" to "act within written bounds; escalate only when the task exceeds the bounds." This preserves PM oversight where it matters (runtime correctness, architecture, scope) and eliminates it where it doesn't (mechanical execution of clearly bounded tasks).

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
- New read surfaces (operator-web routes, command-center pages) that do not change the write path
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
- **Discord channel activation or new delivery targets** — explicitly deferred per current PM direction.
- **Member-visible behavior changes** — changes that will be observable to end users on Discord, smart-form, or via bot commands. Even bug fixes that change UX.
- **Financial or compliance-sensitive logic** — settlement, CLV calculations, grading corrections, promotion eligibility thresholds.
- **Dependency bumps** — any package.json change, any lockfile change, any tsconfig or build config change. These can silently shift behavior.
- **Environment variable additions or removals** — new required env vars, deprecations, or default changes. Configuration surface is PM territory.
- **Anything the orchestrator is uncertain about** — when in doubt, escalate. The cost of asking is small. The cost of an unauthorized runtime change is large.

## Self-amendment

This policy document is **not** within the orchestrator's Tier A autonomy. Changes to `docs/05_operations/DELEGATION_POLICY.md` require explicit PM approval regardless of diff size, because the orchestrator modifying its own authorization bounds is a conflict of interest. Proposals are welcome; the PM ratifies.

## Stop conditions

The orchestrator must stop and report (not "fix while checking") when any of the following occur, regardless of tier:

- The task scope is ambiguous and no interpretation is clearly correct
- The task requires touching a file outside the allowed list and the excluded file is not clearly Tier A
- Verification reveals a new failure class not covered by the known-debt list in `.claude/agent-brief.md`
- A corrective sub-task would widen the blast radius beyond what the original packet approved
- Two or more interpretations of a requirement are equally defensible and the choice affects user-visible behavior
- Baseline on main is failing and the failure is not in the documented pre-existing-debt list
- The task would require the orchestrator to act outside its current authorization tier

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
