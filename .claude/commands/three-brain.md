---
name: three-brain
description: |
  Executor-selection layer for Unit Talk V2. Returns which executor
  handles a given task: Claude, Codex CLI, Codex Cloud, or Griff.
  Called by /dispatch during Phase 1. QA Agent invokes it to request
  Codex review or Explore scans. Claude invokes it directly for failure
  rescue and codebase scans.

  This skill does NOT create lanes, open PRs, or update Linear.
  /dispatch owns lane lifecycle. This skill owns the routing decision.
---

# Three-Brain: Executor Selection Layer

## Executors

| Executor | Role |
|---|---|
| **Claude** | Orchestrator and driver. T1, T3, Tier C paths, fallback when Codex unavailable |
| **Codex CLI** | T2 clear-scope implementation lanes, failure rescue |
| **Codex Cloud** | Reserved autonomous Codex executor when explicitly selected by the orchestrator |
| **Explore** | Claude action for large-context scans; not a lane-start executor |
| **QA Agent** | Claude action for Playwright surface verification; not a lane-start executor |
| **Griff** | Scope authority, source-of-truth conflicts, product decisions, merge gates |

## Model selection for Claude lanes

Three-brain returns both an executor and a **planning model** for T1 Claude lanes. The orchestrator session stays on its current model; the planning subagent spawned in Phase 4 of `/dispatch` uses the model below.

### T1 planning subagents

| Condition | Planning model | Rationale |
|---|---|---|
| T1, standard scope (no ratified Fable trigger class fires) | `sonnet` (Sonnet 5) | Adaptive thinking + improved agentic bench make Sonnet 5 sufficient for ordinary T1 planning |
| T1, one of the four ratified Fable pilot trigger classes fires (see below), AND the pilot is currently eligible | `fable` (Fable 5) — **advisory-only, bounded pilot (UTV2-1569)** | See "Fable 5 pilot routing" below |
| T2 / T3 Claude | *(none — no planning subagent)* | Bounded work; orchestrator session handles directly |

**Default:** `sonnet`. There is no escalation tier above Sonnet 5 for planning outside the narrow, bounded Fable pilot below — genuinely novel-architecture, constitutional-scope, or ambiguous-boundary T1 work that does NOT match one of the four ratified trigger classes is still a Rule 9 Griff-escalation trigger (scope ambiguity / Tier C), not a model-routing decision. Full model policy: `docs/05_operations/OPERATING_MODEL_SONNET5.md`.

**Executable routing (UTV2-1569):** this table's decision is not self-executing prose — `/dispatch`'s Phase 4 planning subagent and Phase 5 critique subagent both call `scripts/ops/planning-model-routing.ts#resolvePlanningModel()` and pass its returned `.routing.model` (mapped via `toAgentModelOverride()` to the Agent tool's `model` param) instead of a hardcoded `"sonnet"` literal. This closes the exact gap the earlier pilot attempt (PR #1287, unmerged) left open: a Fable row in this table with nothing downstream that actually consumed it.

### Fable 5 pilot routing (bounded, UTV2-1569)

Following the pilot-evaluation issue's **PILOT LONGER — lean YES, narrow scope** conclusion, Fable 5 is reinstated for exactly four ratified trigger classes, and only for the duration of a mechanically-bounded pilot:

| Trigger class | When it fires |
|---|---|
| `repeated_architecture_bounce` | A lane has bounced `CHANGES_REQUIRED` more than once on the same architectural question. |
| `live_state_root_cause` | A hard root-cause/mechanistic-verification task where live-state evidence (runtime, DB, CI) must be checked, not just reasoned about. |
| `product_synthesis_no_precedent` | A product-synthesis decision with no existing precedent to follow. |
| `build_mode_certification_review` | Advisory review of a Build Mode planning/certification packet before it reaches Griff. |

**Explicit skip list — Fable is never eligible for these, even if a caller supplies one of these strings as a trigger class:** routine coding, manifest bookkeeping, proof rebinding, CI cleanup, mechanical reconciliation. `resolvePlanningModel()` treats any of these as an automatic Sonnet result, not a fallback worth ceremony.

**Advisory only, always:** a Fable pilot decision is never a merge authority, never a `pm-verdict/v1` substitute, and never counts as a vote in any T1-M quorum, machine or otherwise — this holds for every one of the four trigger classes above, including `build_mode_certification_review`. Nothing Fable produces during the pilot authorizes a merge by itself, and it never touches Rule 9 or Griff's T1-H authority.

**Mechanical eligibility gate (fail-closed):** Fable is selectable only when ALL of the following hold, checked by `resolvePlanningModel()` itself, not left to operator judgment:
1. `docs/05_operations/policies/fable-pilot-policy.json`'s `pilot_enabled` is `true`.
2. The requested trigger class is one of the four above and individually enabled in that policy.
3. `docs/05_operations/FABLE_PILOT_STATE.json` reads back `PILOT_ACTIVE_WITHIN_CAPS` (activated, not suspended/expired/rolled-back, and under all three of the 8-task/30-day/usage-ceiling caps) via `scripts/ops/fable-pilot-state.ts#readFablePilotState()`.

Any one of these failing falls back to Sonnet with `fallback_used: true` recorded in the manifest's `planning_model_routing` block — never a thrown error, never a silent continue past a cap. **As of this pilot's mechanism landing, the pilot has NOT been activated** — `FABLE_PILOT_STATE.json`'s `status` is `"pending"`, so every resolution currently falls back to Sonnet regardless of trigger class. Starting the pilot's clock is a real operational decision reserved for Griff, not something any dispatch cycle does automatically.

**Suspension/kill path, independent of the model being evaluated:** an operator can set `FABLE_PILOT_STATE.json`'s `status` to `"suspended"` (via `scripts/ops/fable-pilot-state.ts suspend`) at any time, for any reason (cost, behavior, policy concern) — this is a pure operational brake, not a verdict on Fable's quality, and is independent of `fable-pilot-policy.json`'s separate `pilot_enabled` kill switch. Either one being off blocks all Fable routing.

**Evidence and reviewer independence:** every Fable-routed lane's manifest carries a `planning_model_routing` block (model, profile, selected_by, rationale, policy_version, fallback_used, fallback_model — see `docs/05_operations/LANE_MANIFEST_SPEC.md` §17), and any Fable review claim must assert `reviewer_independent_of_author: true` (`docs/05_operations/schemas/fable-review-v1.md`) — there is no override. `ops:truth-check` validates this for every Fable-routed lane via `evaluateFableRoutingEvidence()`.

**Rollback:** `docs/05_operations/FABLE_PILOT_ROLLBACK.md`. The mechanical half (`scripts/ops/fable-pilot-rollback.ts`) is a single function call that makes Fable permanently unselectable regardless of doc/allowlist state.

**Closeout:** at 8 qualifying tasks, 30 calendar days, or the usage ceiling — whichever comes first — the pilot state mechanically flips to `expired` (never silently continues), and `docs/05_operations/FABLE_PILOT_CLOSEOUT_TEMPLATE.md` is filled in for a fresh `FABLE 5 PERMANENT INTEGRATION: YES / NO / EXTEND` decision packet. No permanent routing or authority change happens without a later, exact-head Griff decision.

### Codex lane critique model

When reviewing a Codex-returned diff (Phase 5 of `/dispatch`), the critique step must use the correct model tier — Sonnet misses subtle invariant violations on Tier C paths.

| Codex diff touches | Critique model | Rationale |
|---|---|---|
| Any Tier C path (see Rule 2) | `opus` — spawn a dedicated critique subagent | Invariant violations in domain/contracts/migrations are not always syntactically visible |
| Standard T2 path, no Tier C | Sonnet (orchestrator session) | Sonnet is sufficient for bounded scope review |

Spawn the Opus critique subagent the same way as the planning subagent — block on result before applying tier label or requesting merge.

### Haiku subagents — cheap reads and summaries

Spawn `haiku` subagents for work that is purely informational, deterministic, and produces no code or artifacts. These never open PRs, never touch files, and never route to a lane executor.

| Use case | When to spawn | Example |
|---|---|---|
| Board snapshots | `ops:brief`, `ops:digest`, pre-dispatch state reads | "Summarize active lanes and Linear queue" |
| Log summarization | CI log triage, test output parsing, error extraction | "Extract failing tests from this pnpm test output" |
| Bulk doc/status reads | Scanning many status files, changelog aggregation | "Read all lane manifests and list which are stale" |
| Verification output parsing | Reading `pnpm verify` or `ops:truth-check` output | "Parse this verify output and list failures only" |

```typescript
Agent({
  model: "haiku",
  description: "Board snapshot / log summary",
  prompt: "... (read-only, summarize only, no edits) ..."
})
```

**Haiku constraints:** read-only tasks only. Never use Haiku for: routing decisions, code generation, proof review, or anything where a wrong answer has downstream consequences. If the task requires judgment, use Sonnet minimum.

---

## Routing Rules (apply in order — first match wins)

### Rule 1 — T1: Claude by default; Codex permitted under guardrails

Issue has label `tier:T1` → executor = **Claude** by default, escalate_to_griff = **true** (plan + merge).

**Codex is permitted for T1** when ALL of the following apply (per executor routing memory + P0 merge policy):
- Human review required before merge (no auto-merge — ever)
- Claude critique pass on the returned diff
- Domain invariant check passes (`/betting-domain`, `/pick-lifecycle`, or `/outbox-worker` as scope dictates)
- Runtime verification (`pnpm test:db` + evidence bundle, SHA-tied)
- Routed through `/dispatch` lane system (never raw `codex exec`)

P0 Runtime Hardening work follows this same Codex-with-guardrails path by default.

When choosing Claude vs Codex for a T1: prefer Claude for ambiguous scope, novel architecture, or work that requires synthesizing multiple files. Prefer Codex for bounded, mechanically-verifiable changes inside a single package even when tier is T1.

**When T1/T2 classification is ambiguous** (two interpretations are equally defensible and the choice affects behavior): pause and use extended deliberation before routing. The tier decision gates the entire lane lifecycle — under-gating (T2 when it's T1) bypasses the PM merge gate; over-gating (T1 when T2 suffices) adds unnecessary ceremony. If still ambiguous after deliberation, apply Rule 9 (Griff escalation).

### Rule 2 — Sensitive path: Claude + mandatory Griff gate

Issue touches any of these paths:

```
supabase/migrations/**
packages/contracts/src/**
packages/domain/src/**
packages/db/src/lifecycle.ts
packages/db/src/repositories.ts
packages/db/src/runtime-repositories.ts
apps/api/src/distribution-service.ts
apps/worker/**
apps/api/src/auth.ts
```

→ executor = **Claude**, escalate_to_griff = **true** (Delegation Policy Tier C).

Do not announce as a routing decision. Announce as "awaiting PM plan approval."

### Rule 3 — Codex health gate (required before any T2 Codex routing)

Before routing a T2 issue to Codex, run:

```bash
npx tsx scripts/ops/codex-health-check.ts --json
```

If `healthy: false` → executor = **Claude**, announce = **false**, log reason in dispatch report:
`Codex unavailable ({error}) — routing UTV2-### to Claude.`

If `healthy: true` → proceed to Rule 4.

### Rule 4 — T2 clear-scope: Codex via Dispatch

Issue has label `tier:T2` AND all of the following:

- Does not match any path in Rule 2
- Does not require a migration (`supabase/migrations/**`)
- Does not touch shared contracts (`packages/contracts/src/**`)
- Codex health check passed (Rule 3)

→ executor = **Codex**, announce = **false** (routing shown in dispatch Phase 6 report).

Route via `/dispatch` lane system. Do not call `codex exec` directly — that bypasses the lane manifest and file-scope lock.

### Rule 5 — T3: Claude

Issue has label `tier:T3` → executor = **Claude**, announce = **false**.

Codex is not dispatched for T3. Overhead exceeds value for bounded pure-computation work.

### Rule 6 — Failure rescue (deterministic counter, not vibes)

Track failures per `(test path | shell command)` within the current lane:

- 2× same test failure on the same code path → **Codex rescue**
- 2× same shell command error → **Codex rescue**
- 2× same edit with no forward progress → **Codex rescue**

**Announce before dispatching (mandatory):**

```
[three-brain] routing to Codex rescue — Claude failed same test 2× on {path}.
Dispatching rescue lane via /dispatch. Say "keep trying" to cancel.
```

Send to rescue lane: full failing output, what was tried, relevant file paths.
Create the rescue lane via `/dispatch`, not via raw `codex exec` — the rescue must have a manifest.

Reset the counter when: test/build passes, user changes the goal, or user says "keep trying."

### Rule 7 — Explore: codebase scans

Route to the Explore subagent when:

- "Find every place X / scan the whole repo / map all callers of Y / architecture impact"
- Cross-package impact analysis before a T1 refactor (run recon first, synthesize before presenting)
- QA Agent requests coverage gap analysis before adding surface tests
- Answering a question requires correlating more than 3 files

Invoke silently via the Agent tool with `subagent_type: "Explore"`. Synthesize before presenting. Always demand `file:line` citations — reject flat summaries.

```typescript
// Standard codebase scan pattern — set breadth based on scope
Agent({
  subagent_type: "Explore",
  description: "Codebase scan: <what you're looking for>",
  prompt: "Find every place X is called/imported. Return file:line list. Be thorough — check all apps/ and packages/."
})
// breadth hint in prompt: "quick" | "medium" | "very thorough"
```

### Rule 8 — QA Agent: post-merge surface verification

After a T2 or T3 PR merges that touches any of:

```
apps/command-center/**
apps/worker/**       (UI-visible output path)
```

**Announce before running:**

```
[three-brain] triggering QA Agent — surface change in {path}. Running pnpm qa:experience.
```

Then run:

```bash
pnpm qa:experience
```

If QA Agent returns FAIL: Claude investigates. If the same surface fails 2× → apply Rule 6 (Codex rescue on the regression).

### Rule 9 — Griff escalation (always visible, always stop)

Stop and request PM presence when any of the following apply:

**Mandatory merge gates (Delegation Policy):**
- T1 plan stage — before any implementation (Tier C)
- T1 merge — after implementation, before merge (Tier C)

T2 merge is **not** a Rule 9 stop condition: per `merge-gate.yml` (ratified 2026-05-18, UTV2-979) and Delegation Policy's Tier B model, the orchestrator diff-reviews and self-approves via `gh pr review --approve` — no PM presence or PM_VERDICT required, for any executor. Escalate a T2 merge only if one of the always-escalate conditions below also applies.

**Always-escalate conditions (Delegation Policy — any one triggers):**
- Security or privacy posture change (auth, RBAC, PII, audit retention, secrets)
- Third-party integration (new API key, webhook, outbound destination, OAuth provider)
- Live DB row mutation outside the normal write path (backfill, correction, cleanup)
- Discord channel activation or new delivery target
- Member-visible behavior change (Discord, smart-form, bot commands)
- Financial or compliance logic (settlement, CLV, grading corrections, promotion thresholds)
- Dependency bump (package.json, lockfile, tsconfig, build config)
- Environment variable addition, removal, or default change
- Source-of-truth conflict (Linear state vs repo truth vs lane manifest)
- Scope ambiguity: two interpretations equally defensible and the choice affects behavior

**Announce and stop:**

```
[three-brain] escalating to Griff — {reason}. Stopping until PM responds.
```

Never route Griff escalations to Codex or the Explore subagent. Never continue implementation while waiting.

---

## Codex model-profile routing (Codex lanes only, UTV2-1526)

Once a Codex lane decision resolves (Rule 1 T1-with-guardrails, Rule 4 T2 clear-scope, or
Rule 6 failure rescue), three-brain also selects a deterministic **model profile** —
never leave this to the Codex CLI's own default. Model profiles are logical names defined
in the canonical policy `docs/05_operations/policies/codex-model-routing.json`; that file
is the sole source of truth for which concrete Codex model ID and reasoning effort a
profile means. This section documents the *rules*; the mapping lives only in the policy
file — do not duplicate concrete model IDs here or anywhere else.

Selection happens strictly after executor routing, using first-match rules over objective
inputs (lane tier, package/file count touched, rescue status, verification strength):

| Condition (first match wins) | Profile |
|---|---|
| Rescue threshold exceeded after `codex-sol-high` already failed on this lane, or explicit Griff authorization | `codex-sol-max` — **mechanically unavailable**, see below |
| Complex T2 spanning several files/packages, failure-rescue lane (Rule 6), root-cause investigation, bounded T1 already permitted under Rule 1's guardrails, or governance-tool implementation after Claude has approved the architecture | `codex-sol-high` |
| Normal clear-scope T2 with deterministic acceptance criteria, no Tier C path, no scope ambiguity, no repeated failure | `codex-terra-medium` |
| — | `codex-luna-low` is defined but disabled; do not select it to manufacture work for it |

**`codex-sol-max` is mechanically unavailable** (`enabled: false` in policy, and
`scripts/ops/model-routing.ts#resolveModelProfile` unconditionally rejects any
`requires_pm_authorization: true` profile regardless of any caller-supplied override). A
caller-supplied `authorized_by`/`reason` string is self-asserted, not proof of PM
authorization — the same self-certification loophole UTV2-1521 already closed for
file-scope overrides. There is currently no way to route to `codex-sol-max`; re-enabling
it requires a trusted external authorization mechanism (e.g. an authenticated PR-comment
scheme mirroring `docs/05_operations/schemas/scope-override-v1.md`, verified against
CODEOWNERS) landing in a follow-up governance lane. Do not route to it, and do not add an
override-based unlock without that mechanism shipping first. A model-profile selection
never grants merge, scope, or tier authority by itself; it only determines which Codex
model/effort executes a lane whose executor and tier gates have already been satisfied
through the rules above.

Pass the resolved profile to lane-start explicitly (Codex lanes only):

```bash
pnpm ops:lane-start UTV2-{number} --tier T2 --branch codex/utv2-{number}-slug \
  --lane-type <type> --executor codex-cli --model-profile codex-terra-medium \
  --files <path1> [--files <path2> ...]
```

`ops:lane-start` validates the profile against policy (enabled, permitted for this tier)
and persists the resolved decision — concrete model, reasoning effort, and policy
version — into the lane manifest's `model_routing` block. It rejects the lane if the
profile is missing, unknown, disabled, not permitted for the tier, or requires PM
authorization (no override flag exists to bypass this). **Claude lanes must never
receive `--model-profile`** —
`ops:lane-start` rejects it if supplied for a non-Codex executor.

`scripts/ops/codex-exec.ts` re-validates the manifest's `model_routing` against current
policy immediately before invoking `codex exec`, and passes the model and reasoning effort
explicitly (`--model`, `-c model_reasoning_effort=...`) — it never relies on the Codex
CLI's own default and never falls back silently. Lane manifests created before this policy
shipped simply have no `model_routing` block; `codex-exec.ts` resolves the documented
legacy default (`codex-terra-medium`) for those, with a visible warning, and records that
resolution only in that run's evidence — it never rewrites the historical manifest. Full
compatibility behavior: `docs/05_operations/LANE_MANIFEST_SPEC.md` §15.

---

## Output Format (when called by /dispatch Phase 1)

Return a one-line routing decision. For dispatchable implementation lanes, `executor`
must be one of the lane-start executor values:

```
executor: claude | codex-cli | codex-cloud
model_profile: <profile-name> | null
announce: true | false
escalate_to_griff: true | false
reason: <one line>
```

`model_profile` is required (non-null) whenever `executor` is `codex-cli` or
`codex-cloud`, chosen per the routing table above. It must be `null` (or omitted) for
`executor: claude` — Claude lanes carry no Codex model configuration.

Explore and QA Agent are not lane-start executors. If a candidate needs Explore
or QA Agent work, return `executor: claude` and include `action: explore-scan`
or `action: qa-agent` in the reason so `/dispatch` runs that branch without
creating a malformed lane manifest.

Examples:

```
executor: codex-cli model_profile: codex-terra-medium announce: false  escalate: false  reason: T2 clear-scope, health OK
executor: claude   model_profile: null              announce: false  escalate: true   reason: T1 — Tier C, PM plan required
executor: claude   model_profile: null              announce: false  escalate: false  reason: Codex unavailable, fallback
executor: codex-cli model_profile: codex-sol-high     announce: true   escalate: false  reason: failure rescue — 2× same test
executor: claude   model_profile: null              announce: false  escalate: false  reason: action: explore-scan — broad codebase scan before routing
executor: claude   model_profile: null              announce: true   escalate: false  reason: action: qa-agent — surface regression verification required
```

---

## Announcement Protocol

**Announce (one visible line before executing) for:**
- Codex rescue (Rule 6)
- QA Agent post-merge trigger (Rule 8)
- Griff escalation (Rule 9)
- Forced review on a UTV2 sensitive path where the user may not have noticed

**Silent (no announcement) for:**
- Normal T2 Codex routing — already surfaced in `/dispatch` Phase 6 report
- Explore subagent codebase scan — Claude recon, synthesize before presenting
- T3 Claude routing — default, no announcement needed

---

## Integration with /dispatch

`/dispatch` calls this skill during **Phase 1** to determine executor per issue. Dispatch owns: lane manifest creation, Linear state update, file-scope lock, PR opening. This skill owns: choosing the executor, surfacing Griff escalations, triggering rescue.

Dispatch Phase 2.5 (Codex health check) is replaced by Rule 3 of this skill. The health check runs inside the routing decision, not as a separate phase.

---

## Integration with QA Agent

QA Agent (`apps/qa-agent/`) may invoke this skill to request:

| QA Agent need | Route |
|---|---|
| Implementation review of a surface diff | Rule 4 (Codex lane via /dispatch) |
| Broad codebase coverage map | Rule 7 (Explore silent scan) |
| Product decision on a failed assertion | Rule 9 (Griff escalation) |
| Rescue for 2× same surface failure | Rule 6 (Codex rescue via /dispatch) |

QA Agent provides: surface name, failing test or question, relevant file paths.
QA Agent does not create Codex lanes directly — it requests routing; Dispatch/Claude creates the lane.

---

## Startup Check (once per session, before first route)

```bash
npx tsx scripts/ops/codex-health-check.ts --json
```

If Codex unavailable, note once: `"Codex unavailable — T2 lanes will route to Claude until resolved."`
Do not retry every turn.

Explore subagent is native to Claude Code — no health check needed.

---

## Stay-Asleep Rules

Do NOT invoke executor routing for:

- Conversational questions, greetings, status checks
- File reads, git commands, grep, bash verification (read-only)
- Planning, brainstorming, or explaining on non-live surfaces
- Recall / memory / session state → `/system-state-loader`
- Any task another skill already owns

When uncertain: stay asleep. Under-firing is fine. Over-firing creates noise and erodes trust.
