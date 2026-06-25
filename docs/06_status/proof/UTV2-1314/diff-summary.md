# UTV2-1314 Diff Summary — Canonical Gap Map Refresh

**Date:** 2026-06-25
**Lane:** UTV2-1314 (G-CONST-19)
**Tier:** T2 (governance/docs only)

## Files Changed

- `docs/06_status/gap-map/canonical-gap-map.json` — refreshed with 2026-06-25 session truth

## Constitutional Gap State Changes

| Gap ID | Previous State | New State | Evidence |
|--------|---------------|-----------|----------|
| G-CONST-9 | (not recorded) | RESOLVED | UTV2-1307 merged — CURRENT_STATE.md refreshed |
| G-CONST-10 | (not recorded) | CONDITIONAL | UTV2-1297 — finalized-repoll proof, depends on ingestor fix |
| G-CONST-11 | (not recorded) | OPEN | PM-deferred — retention execution requires Tier C gate |
| G-CONST-12 | (implied open) | CLOSED | UTV2-1308 merged — db-health-tripwire CI guard added |
| G-CONST-13 | (implied open) | CLOSED | UTV2-1311 merged — production SHA aligned to main HEAD |
| G-CONST-14 | Ready for Claude | DONE | UTV2-1309 merged — readiness score ledger created |
| G-CONST-15 | Ready for Claude (this lane) | DONE | UTV2-1310 merged — canonical gap map created |
| G-CONST-16 | Ready for Claude | DONE | UTV2-1311 merged — production SHA deploy follow-through |
| G-CONST-17 | Ready for Claude | DONE | UTV2-1312 merged — outbox classification audit completed |
| G-CONST-18 | (not recorded) | IN_PROGRESS | UTV2-1313 readiness score refresh active |
| G-CONST-19 | (not recorded) | IN_PROGRESS | UTV2-1314 this lane |

## dispatch_ready Removals

Removed from `dispatch_ready` (now Done, not dispatchable):
- UTV2-1309 (G-CONST-14 — readiness score ledger)
- UTV2-1310 (G-CONST-15 — canonical gap map)
- UTV2-1311 (G-CONST-16 — production SHA)
- UTV2-1312 (G-CONST-17 — outbox classification)

## Active Blockers Added

- `ingestor_health`: markClosingLines statement_timeout (fix: UTV2-1315, blocked on PM Tier C approval)
- `constitution_convergence`: ~68%, threshold 80%, non-blocking

## State Counts Delta

| Metric | Before | After |
|--------|--------|-------|
| total_open_issues | 27 | 24 |
| Ready for Claude | 5 | 1 |
| constitutional CLOSED | 0 | 2 |
| constitutional DONE | 0 | 4 |
| constitutional RESOLVED | 0 | 1 |
| constitutional CONDITIONAL | 0 | 1 |
| constitutional OPEN | 0 | 1 |
| constitutional IN_PROGRESS | 0 | 2 |

## No Code Changes

This is a docs-only governance lane. No source code, tests, migrations, or TypeScript files were modified.

---

## Merge SHA Binding

**Merge SHA:** `044a72d4eb8593ff65e081dfbc3d9ab04648c044`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1075
**Merged at:** 2026-06-25T15:35:32Z
