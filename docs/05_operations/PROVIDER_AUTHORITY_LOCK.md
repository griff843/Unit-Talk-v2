# Provider Authority Lock

**Status:** Active governance rule. T1 authority.
**Adopted:** 2026-04-07 (UTV2-403)
**Owner:** PM (A Griffin)

---

## Canonical Authority Statement

**Active provider: SGO Pro. Odds API: suspended, except for Amendment A1 (game-score evaluation, engineering and staging only).**

SGO Pro is the sole live data provider for Unit Talk V2 during the active trial window (started 2026-04-04). The Odds API is suspended for this period and must not be used in active-work reasoning, analysis, or implementation, except as Amendment A1 permits.

---

## Amendment A1 — The Odds API: game-score evaluation (engineering and staging only)

**Ratified:** 2026-11-11 by Griff (reserved authority). **PM directive:** 2026-11-10.

SGO Pro keeps its authority for every provider function it holds today: odds, props,
CLV (`openFairOdds`), bookmaker coverage, Pinnacle, and the existing results-grading path.
Nothing in this amendment reduces, replaces or reorders that authority.

The Odds API is authorized for **one function only**: **full-game final scores** for
**NFL, NBA, NHL and MLB** game-line settlement evaluation (moneyline, spread, game total,
team total), sourced from its `/scores` endpoint (and the free `/events` endpoint for
event matching).

That authority holds only within these limits:

| Limit | Rule |
|---|---|
| Environments | Engineering (recorded fixtures) and the **staging** project only. No production read path, write path, key or apply. |
| Trigger | Operator-run CLI only, dry-run by default. No scheduler, daemon, cron or deploy wiring. |
| Settlement use | Track Only picks only, and only after event matching and freshness proof pass. Never member delivery. |
| Provenance | Every row carries provider `odds-api` and ingestion source `odds-api-scores.operator-run`. Never relabelled as SGO. |
| Overwrite | Never overwrites an existing result from any provider. A conflicting result fails closed. |
| Markets | Game lines only. No player props, no period or half markets, no odds or CLV from this provider. |
| NHL | Shootout and overtime settlement stays **blocked** until verified against a real, authoritative example. |
| Commercial | No plan purchase, no paid key, no production key. Free-tier or test keys in staging only, configured by Griff. |

Anything outside this table still follows the fail-closed rule below: the answer is SGO Pro.
Activation in production (a production key, a production apply, scheduled ingestion, or any
non-Track-Only settlement) needs a separate amendment ratified by Griff.

---

## Fail-Closed Rule

Provider-bound work MUST reference this file and fail closed to the active provider.

**Do not use Odds API reasoning for active-work analysis outside Amendment A1's scope.**

If a task requires provider data and it is unclear which provider to reference, stop and consult this document. The answer is SGO Pro. Do not fall back to Odds API assumptions.

---

## SGO Pro Integration Reference

| Concern | SGO Pro Pattern |
|---------|----------------|
| Results grading | `odds.<oddID>.score` (not `event.results.game`) |
| CLV computation | `openFairOdds` field |
| Bookmaker coverage | 82 bookmakers including Pinnacle and Circa |
| Pinnacle availability | Yes (Rookie plan excluded — Pro only) |
| Per-bookmaker odds | `byBookmaker` extraction active |
| Knowledge base | `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` |

---

## What Constitutes Stale Drift

The following patterns in active-work surfaces are stale drift and must be caught and corrected:

- Mentioning "Odds API" or "The Odds API" in active scripts, issue bodies, or proof procedures without a historical qualifier
- Using `oddsApiKey` or `theOddsApi` references in active implementation code (not historical/backfill scripts)
- Reasoning about Pinnacle data via Odds API when SGO provides it natively
- Issue bodies or analysis that describes Odds API behavior as the expected current behavior
- Proof procedures that call Odds API endpoints for current grading validation

References scoped to Amendment A1 (game-score evaluation files listed in the audit allow-list) are not drift.

**Active-work surfaces that must stay clean:**
- `scripts/` (except historical/backfill scripts)
- `docs/05_operations/` (except PROVIDER_KNOWLEDGE_BASE.md and historical records)
- `docs/06_status/` (all status docs)
- Issue bodies for in-progress or ready issues

---

## Historical Exception

Historical docs and commits mentioning the Odds API are explicitly allowed. This includes:

- Commits prior to 2026-04-04 (before SGO Pro trial activation)
- Files with "historical" or "backfill" in their name
- `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` (reference document — Odds API section retained for context)
- `docs/05_operations/PROVIDER_DATA_DECISION_RECORD.md` (decision history)
- Migration scripts and backfill runners
- Sprint A–D retrospective entries in PROGRAM_STATUS.md

These are `allowed-historical`. Only **active-work surfaces** need to be clean.

---

## Audit Procedure

Run the provider scope audit at the start of any session that involves provider-bound work:

```bash
tsx scripts/audit-provider-scope.ts
```

The script:
- Scans `scripts/`, `docs/05_operations/`, `docs/06_status/` for Odds API references
- Classifies each hit as `allowed-historical` or `active-work-drift`
- Exits 0 if no `active-work-drift` found
- Exits 1 with summary if any `active-work-drift` found

Any `active-work-drift` result is a governance violation and must be resolved before continuing provider-bound work.

---

## Provider Change Protocol

When the active provider changes (e.g., Odds API is reinstated, or a new provider is onboarded):

1. PM updates this file with the new canonical authority statement
2. PM updates `docs/06_status/PROGRAM_STATUS.md` Provider row
3. PM updates `docs/05_operations/PROVIDER_DATA_DECISION_RECORD.md` with decision record amendment
4. Run `tsx scripts/audit-provider-scope.ts` to establish new clean baseline
5. Existing historical references remain — only new active-work must reflect new provider

Do not update provider authority without explicit PM instruction.
