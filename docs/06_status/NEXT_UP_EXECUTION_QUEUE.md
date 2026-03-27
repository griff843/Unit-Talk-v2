# Next Up Execution Queue

> **STALE — DO NOT USE.** Last updated 2026-03-26. This file shows T1 Automated Grading as ACTIVE — that lane closed 2026-03-26, and 8+ more lanes have closed since.
> **Use `docs/06_status/ISSUE_QUEUE.md` as the operational work queue.**
> This file is preserved as historical record only.
> Tier rules come from `docs/05_operations/SPRINT_MODEL_v2.md`.
> Contracts/specs authorize implementation; this file only summarizes what is next.
> Last updated: 2026-03-26 (T1 Automated Grading in progress — Codex; Augment seed script + SGO research delivered; T2 SGO Results Ingest contract 2/3 blockers resolved; `/stats` spec authored)

---

## Queue Status Legend

| Status | Meaning |
|---|---|
| ACTIVE | Currently authorized and in progress |
| READY | Authorized and ready to open when capacity is available |
| BLOCKED | Cannot start yet; prerequisite missing |
| DEFERRED | Intentionally not next |
| DOCS-ONLY | Governance/spec work only; not an implementation lane |

---

## Current Active Lane

| Priority | Item | Tier | Status | Owner | Authority | Notes |
|---|---|---:|---|---|---|---|
| 1 | T1 Automated Grading — Results Schema & Grading Service | T1 | **ACTIVE** | Codex | `docs/05_operations/T1_AUTOMATED_GRADING_CONTRACT.md` | In progress — migration 012 + grading-service + recordGradedSettlement() |

---

## Next Ready Lane

| Priority | Item | Tier | Status | Owner | Authority | Unlock Condition |
|---|---|---:|---|---|---|---|
| 1 | T2 SGO Results Ingest — Populate game_results from feed | T2 | READY (after T1 Grading closes) | Codex | `docs/05_operations/T2_SGO_RESULTS_INGEST_CONTRACT.md` | 2/3 blockers resolved; ratify after one live SGO API call confirms results JSON shape; then open when T1 Grading is CLOSED |
| 2 | Discord Bot `/stats` command | T2 | READY (spec authored; needs T2 contract) | Codex | `docs/03_product/DISCORD_STATS_COMMAND_SPEC.md` | Spec written; author T2 contract in `docs/05_operations/` before opening; needs T1 Grading CLOSED |

---

## Blocked Queue

| Item | Tier | Blocker | Required To Unblock |
|---|---:|---|---|
| `/stats` Discord command | T2 | No T2 contract yet (spec exists: `docs/03_product/DISCORD_STATS_COMMAND_SPEC.md`) | Author T2 contract in `docs/05_operations/`; then open after T1 Grading closes |
| `/recap` Discord command | T2 | RecapAgent not implemented | Complete RecapAgent / recap workflow slice |
| Thread routing / `discord:game-threads` | T1 | No ratified thread-routing contract | Author and ratify thread-routing contract |
| DM routing / `discord:strategy-room` | T1 | No DM delivery contract | Author and ratify DM routing contract |
| Auto results ingest (SGO results endpoint) | T2 | Grading schema requires manual seeding until results ingest is wired | Close T1 Automated Grading first, then wire auto-results as follow-on |
| Auto-settlement trigger | T1 | Grading not implemented | Close grading slice first |

---

## Explicit Do-Not-Open List

Do not open these as active implementation lanes right now:

| Item | Reason |
|---|---|
| Second T1 implementation lane in parallel with another active T1 | Violates clean active-lane discipline for high-risk work |
| Any new Discord live routing target | Requires explicit contract / readiness decision |
| Temporal integration | Not next; higher-value blockers exist first |

---

## Immediate Operator Actions

1. **T1 CLV is CLOSED.** Migration 011 applied clean — Remote 202603200011 confirmed. All proof items verified. No deviations.
2. **Discord Bot `/pick` command is CLOSED.** Root verify is green at 719/719.
3. **T1 Automated Grading is ACTIVE.** Codex implementing migration 012, grading-service, recordGradedSettlement(). Contract: `docs/05_operations/T1_AUTOMATED_GRADING_CONTRACT.md`.
4. **T2 SGO Results Ingest contract is DRAFT (2/3 blockers resolved).** One live SGO API call required to confirm results JSON shape, then ratify. Open after T1 Grading closes.
5. **Discord `/stats` spec is AUTHORED.** Spec: `docs/03_product/DISCORD_STATS_COMMAND_SPEC.md`. Author T2 contract before opening implementation.
6. **Augment deliverables received:** `scripts/seed-game-result.ts` (proof seeder, type-check clean) + `docs/05_operations/sgo_results_api_research.md` (SGO results confirmed in v2/events endpoint).

---

## Promotion Rule For This Queue

When an ACTIVE lane closes:

1. Update `PROGRAM_STATUS.md` first
2. Update any affected contract/spec/checklist docs
3. Then update this queue:
   - move CLOSED lane out of "Current Active Lane"
   - promote the next READY lane only if it is explicitly opened
   - keep blocked items blocked unless the exact blocker was removed

---

## References

- `docs/06_status/PROGRAM_STATUS.md`
- `docs/06_status/production_readiness_checklist.md`
- `docs/05_operations/SPRINT_MODEL_v2.md`
- `docs/05_operations/T1_FEED_ENTITY_RESOLUTION_CONTRACT.md` ← active T1 contract
- `docs/05_operations/T1_PROVIDER_INGESTION_CONTRACT.md`
- `docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md`
- `docs/03_product/DISCORD_BOT_FOUNDATION_SPEC.md`
- `CLAUDE.md`
- `AGENTS.md`
