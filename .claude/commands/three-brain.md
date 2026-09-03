---
name: three-brain
description: |
  Executor-selection layer for Unit Talk V2. Returns which executor
  handles a given task: Claude, Codex CLI, Codex Cloud, or Griff.
  Invoked when deciding who should do a piece of mission work. QA Agent
  invokes it to request Codex review or Explore scans. Claude invokes it
  directly for failure rescue and codebase scans.

  This skill does NOT open PRs, create branches, or update any tracker.
  It owns the routing decision and nothing else. Tier language below is
  legacy shorthand for how much verification work warrants — merge
  authority is risk-scoped (docs/05_operations/RESERVED_RISK_SURFACES.json).
---

# Three-Brain: Executor Selection Layer

## Executors

| Executor | Role |
|---|---|
| **Claude** | Orchestrator and driver. Mission planning, high-consequence and reserved-surface work, integration, repair, fallback when Codex unavailable |
| **Codex CLI** | Bounded clear-scope implementation from a work packet, failure rescue |
| **Codex Cloud** | Reserved autonomous Codex executor when explicitly selected by the orchestrator |
| **Explore** | Claude action for large-context scans; not an independent executor |
| **QA Agent** | Claude action for Playwright surface verification; not an independent executor |
| **Griff** | Product intent, exit criteria, and the reserved decisions in docs/mission/intent.md |

## Model selection for Claude work

Three-brain returns both an executor and a **planning model**. The orchestrator session stays
on its current model; a planning subagent, when one is spawned, uses the model below.

### Planning subagents

| Condition | Planning model | Rationale |
|---|---|---|
| Reserved-surface or novel/constitutional work | `sonnet` (Sonnet 5) | Adaptive thinking + improved agentic bench make Sonnet 5 sufficient for planning across scope types |
| Bounded work | *(none — no planning subagent)* | The orchestrator session handles it directly |

**Default:** `sonnet`. There is no escalation tier above Sonnet 5 for planning — genuinely
novel-architecture, constitutional-scope, or ambiguous-boundary work is a Rule 9
Griff-escalation trigger (scope ambiguity / reserved surface), not a model-routing decision.
Full model policy: `docs/05_operations/OPERATING_MODEL_SONNET5.md`.

### Codex lane critique model

When reviewing a Codex-returned diff, the critique step must match the diff's risk — Sonnet
misses subtle invariant violations on the paths that carry them.

| Codex diff | Critique model | Rationale |
|---|---|---|
| Classifies `human` (see Rule 2), or touches domain/contracts/migrations | `opus` — spawn a dedicated critique subagent | Invariant violations are not always syntactically visible |
| Classifies `auto` | Sonnet (orchestrator session) | Sufficient for bounded scope review |

Spawn the Opus critique subagent the same way as the planning subagent — block on its result
before opening or approving the PR.

### Haiku subagents — cheap reads and summaries

Spawn `haiku` subagents for work that is purely informational, deterministic, and produces no code or artifacts. These never open PRs, never touch files, and never route to an executor.

| Use case | When to spawn | Example |
|---|---|---|
| Plan/PR snapshots | Reading `docs/mission/plan.md`, open-PR and check state | "Summarize the open PRs and which are blocked" |
| Log summarization | CI log triage, test output parsing, error extraction | "Extract failing tests from this pnpm test output" |
| Bulk doc/status reads | Scanning many status files, changelog aggregation | "Read every open PR body and list which name a reserved surface" |
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

### Rule 1 — High-consequence work: Claude by default; Codex permitted under guardrails

Work that is novel, cross-cutting, or whose diff will classify `human` → executor = **Claude**
by default, escalate_to_griff = **true**.

**Codex is permitted here** when ALL of the following apply:
- Human approval before merge (no auto-merge — ever)
- Claude critique pass on the returned diff
- Domain invariant check passes (`/betting-domain` or `/outbox-worker` as scope dictates)
- Runtime verification where the change has runtime behavior (`pnpm test:db`, evidence bound to the commit)
- Delegated through a **work packet** (`pnpm ops:codex-packet --packet <path>`), never a raw
  ad-hoc `codex exec` — the packet is the scope contract, and without one there is nothing to
  check the returned diff against

P0 Runtime Hardening work follows this same Codex-with-guardrails path by default.

When choosing Claude vs Codex: prefer Claude for ambiguous scope, novel architecture, or work
requiring synthesis across many files. Prefer Codex for bounded, mechanically-verifiable
changes inside a single package, even high-consequence ones.

**When the risk read is ambiguous** (two interpretations are equally defensible and the choice
affects behavior): run `pnpm ops:classify-diff` if a diff exists, and read
`docs/05_operations/RESERVED_RISK_SURFACES.json` if one does not. If still ambiguous, apply
Rule 9 (Griff escalation). Do not resolve it by guessing — the classifier is cheap and the
gate will disagree with a guess at the worst possible moment.

### Rule 2 — Reserved surface: Claude + mandatory Griff gate

The path list that used to live here is gone on purpose. It drifted from the gate, and a
routing rule that disagrees with the merge gate sends work down a path that cannot merge.
The authority is the classifier:

```bash
pnpm ops:classify-diff              # on an existing diff
# no diff yet? read docs/05_operations/RESERVED_RISK_SURFACES.json
```

If the work will touch a reserved surface — production DDL/data, member-delivery activation,
the worker delivery implementation, auth/authz authority, secrets, pricing/tier/provider spend,
production containment, or merge authority itself —

→ executor = **Claude**, escalate_to_griff = **true**.

Do not announce as a routing decision. Announce as "awaiting Griff approval."

### Rule 3 — Codex health gate (required before any Codex routing)

Before routing anything to Codex, run:

```bash
npx tsx scripts/ops/codex-health-check.ts --json
```

If `healthy: false` → executor = **Claude**, announce = **false**, and say so once:
`Codex unavailable ({error}) — routing to Claude.`

If `healthy: true` → proceed to Rule 4.

### Rule 4 — Bounded clear-scope work: Codex via a work packet

Work with a stated goal and checkable acceptance criteria, AND all of the following:

- Does not touch a reserved surface (Rule 2)
- Does not require a migration (`supabase/migrations/**`)
- Does not change shared contracts (`packages/contracts/src/**`)
- Codex health check passed (Rule 3)

→ executor = **Codex**, announce = **false**.

Write a packet from `docs/mission/packets/TEMPLATE.md` and run it:

```bash
pnpm ops:codex-packet --packet docs/mission/packets/<name>.md --cwd <isolated worktree>
```

The packet is the whole contract — Goal, Scope, Acceptance, Do not touch. Codex reads no
tracker and receives no ambient state, so anything absent from the packet is absent from the
work. Do not call `codex exec` by hand: the runner resolves the model profile from canonical
policy, refuses an incomplete packet, and refuses to run in the control checkout.

### Rule 5 — Trivial bounded work: Claude

Pure-computation changes with no ambiguity → executor = **Claude**, announce = **false**.

Codex is not dispatched for these. Packet-writing overhead exceeds the value.

### Rule 6 — Failure rescue (deterministic counter, not vibes)

Track failures per `(test path | shell command)` within the current work unit:

- 2× same test failure on the same code path → **Codex rescue**
- 2× same shell command error → **Codex rescue**
- 2× same edit with no forward progress → **Codex rescue**

**Announce before dispatching (mandatory):**

```
[three-brain] routing to Codex rescue — Claude failed same test 2× on {path}.
Sending a rescue packet. Say "keep trying" to cancel.
```

Put in the rescue packet: the full failing output, what was already tried, and the relevant
file paths — under `Goal`, with the failing command as the `Acceptance` criterion. A rescue
without what-was-already-tried reliably produces the same failed attempt a second time.

Reset the counter when: test/build passes, user changes the goal, or user says "keep trying."

### Rule 7 — Explore: codebase scans

Route to the Explore subagent when:

- "Find every place X / scan the whole repo / map all callers of Y / architecture impact"
- Cross-package impact analysis before a wide-blast-radius refactor (run recon first, synthesize before presenting)
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

After ANY PR merges that touches a user-visible surface:

```
apps/command-center/**
apps/worker/**       (UI-visible output path)
```

The trigger is the changed path, not a tier. A mission-native PR carries no tier label, so a
predicate of "after a T2 or T3 PR" is unsatisfiable — the router would find no value to test
and skip the QA it advertises, silently. Reserved surfaces do not exempt a PR from this
either: `apps/worker/**` is reserved AND user-visible, so it merges through human approval and
then still gets QA'd.

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

**Mandatory gates:**
- Before merging any `human`-classified diff

Reserved work is **implemented and opened as a PR like any other**. Griff's approval gates
the MERGE, not the keyboard. Stopping a declared-reserved packet before implementation
restores the plan-approval gate RMA/v1 removed, and strands every reserved packet before
either executor can prepare the change. Escalate before implementation only when an
always-escalate condition below applies, or when the packet does NOT declare the reserved
surface it turns out to need — an undeclared reserved touch is a packet defect, and the
packet is what needs fixing.

An `auto`-classified merge is **not** a Rule 9 stop condition: per `merge-gate.yml` (RMA/v1)
a diff touching no reserved surface is authorized on green CI. Escalate one only if an
always-escalate condition below also applies.

**Always-escalate conditions (any one triggers):**
- Security or privacy posture change (auth, RBAC, PII, audit retention, secrets)
- Third-party integration (new API key, webhook, outbound destination, OAuth provider)
- Live DB row mutation outside the normal write path (backfill, correction, cleanup)
- Discord channel activation or new delivery target
- Member-visible behavior change (Discord, smart-form, bot commands)
- Financial or compliance logic (settlement, CLV, grading corrections, promotion thresholds)
- Dependency bump (package.json, lockfile, tsconfig, build config)
- Environment variable addition, removal, or default change
- Source-of-truth conflict (the plan vs `main` vs live runtime)
- Scope ambiguity: two interpretations equally defensible and the choice affects behavior

**Announce and stop:**

```
[three-brain] escalating to Griff — {reason}. Stopping until PM responds.
```

Never route Griff escalations to Codex or the Explore subagent. Never continue implementation while waiting.

---

## Codex model-profile routing (Codex work only, UTV2-1526)

Once a Codex routing decision resolves (Rule 1 with-guardrails, Rule 4 clear-scope, or
Rule 6 failure rescue), three-brain also selects a deterministic **model profile** —
never leave this to the Codex CLI's own default. Model profiles are logical names defined
in the canonical policy `docs/05_operations/policies/codex-model-routing.json`; that file
is the sole source of truth for which concrete Codex model ID and reasoning effort a
profile means. This section documents the *rules*; the mapping lives only in the policy
file — do not duplicate concrete model IDs here or anywhere else.

Selection happens strictly after executor routing, using first-match rules over objective
inputs (risk classification, package/file count touched, rescue status, verification strength):

| Condition (first match wins) | Profile |
|---|---|
| Rescue threshold exceeded after `codex-sol-high` already failed on this work, or explicit Griff authorization | `codex-sol-max` — **mechanically unavailable**, see below |
| Complex work spanning several files/packages, failure rescue (Rule 6), root-cause investigation, bounded high-consequence work already permitted under Rule 1's guardrails, or governance-tool implementation after Claude has approved the architecture | `codex-sol-high` |
| Normal clear-scope work with deterministic acceptance criteria, no reserved surface, no scope ambiguity, no repeated failure | `codex-terra-medium` |
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
never grants merge or scope authority by itself; it only determines which Codex model and
effort executes work whose routing gates have already been satisfied through the rules above.

Pass the resolved profile to the packet runner:

```bash
pnpm ops:codex-packet --packet docs/mission/packets/<name>.md \
  --profile codex-terra-medium --cwd <isolated worktree>
```

`ops:codex-packet` resolves the profile through the canonical fail-closed resolver in
`scripts/ops/model-routing.ts` — the same one every other entry point uses. It rejects a
profile that is missing, unknown, disabled, or requires PM authorization, and there is no
override flag. It then passes the concrete model and reasoning effort explicitly
(`--model`, `-c model_reasoning_effort=...`), never relying on the Codex CLI's own default
and never falling back silently.

---

## Output Format

Return a one-line routing decision:

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

Explore and QA Agent are not executors. If a candidate needs Explore or QA Agent work,
return `executor: claude` and include `action: explore-scan` or `action: qa-agent` in the
reason.

Examples:

```
executor: codex-cli model_profile: codex-terra-medium announce: false  escalate: false  reason: clear-scope packet, health OK
executor: claude   model_profile: null              announce: false  escalate: true   reason: reserved surface — Griff approval required
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
- A reserved surface the user may not have noticed the work touches

**Silent (no announcement) for:**
- Normal Codex packet routing
- Explore subagent codebase scan — Claude recon, synthesize before presenting
- Bounded Claude work — default, no announcement needed

---

## Integration with /mission

`/mission` calls this skill to decide who does a piece of work. `/mission` owns picking the
work off `docs/mission/plan.md`, creating the worktree and branch, opening the PR, and
updating the plan. This skill owns: choosing the executor, selecting the model profile,
surfacing Griff escalations, and triggering rescue.

The Codex health check (Rule 3) runs inside the routing decision, not as a separate phase.

---

## Integration with QA Agent

QA Agent (`apps/qa-agent/`) may invoke this skill to request:

| QA Agent need | Route |
|---|---|
| Implementation review of a surface diff | Rule 4 (Codex via a work packet) |
| Broad codebase coverage map | Rule 7 (Explore silent scan) |
| Product decision on a failed assertion | Rule 9 (Griff escalation) |
| Rescue for 2× same surface failure | Rule 6 (Codex rescue packet) |

QA Agent provides: surface name, failing test or question, relevant file paths.
QA Agent does not delegate to Codex directly — it requests routing; Claude writes the packet.

---

## Startup Check (once per session, before first route)

```bash
npx tsx scripts/ops/codex-health-check.ts --json
```

If Codex unavailable, note once: `"Codex unavailable — bounded work will route to Claude until resolved."`
Do not retry every turn.

Explore subagent is native to Claude Code — no health check needed.

---

## Stay-Asleep Rules

Do NOT invoke executor routing for:

- Conversational questions, greetings, status checks
- File reads, git commands, grep, bash verification (read-only)
- Planning, brainstorming, or explaining on non-live surfaces
- Recall / memory / session state → the session-start hook already injects it
- Any task another skill already owns

When uncertain: stay asleep. Under-firing is fine. Over-firing creates noise and erodes trust.
