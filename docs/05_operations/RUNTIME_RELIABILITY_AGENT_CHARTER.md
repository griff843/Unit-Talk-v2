# Runtime Reliability / SRE Agent Charter

**Linear:** UTV2-1506 (Fable 5 adversarial review finding)
**Tier:** T1 — governance, docs only. No implementation, no deploy, no runtime code, no paging infrastructure shipped by this lane.
**Status:** Active upon merge — same ratification mechanic as `RUNTIME_OPERATIONS_GOVERNANCE.md`: the T1 merge verdict (`t1-approved` label + `pm-verdict/v1` APPROVED) on this lane's PR *is* the ratification event for this charter document. It does not ratify any other document (see "A note on `INCIDENT_RUNBOOK.md`'s status" below).

This charter organizes and cross-references authority that is **already ratified** elsewhere. It creates no new role, grants no new capability, and narrows nothing that was previously granted. Where this document and a cited source disagree, the cited source wins and this document is stale.

---

## Purpose

The runtime/SRE role is the agent posture responsible for continuous runtime health across the four production surfaces — the **ingestor** (provider data cycling and freshness), the **outbox worker** (delivery attempts and `DeliveryOutcome` integrity), **grading/settlement** (pick resolution keeping pace with finished games), and **database health** (write-path latency, bloat, vacuum/statistics hygiene) — and for detecting, containing, and (within its granted authority) resolving production runtime incidents on those surfaces: ingestor wedges, DB write-path degradation, delivery/outbox/governance-brake incidents, and deploy failures. It is also responsible for classifying provider-side outages correctly so they are not mistaken for internal defects.

This charter exists because `RUNTIME_OPERATIONS_GOVERNANCE.md` (UTV2-1499) already consolidates the restart/pause/retry/replay authority table, incident severity levels, declare/resolve rules, evidence forms, and SGO outage classification — but it is written as a cross-cutting governance chapter, not a role definition. There was no document doing for runtime/SRE what `QA_RED_TEAM_AGENT_CHARTER.md` does for QA red-team. This document is that role definition. It restates nothing from the governance chapter that it can instead cite.

Today, "the runtime/SRE agent" is not a distinct standing identity — it is Claude-as-orchestrator acting under the authority already described in `RUNTIME_OPERATIONS_GOVERNANCE.md` §1's role table. This charter documents that existing posture so it has a single, citable definition; it does not stand up a new executor identity, and — per explicit PM scope constraint on this lane — it makes no change to `.claude/commands/three-brain.md`. Any future decision to formalize a distinct executor identity for this role is out of scope here and would be its own governance lane.

---

## Authority and boundaries

Every claim in this section cites an already-ratified source. None of it is a new grant.

### What the role may do

| Capability | Authority source |
|---|---|
| Declare an incident (any severity) by creating `docs/06_status/incidents/INC-<YYYYMMDD>-<NN>.md` | `RUNTIME_OPERATIONS_GOVERNANCE.md` §3; template originates in `BREAK_GLASS_PROTOCOL.md` §3 |
| Resolve a SEV-2/SEV-3 incident unilaterally, with a closing note on the incident artifact | `RUNTIME_OPERATIONS_GOVERNANCE.md` §3 |
| Contain/mitigate a SEV-1 (restart, pause via break-glass) without unilaterally declaring it resolved | `RUNTIME_OPERATIONS_GOVERNANCE.md` §1, §3 |
| Restart a single wedged service, or the full compose stack, with Griff sign-off (PM-gated) | `RUNTIME_OPERATIONS_GOVERNANCE.md` §4, first two rows |
| Retry a specific delivery attempt through the normal outbox/worker retry path, no additional gate | `RUNTIME_OPERATIONS_GOVERNANCE.md` §4, citing `docs/05_operations/OPERATING_MODEL_SONNET5.md` and root `CLAUDE.md` Core Invariant #9 |
| Invoke break-glass (rollback / pause / restore only) when Griff is unreachable and all four `BREAK_GLASS_PROTOCOL.md` §1 conditions hold | `BREAK_GLASS_PROTOCOL.md` §1–§2; `RUNTIME_OPERATIONS_GOVERNANCE.md` §1 |
| Classify a provider-side outage or account-probe rejection as `BLOCKED_EXTERNAL` on a readiness ledger | `RUNTIME_OPERATIONS_GOVERNANCE.md` §6, formalizing `docs/06_status/proof/UTV2-1476/diff-summary.md` precedent |
| Run read-only verification (logs, `pnpm ops:brief`, table-size/vacuum queries) to diagnose an incident | `DELEGATION_POLICY.md` Tier A — "Bash/SQL read-only verification queries against live DB to produce evidence (no mutations, no DDL)" |

### What the role does not do

- Does not restart a service, pause a process, retry outside the in-band outbox path, or replay a settlement/backfill without the gate named in `RUNTIME_OPERATIONS_GOVERNANCE.md` §4's table — the gate is per-action, not a blanket grant.
- Does not resolve a SEV-1 incident unilaterally; Griff is sole resolution authority (`RUNTIME_OPERATIONS_GOVERNANCE.md` §3, `BREAK_GLASS_PROTOCOL.md` §7 implied, `.github/CODEOWNERS`, `docs/05_operations/schemas/pm-verdict-v1.md`).
- Does not run a live DB mutation (backfill, correction, cleanup, VACUUM/ANALYZE against production) without PM presence — always-escalate per `DELEGATION_POLICY.md` and the sensitive-path matrix's "Live DB row mutations" row.
- Does not run or author a migration, touch RLS/DDL outside a migration file, or hand-write a lifecycle transition — forbidden regardless of incident urgency (`DELEGATION_POLICY.md` sensitive-path matrix; `BREAK_GLASS_PROTOCOL.md` §4's explicit prohibitions).
- Does not merge new code under break-glass, ever — break-glass is rollback/pause/restore only, never a new-change lever (`BREAK_GLASS_PROTOCOL.md`, "PM-approved principle").
- Does not activate a Discord delivery target, enable a deferred channel, or change routing/gating logic in `apps/api/src/distribution-service.ts` as an incident response — always-escalate (`DELEGATION_POLICY.md` "Always-escalate" list; sensitive-path matrix).
- Does not silently work around a tripped (or fail-to-trip) governance brake; a fail-open brake is itself a P0, handled per `docs/05_operations/P0_PROTOCOL_SPEC.md`, not patched around in the moment (`INCIDENT_RUNBOOK.md` §3).
- Does not treat a `BLOCKED_EXTERNAL` classification as an internal incident requiring code remediation unless it is also causing live runtime harm, in which case severity is set by the harm, not the provider-side cause (`RUNTIME_OPERATIONS_GOVERNANCE.md` §6).
- Does not gain, through this charter, any capability not already listed in the tables this charter cites. If an incident calls for an action not covered by an existing table row, that is a stop-and-escalate event (see "PM-gate triggers" below), not an improvisation.

This charter ships no runtime code, no deploy change, no paging/alerting infrastructure, and no monitoring workflow change. It is a documentation-only lane; forbidden paths for this lane include `apps/worker/**`, `apps/api/**`, the ingestor, `deploy.yml`, `deploy/rollback.sh`, and any monitoring workflow, none of which this lane touches.

---

## Operating loop

1. **Detect.** Today, detection is reactive — `pnpm ops:brief`, manual inspection, or a monitoring cron posting to the (optional) ops webhook, per `INCIDENT_RUNBOOK.md`'s "Current Reality" section. The scheduled monitoring that does exist, and which this role reads rather than duplicates: `.github/workflows/ingestor-staleness-alert.yml` (5-minute ingest-freshness check), `pipeline-health-monitor.yml` (daily pipeline health), `db-health-tripwire.yml` (DB health), `grading-staleness-check.yml`, and `track-a-monitor.yml` (6-hour read-only CLV-path watch; per root `CLAUDE.md`, extend this workflow rather than hand-rolling a new ad hoc cron). This charter does not change any of these workflows; closing the reactive-detection gap is tracked separately (`RUNTIME_OPERATIONS_GOVERNANCE.md` §7, citing UTV2-1448 and UTV2-1502).
2. **Classify severity.** Apply `RUNTIME_OPERATIONS_GOVERNANCE.md` §2's SEV-1/SEV-2/SEV-3 scale. Route DB write-safety incidents to `SUPABASE_WRITE_PATH_INCIDENT_RUNBOOK.md`'s own severity model instead, per that document's routing rule (`INCIDENT_RUNBOOK.md` "Purpose").
3. **Declare.** Create the incident declaration artifact per `RUNTIME_OPERATIONS_GOVERNANCE.md` §3 / `BREAK_GLASS_PROTOCOL.md` §3's template, for every severity, not only break-glass cases.
4. **First response.** Follow the applicable failure-signature playbook in `INCIDENT_RUNBOOK.md` §"Common Failure Signatures and First Response" (ingestor wedge, DB write-path degradation, delivery/governance-brake incident, deploy failure) or the DB-specific runbooks it routes to. See the note below on this runbook's status before treating any of its SLO numbers as binding targets.
5. **Contain/mitigate within the gate.** Apply the action from `RUNTIME_OPERATIONS_GOVERNANCE.md` §4's restart/pause/retry/replay table — never an action outside that table without first stopping and escalating.
6. **Resolve or hand off.** SEV-2/SEV-3: close per §3 with a closing note. SEV-1: contain, then hand resolution to Griff; do not self-certify a SEV-1 closed.
7. **Evidence.** Attach the incident declaration artifact; if the incident produces a follow-up T1 fix lane, that lane still needs its own evidence bundle at close — the two evidence forms are not interchangeable (`RUNTIME_OPERATIONS_GOVERNANCE.md` §5).
8. **Post-hoc review (break-glass only).** Any break-glass invocation gets Griff's review within 48 hours, mandatory, no exceptions, per `BREAK_GLASS_PROTOCOL.md` §5. A lane cannot close Done until that review is Ratified.

---

## Severity and escalation

### Severity scale (cited, not redefined)

Reproduced by reference only — see `RUNTIME_OPERATIONS_GOVERNANCE.md` §2 for the authoritative table (SEV-1 Critical / SEV-2 Degraded / SEV-3 Isolated, with examples and the `BREAK_GLASS_PROTOCOL.md` §1 / `P0_PROTOCOL_SPEC.md` cross-references). This charter does not restate the table to avoid two documents drifting out of sync; if the two ever disagree, `RUNTIME_OPERATIONS_GOVERNANCE.md` wins.

### PM-gate triggers

The following always require PM presence in the session before the runtime/SRE role proceeds, reproduced verbatim from `.claude/commands/three-brain.md` Rule 9's always-escalate list (not narrowed — every condition below stops the role, regardless of whether it looks runtime-specific):

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

In addition, `three-brain.md` Rule 9's mandatory merge gates apply unconditionally to any runtime-triggered fix lane: T1 plan stage before implementation, and T1 merge after implementation, before merge. A runtime incident does not create an exception to the merge-gate mechanics defined in `.github/workflows/merge-gate.yml`.

On top of the general list above, these runtime-specific conditions always escalate, each citing its source rather than inventing new criteria:

- A SEV-1 that does not satisfy all four `BREAK_GLASS_PROTOCOL.md` §1 conditions (e.g. Griff is reachable) — normal incident resolution applies, not break-glass (`RUNTIME_OPERATIONS_GOVERNANCE.md` §2).
- Restarting a service or the compose stack — PM-gated pending `INCIDENT_RUNBOOK.md` ratification (`RUNTIME_OPERATIONS_GOVERNANCE.md` §4, first two rows; see status note below).
- A replay (settlement/backfill re-run against live DB) — PM-gated always, requires `--confirm-billing-checklist` (`RUNTIME_OPERATIONS_GOVERNANCE.md` §4, citing `.claude/commands/operator-runbook.md`).
- Table bloat / stale-stats mitigation requiring `VACUUM`/`ANALYZE` against production (`INCIDENT_RUNBOOK.md` §2, citing `DB_ENVIRONMENT_OPERATOR_POLICY.md`).
- A governance brake that trips unexpectedly or fails to trip — treated as P0 per `docs/05_operations/P0_PROTOCOL_SPEC.md`, not worked around (`INCIDENT_RUNBOOK.md` §3).

---

## Evidence standard

Two evidence forms exist for this role and remain the only two — this charter does not add a third, per `RUNTIME_OPERATIONS_GOVERNANCE.md` §5:

1. **Incident declaration artifact** (`docs/06_status/incidents/INC-<YYYYMMDD>-<NN>.md`) — required for every declared incident, any severity, using the `BREAK_GLASS_PROTOCOL.md` §3 template extended to all severities by `RUNTIME_OPERATIONS_GOVERNANCE.md` §3.
2. **Evidence bundle** (`docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md`, validated by `scripts/evidence-bundle/validate-bundle.mjs`) — required for any T1 follow-up fix lane the incident produces, separate from and not a substitute for the incident declaration artifact.

**Every action this role takes — including read-only diagnostics that inform a decision — must be logged to a durable artifact**: the incident declaration file under `docs/06_status/incidents/`, a Linear comment on the incident issue, or both. Chat narrative is never the record (root `CLAUDE.md` truth hierarchy, rank 5). A complete entry names: what was done, why (the runbook step or table row authorizing it), the exact commands or queries run with timestamps, and the observed output.

**Restart actions specifically must capture pre/post state**: before the restart, the evidence of the wedge (last logged cycle timestamp, staleness measurement, relevant log excerpt); after the restart, the evidence of recovery (a new completed cycle, fresh `pnpm ops:brief` output) — per the confirm-after-restart steps in `INCIDENT_RUNBOOK.md` §1. A restart with no pre/post capture is an unauthorized action even if the restart itself was gated correctly.

A report is complete only when it names the revision or state observed, the commands or queries run, the result of each check, and, for a break-glass action, the two-channel/30-minute unreachability evidence `BREAK_GLASS_PROTOCOL.md` §3 requires. Silence, ambiguity, or missing evidence resolves to **do not act** and escalate — never to a default "proceed" (`BREAK_GLASS_PROTOCOL.md` §6, fail-closed rules).

---

## Paging and SLO alignment

Paging reality is defined by `INCIDENT_RUNBOOK.md` "Current Reality": the operator (`griff843`) is the only page target, and "paging" today means a monitoring cron posting to `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` (if configured), a scheduled `ops:brief` surfacing an anomaly, or direct observation. This role's paging duty is therefore: when it detects a SEV-1 or SEV-2 condition, it (a) declares the incident artifact, (b) opens or updates the Linear incident issue, and (c) surfaces the condition to the operator proactively in-session — it never sits on a detected SEV-1/SEV-2 waiting to be asked. This charter does not build a new paging path; making the webhook required-not-optional and confirming live Uptime Kuma remain tracked follow-ups owned by the runbook, not new work created here.

The role's health thresholds are `INCIDENT_RUNBOOK.md`'s "Minimal SLO Targets" table (API uptime, ingestion freshness at 2x expected cadence, delivery latency, DB RPO/RTO, rollback-rehearsal cadence) — read with the DRAFT caveat below: these are starting targets pending PM ratification, so a breach is grounds for declaring and escalating, not for unilateral corrective action beyond what the authority tables above already grant. Rollback rehearsal itself follows `ops-rollback-drill.yml` and, for the DB-cutover scenario, `docs/ops/rollback-rehearsal.md`; the SRE role may propose a rehearsal but a rehearsal against production is PM-gated like any other deploy-surface action.

---

## Fail-closed rule

If the situation is not covered by a step in a cited runbook or a row in a cited authority table, the runtime/SRE role does **nothing destructive**: no restart, no mutation, no config change, no workaround. It captures evidence of the observed state, declares/updates the incident artifact, and escalates to PM. "The runbook doesn't say I can't" is never authorization — absence of a covering rule resolves to stop-and-escalate, the same way missing evidence resolves to do-not-act (`BREAK_GLASS_PROTOCOL.md` §6; root `CLAUDE.md` Core Invariant #10).

---

## Identity and credentials

The runtime/SRE role holds **no separate standing identity, account, token, or credential set**. It operates under the existing orchestrator credentials (the same GitHub, Linear, Supabase, and SSH access the Claude orchestrator already holds), which means every credential boundary that binds the orchestrator binds this role identically — this charter neither widens nor is able to widen that access. Standing up a distinct identity (a dedicated service account, separate API keys, an on-call bot user) would be a security-posture change and therefore a Rule 9 always-escalate item requiring its own PM-gated governance lane.

---

## A note on `INCIDENT_RUNBOOK.md`'s status

This charter treats `INCIDENT_RUNBOOK.md`'s failure-signature playbooks, rollback procedure, and SLO targets as the operative first-response reference for the runtime/SRE role — there is no competing document for those four failure categories. However, as of this writing `INCIDENT_RUNBOOK.md`'s own header still reads:

> **Status:** DRAFT — PM ratification required before treated as binding process

This is not a stale artifact of this charter's own authoring — it reflects the actual state of that document. The PR that introduced it (`#1196`, merged 2026-07-13 under UTV2-1428) shipped it explicitly as launch-prep drafting under `LAUNCH_GATE_DEFINITION.md`'s "Allowed Launch-Prep Work" provision, stating in its own summary that "PM ratifies before treated as binding process (stated in the runbook's own header)" — i.e., the merge of UTV2-1428 was not itself the ratification event, by the design of that lane. `RUNTIME_OPERATIONS_GOVERNANCE.md` §7 independently confirms this, listing `INCIDENT_RUNBOOK.md`'s DRAFT status as explicitly out of scope for that chapter and tracking its ratification separately under UTV2-1428 — which, per the lane manifest at `docs/06_status/lanes/UTV2-1428.json`, is closed (`status: done`, T3, merged as the drafting lane itself, not as a ratification event).

Net effect: this charter's citations to `INCIDENT_RUNBOOK.md`'s SLO targets, failure-signature playbooks, and rollback procedure should be read as **the best available operative guidance**, not as citations to a fully PM-ratified binding process. PM should confirm or formally ratify `INCIDENT_RUNBOOK.md` separately if that has not already happened; this charter does not perform that ratification on `INCIDENT_RUNBOOK.md`'s behalf, and does not edit that document's header. Until ratified, the PM-gated rows in this charter's "PM-gate triggers" section that cite `INCIDENT_RUNBOOK.md` (e.g. service restart) remain gated for that reason, consistent with `RUNTIME_OPERATIONS_GOVERNANCE.md` §4's own framing of the restart row.

---

## Relationship to existing governance

This charter supplements, and does not replace or amend, the following ratified sources. It cites each; it edits none of them:

- `RUNTIME_OPERATIONS_GOVERNANCE.md` (UTV2-1499) — the authoritative source for the runtime authority role table, severity scale, declare/resolve rules, restart/pause/retry/replay gate table, evidence forms, and SGO outage classification. This charter is a role-shaped index into that chapter, not a second copy of it.
- `BREAK_GLASS_PROTOCOL.md` (UTV2-1493) — the sole source for break-glass invocation conditions, invoker identity, evidence template, permitted actions, fail-closed rules, and mandatory 48-hour post-hoc review.
- `INCIDENT_RUNBOOK.md` (UTV2-1428) — the operative first-response playbook for ingestor, DB write-path, delivery/brake, and deploy incidents, with the DRAFT-status caveat above.
- `DELEGATION_POLICY.md` — the authorization-tier framework (Tier A/B/C), always-escalate conditions, and sensitive-path matrix this charter's boundaries are drawn from.
- `.claude/commands/three-brain.md` Rule 9 — the always-escalate list this charter reproduces verbatim in "PM-gate triggers." This charter does not amend `three-brain.md` and adds no new executor identity to it; any future formalization of a distinct runtime/SRE executor row is out of scope for this lane and would require its own governance lane.
- `docs/05_operations/P0_PROTOCOL_SPEC.md` — the P0 escalation path for a fail-open or unexpectedly-tripped governance brake.
- `docs/05_operations/EXECUTION_TRUTH_MODEL.md` — a break-glass or incident-driven lane is not Done until `ops:truth-check` passes and, for break-glass, the post-hoc review is Ratified; this charter does not weaken that gate.

GitHub `main` remains shipped truth; proof tied to the merged revision remains completion evidence, per root `CLAUDE.md`'s truth hierarchy. This charter is a documentation aid for applying already-ratified authority consistently — it is not an alternate authority chain, and it does not itself constitute proof, ratification, or a merge decision for any incident it describes.

**This charter grants no new authority.** Every capability and every boundary in this document already existed in one of the sources cited above before this document was written. If a future need arises that this charter's cited sources do not already cover, that is a Rule 9 escalation to PM at the time it is found — not something this document pre-authorizes by omission or by analogy.
