# Provider Authority Lock

**Status:** Active governance rule. T1 authority.
**Adopted:** 2026-04-07 (UTV2-403)
**Owner:** PM (A Griffin)

---

## Canonical Authority Statement

**Active provider: SGO Pro. Odds API: suspended until further notice.**

SGO Pro is the sole live data provider for Unit Talk V2 during the active trial window (started 2026-04-04). The Odds API is suspended for this period and must not be used in active-work reasoning, analysis, or implementation.

---

## Fail-Closed Rule

Provider-bound work MUST reference this file and fail closed to the active provider.

**Do not use Odds API reasoning for active-work analysis.**

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
