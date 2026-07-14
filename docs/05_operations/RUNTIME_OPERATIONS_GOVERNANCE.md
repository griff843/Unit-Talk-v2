# Runtime Operations Governance Chapter

**Status:** Active upon merge — the T1 merge verdict (`t1-approved` label + `pm-verdict/v1` APPROVED) on this lane's PR *is* the ratification event. No separate signature step.
**Linear:** UTV2-1499 (Fable 5 adversarial review finding)
**Tier:** T1 — governance, docs only. No implementation, no deploy, no runtime code touched by this lane.
**Scope:** the minimum enforceable standard for who may restart/pause/retry/replay production runtime, who declares and resolves incidents, and how SGO/provider outages are classified. This chapter **consolidates existing authority already ratified elsewhere** — it does not create a new governance program, a new standing role, or a new escalation body. Where a decision already has an answer in another ratified doc, this chapter cites it rather than restating or re-deciding it.

---

## 1. Runtime authority roles

| Role | Holder today | Scope | Source (already ratified) |
|---|---|---|---|
| Orchestrator / break-glass invoker | Claude, current session | Restart a single wedged service; declare incidents; invoke break-glass (rollback/pause/restore only) when Griff is unreachable and all four break-glass conditions hold | `BREAK_GLASS_PROTOCOL.md` §1–2 |
| Sole PM / resolution authority | Griff | Resolve SEV-1 incidents; approve any retry/replay touching live DB writes; approve emergency action beyond restart; 48h post-hoc review of every break-glass invocation | `BREAK_GLASS_PROTOCOL.md` §7 (implied), `.github/CODEOWNERS`, `pm-verdict-v1` schema |
| Implementer (no standing runtime authority) | Codex | Executes lanes Claude has planned and Griff has plan-gated; never restarts, pauses, or declares/resolves incidents unilaterally | `DELEGATION_POLICY.md` Tier C, three-brain.md Rule 2 |
| On-call rotation | **None exists** | N/A | Confirmed gap — `INCIDENT_RUNBOOK.md` "Current Reality"; not closed by this chapter (see §8) |

This is a description of standing authority that already exists across `DELEGATION_POLICY.md`, `BREAK_GLASS_PROTOCOL.md`, and `INCIDENT_RUNBOOK.md` — not a grant of new authority. No role in this table gains any capability it did not already have in the cited source.

---

## 2. Incident severity levels

No numbered severity scale existed before this chapter; two partial, non-aligned concepts did (`SUPABASE_WRITE_PATH_INCIDENT_RUNBOOK.md`'s binary "active until proven false," and `P0_PROTOCOL_SPEC.md`'s Linear-project-based P0 tag). This chapter defines the minimum scale and reconciles both into it — it does not replace either source doc's own internal mechanics.

| Severity | Definition | Examples | Maps to |
|---|---|---|---|
| **SEV-1 — Critical** | Live harm to customers, data integrity, security, or the ability to operate safely | Incorrect picks/settlements reaching members; a bad deploy corrupting data; a security exposure; a runaway process degrading shared Supabase for all users | Break-glass condition 1 (`BREAK_GLASS_PROTOCOL.md` §1); `P0_PROTOCOL_SPEC.md` P0 project when the finding is runtime-facing |
| **SEV-2 — Degraded** | A process is wedged, stale, or delayed beyond its expected cadence, with no confirmed member-facing harm yet but real risk of one | Ingestor not cycling; delivery latency beyond the runbook's minimal SLO target; outbox backlog growing unbounded | `INCIDENT_RUNBOOK.md` "Common Failure Signatures" §1–4 |
| **SEV-3 — Isolated** | A non-critical service or check is degraded with no runtime impact on picks, delivery, or settlement | A monitoring cron itself failing; a stale status dashboard; a non-blocking CI check red | N/A — logged, not escalated |

A SEV-1 that also satisfies all four `BREAK_GLASS_PROTOCOL.md` §1 conditions may use break-glass. A SEV-1 that does not (e.g. Griff is reachable) follows normal incident resolution — break-glass is not the default SEV-1 path, it is the fallback when the PM is unreachable.

---

## 3. Declare / resolve authority

**Declare:** any agent (Claude, Codex) or the operator may declare an incident. Declaring means creating an incident artifact at `docs/06_status/incidents/INC-<YYYYMMDD>-<NN>.md`, reusing the exact template `BREAK_GLASS_PROTOCOL.md` §3 already defines (what's happening / why it qualifies / evidence / proposed action / rollback-of-rollback plan) for every severity, not just break-glass cases. For SEV-2/SEV-3, the "proposed action" and "rollback-of-rollback" sections may be marked N/A — the template is reused for consistency, not narrowed to break-glass only.

**Resolve:**
- **SEV-1:** Griff is the sole resolution authority. Claude may contain/mitigate (restart, pause via break-glass) but does not declare a SEV-1 resolved without Griff sign-off, mirroring break-glass's existing 48h mandatory review.
- **SEV-2 / SEV-3:** Claude-orchestrator may resolve unilaterally, with a closing note appended to the incident artifact stating what fixed it and how it was confirmed. Griff retains standing override to reopen any closed incident.

---

## 4. Restart / pause / retry / replay authority

| Action | Who | Gate | Source |
|---|---|---|---|
| **Restart** a single wedged service (e.g. ingestor container) | Claude, directly | No PM gate — this is normal first response, not an emergency action | `INCIDENT_RUNBOOK.md` §"Ingestor wedged" first-response steps 1–4; `INGESTOR_RUNTIME_SUPERVISION.md` auto-restart precedent |
| **Restart** the full compose stack / multiple services | Claude, directly, but only if multiple services are confirmed affected | No PM gate, but do not restart the whole stack for a single-service symptom | `INCIDENT_RUNBOOK.md` §"Ingestor wedged" step 3 |
| **Pause** a running process or delivery target outside normal PR flow | Break-glass only (Claude-invoked, all §1 conditions met), or an operational kill-switch once one is deployed and ratified | PM gate: break-glass requires the 4 §1 conditions + 48h review; a deployed delivery kill-switch (UTV2-1427) is scoped as staff-authorized/auditable and does not require break-glass once shipped — cross-reference that lane's ratified design once merged, do not duplicate its spec here | `BREAK_GLASS_PROTOCOL.md` §1, §4 |
| **Retry** a specific delivery attempt | Claude may retry through the normal outbox/worker retry path (existing exactly-once semantics, Core Invariant #9) with no additional gate | No PM gate for in-band retry; PM gate applies only if retry requires a manual DB write outside that path | `docs/05_operations/OPERATING_MODEL_SONNET5.md`, Core Invariant #9 |
| **Replay** (re-running a settlement/backfill against live DB) | PM-gated always | Requires `--confirm-billing-checklist` and defaults to in-memory persistence unless explicitly overridden | `.claude/commands/operator-runbook.md` replay section |

No action in this table grants a capability beyond what its cited source already permits — this table is a lookup index across three documents, not a new grant.

---

## 5. Evidence requirements

Two evidence forms already exist and remain the only two forms:

1. **Incident declaration artifact** (`docs/06_status/incidents/INC-<YYYYMMDD>-<NN>.md`) — required for every declared incident, any severity (§3 above extends break-glass's existing template to all severities).
2. **Evidence bundle** (`docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md`, validated by `scripts/evidence-bundle/validate-bundle.mjs`) — required for T1 lane proof, unrelated to incident declaration; do not conflate the two. An incident that results in a follow-up T1 fix lane still needs its own evidence bundle at close, in addition to the incident artifact.

This chapter does not add a third evidence form.

---

## 6. SGO / provider outage classification

Formalizing existing precedent (`docs/06_status/proof/UTV2-1476/diff-summary.md`): a provider-side outage or account-probe rejection that is **not** a code defect or invalid credential on our side is classified `BLOCKED_EXTERNAL`. This is a **classification tag on a readiness ledger entry**, not an incident severity — a `BLOCKED_EXTERNAL` finding does not itself trigger SEV-1/2/3 declaration unless it is also causing live runtime harm (in which case it is declared per §2–3 using the harm, not the provider-side cause, to set severity). `BLOCKED_EXTERNAL` findings are tracked as resilience follow-ups (e.g. UTV2-1478), not treated as internal incidents requiring code remediation on our side.

---

## 7. Explicitly out of scope (not decided here)

- **`INCIDENT_RUNBOOK.md`'s own DRAFT status** — this chapter cites and builds on that runbook but does not itself ratify it; that document's PM ratification is tracked separately (UTV2-1428).
- **`BREAK_GLASS_PROTOCOL.md` §8's open human-backup decision** (who invokes break-glass if both Griff and Claude-orchestrator are unavailable) — unresolved, not pre-empted by this chapter.
- **New alerting/paging infrastructure** (on-call rotation, mandatory webhook, Uptime Kuma live-deploy confirmation) — tracked under UTV2-1448 and UTV2-1502; this chapter names the gap (§1 table) but does not close it.
- **The delivery kill-switch mechanism itself** — tracked under UTV2-1427; this chapter's §4 pause-authority row will cross-reference its ratified design once that lane merges, not duplicate it in advance.

No PM decision packet is produced alongside this chapter: research against `DELEGATION_POLICY.md`, `BREAK_GLASS_PROTOCOL.md`, and `INCIDENT_RUNBOOK.md` found no case where two ratified sources define runtime authority differently for the same action — every table above cites exactly one source per row. If a future review finds a genuine authority conflict, that is a Rule 9 escalation at the time it's found, not something to speculate about here.
