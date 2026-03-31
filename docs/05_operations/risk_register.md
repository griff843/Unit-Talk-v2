# Risk Register

**Status:** CURRENT as of 2026-03-31
**Issue:** UTV2-26
**Authority:** Live risk tracking for Unit Talk V2. Cross-references: `migration_cutover_plan.md`, `PROGRAM_STATUS.md`.

Update this file when risks are opened, escalated, mitigated, or closed. Do not leave stale rows.

---

## Open Risks

| ID | Risk | Severity | Owner | Status | Mitigation |
|----|------|----------|-------|--------|------------|
| R-01 | Historical pre-fix `distribution_outbox` rows create noise in operator incident triage | Low | Platform ops | Open | Filter by `created_at > 2026-03-20` in operator queries; these rows are inert but visible |
| R-02 | API process requires manual restart for new code in dev | Low | Platform ops | Open | Acceptable in dev. Not a production blocker — production restarts are handled by process supervisor |
| R-03 | `system_snapshot.md` stale | Low | Governance | Open | Use `PROGRAM_STATUS.md` for current-state truth; snapshot retained as historical artifact only |
| R-04 | `production_readiness_checklist.md` partially stale | Low | Governance | Open | Use `ISSUE_QUEUE.md` for active lane state |
| R-05 | Board caps (`perSlate=5`) may re-saturate if pick volume spikes | Low | Platform ops | Partially mitigated | Lifecycle filter fix (UTV2-38) counts only queued/posted picks; monitor after high-volume sessions |
| R-06 | In-memory recap idempotency lost on process restart | Low | Platform ops | **CLOSED** | DB-backed idempotency via `system_runs` shipped (UTV2-170). Process restart no longer causes duplicate recap posts. |
| R-09 | `discord:game-threads` delivery blocked | Low | Architecture | Open | Thread routing requires architectural work (worker posts to channel IDs only). No contract yet. Not a cutover blocker. |
| R-10 | `discord:strategy-room` delivery blocked | Low | Architecture | Open | DM routing not implemented. No contract yet. Not a cutover blocker. |

---

## Closed Risks

| ID | Risk | Closed | Resolution |
|----|------|--------|------------|
| R-C01 | Discord `CLIENT_ID` mismatch — `deploy-commands` may fail | 2026-03-27 | UTV2-65 confirmed 5 commands registered; guild deploy current |
| R-C02 | Smart Form `confidence` field missing | 2026-03-20 | UTV2-49 merged; `confidence = capperConviction / 10` wired |
| R-C03 | Legacy gravity — V2 inheriting old assumptions without re-ratification | 2026-03-28 | Contract cadence enforced; all reused logic has a V2 artifact or runtime proof |
| R-C04 | Schema ambiguity — canonical table design not finalized | 2026-03-20 | Schema ratified; `database.types.ts` generated from live Supabase project |
| R-C05 | MCP drift — Linear MCP registration inconsistent | 2026-03-28 | Linear MCP verified working across multiple sessions |
| R-C06 | CLV not wired at settlement | 2026-03-21 | UTV2-46 CLOSED; `computeAndAttachCLV()` called at graded settlement |
| R-C07 | Dead-letter picks not surfaced to operator | 2026-03-21 | UTV2-63 DONE; `counts.deadLetterOutbox` in operator snapshot; distribution health degrades when > 0 |
| R-C08 | `discord:recaps` not yet live | 2026-03-31 | UTV2-90 DONE (PR #53); recap scheduler live; channel `1300411261854547968` mapped and posting |
| R-C09 | AlertAgent notification layer not live | 2026-03-31 | UTV2-114 DONE (PR #55); `runAlertNotificationPass()` wired; embed building, Discord delivery, tier-based routing all live |
| R-C10 | `discord:exclusive-insights` not routed | 2026-03-31 | UTV2-87 DONE (PR #59); exclusive-insights in promotion evaluation, distribution service, and target map |

---

## Risk Classification

| Severity | Definition |
|----------|------------|
| Critical | Blocks cutover; data loss or incorrect pick routing possible |
| High | Material user-facing impact; must be resolved before cutover |
| Medium | Cutover gate dependency or degraded observability |
| Low | Operational nuisance; acceptable for cutover; track and resolve post-cutover |
