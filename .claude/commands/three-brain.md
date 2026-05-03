---
name: three-brain
description: |
  Executor-selection layer for Unit Talk V2. Returns which executor
  handles a given task: Claude, Codex, Gemini, QA Agent, or Griff.
  Called by /dispatch during Phase 1. QA Agent invokes it to request
  Codex review or Gemini scans. Claude invokes it directly for failure
  rescue and codebase scans.

  This skill does NOT create lanes, open PRs, or update Linear.
  /dispatch owns lane lifecycle. This skill owns the routing decision.
---

# Three-Brain: Executor Selection Layer

## Executors

| Executor | Role |
|---|---|
| **Claude** | Orchestrator and driver. T1, T3, Tier C paths, fallback when Codex unavailable |
| **Codex** | T2 clear-scope implementation lanes, failure rescue |
| **Gemini** | Large-context codebase scans, cross-package architecture analysis |
| **QA Agent** | Playwright surface verification and regression (`pnpm qa:experience`) |
| **Griff** | Scope authority, source-of-truth conflicts, product decisions, merge gates |

---

## Routing Rules (apply in order — first match wins)

### Rule 1 — T1: always Claude

Issue has label `tier:T1` → executor = **Claude**, escalate_to_griff = **true** (plan + merge).

T1 is Tier C under the Delegation Policy. Codex never runs T1 work.

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

### Rule 7 — Gemini: codebase scans

Route to Gemini (via `cc-gemini-plugin:gemini` agent — not the raw `gemini` CLI) when:

- "Find every place X / scan the whole repo / map all callers of Y / architecture impact"
- Cross-package impact analysis before a T1 refactor (Claude calls Gemini as recon first)
- QA Agent requests coverage gap analysis before adding surface tests
- Answering a question requires correlating more than 3 files Claude can't hold at once

Invoke silently. Synthesize before presenting. Always demand `file:line` citations — reject flat summaries.

```bash
# Standard codebase scan pattern
/cc-gemini-plugin:gemini --dirs <comma-separated-paths> "Find every place X. Return file:line list."
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
- T2 merge — explicit PM approval required in current session (Tier B)

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

Never route Griff escalations to Codex or Gemini. Never continue implementation while waiting.

---

## Output Format (when called by /dispatch Phase 1)

Return a one-line routing decision:

```
executor: claude | codex | gemini | qa-agent
announce: true | false
escalate_to_griff: true | false
reason: <one line>
```

Examples:

```
executor: codex    announce: false  escalate: false  reason: T2 clear-scope, health OK
executor: claude   announce: false  escalate: true   reason: T1 — Tier C, PM plan required
executor: claude   announce: false  escalate: false  reason: Codex unavailable, fallback
executor: codex    announce: true   escalate: false  reason: failure rescue — 2× same test
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
- Gemini codebase scan — Claude recon, synthesize before presenting
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
| Broad codebase coverage map | Rule 7 (Gemini silent scan) |
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

Gemini is available via `cc-gemini-plugin` — no separate CLI check needed.

---

## Stay-Asleep Rules

Do NOT invoke executor routing for:

- Conversational questions, greetings, status checks
- File reads, git commands, grep, bash verification (read-only)
- Planning, brainstorming, or explaining on non-live surfaces
- Recall / memory / session state → `/system-state-loader`
- Any task another skill already owns

When uncertain: stay asleep. Under-firing is fine. Over-firing creates noise and erodes trust.
