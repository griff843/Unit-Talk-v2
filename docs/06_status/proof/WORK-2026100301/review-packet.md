# Discord presentation review packet

PR: https://github.com/griff843/Unit-Talk-v2/pull/1714
Issue: WORK-2026100301. Draft, not merge-ready.
PM-reviewed product source SHA: ca2ef310e6726a088f1a12e0d82d0e924ad8e2f7.
The control-closure exact HEAD is returned in the PM handoff and bound by CI receipts. Product paths under `apps/**` and `packages/**` are unchanged from the reviewed SHA.

## Families

All 22 builders: Official Pick, Pick Posted, Win, Loss, Push, Void, Correction, Daily/Weekly/Monthly Recap, Capper Record/Profile, Leaderboard, Welcome, Trial Started/Expiring, Upgrade, Service Alert, Access Denied, Bot Error, Capper Onboarding, System Maintenance.

Migrated worker picks, settlement displays, API/bot recaps, all 14 bot command surfaces, onboarding, line/steam/injury/hedge notifications, grading/ingestor failure webhooks, and scheduled monitor/digest webhooks. Existing destinations and runtime conditions are retained.

## Before / after truth fixes

| Before | After |
|---|---|
| Ad hoc colors and inconsistent footers | Shared gold/white/black tokens; semantic accents only settled states |
| Public confidence and technical metadata | Explicit public field whitelist; internal submission confidence preserved |
| Null CLV displayed as zero or placeholders | Unknown absent; measured 0.0% visible |
| Invented identity, display clock, first mover/probability/profit defaults | Only supplied canonical evidence renders |
| Winner-focused/top-N or truncated recaps | All supplied settled rows, including losses, safely paginated |
| Missing wager inputs could imply financial outcomes | Unknown wager-derived values omitted |
| Inconsistent commercial or error copy | Reserved VIP+ price; Black Label unavailable; denials/errors private |
| Media assumptions | Missing/invalid optional media never blocks presentation |

## Verification and rendering

See verification.md and evidence.json for measured checks and blockers. Rendered desktop/mobile PNGs and render-report.json use actual builders in a local simulation. No QA sandbox credentials/map were available; no live rendering claim.

## Intentionally not wired

New Welcome, automated Trial Started/Expiring, Capper Profile, System Maintenance, Void and Correction lifecycle triggers. Builders are tested; new event sources were not created. Existing inactive intelligence lanes and blocked Discord targets remain inactive.

## Separate product/routing gaps

All-tier settled-history transparency is not established by receipt-derived channel routing. Current settlement/history aggregation handles Win/Loss/Push without full Void/Correction lifecycle coverage. Unknown stake retains the existing suppression safeguard. Some canonical CLV evidence may remain unavailable to the existing payload reader. Old delete/replace correction guidance needs policy reconciliation with append-only history.

No prices, entitlements, permissions, channel topology, routing/promotion rules, grading, settlement, scoring, provider activation, kill switches or Black Label activation were changed.

## PM/operations decisions required

PR 1712 landed the general WORK-ID parser repair; it is incorporated through the merge-mutex wrapper. An exact-HEAD external record must represent Griff's approved sender/control scope. Shadow execution is pinned entirely to the attested base checkout; live proof still requires approved read-only secrets. The sanctioned executor completed successfully and recorded actual closure model/effort/exit provenance. Source-head CI verify, writable staging DB, T1, tier and R-level checks passed; final current-head checks and receipts remain required. PM merge approval remains outstanding.

The exact changed-file inventory is diff-summary.md. R2/R3/R4 artifacts are offline presentation evidence, not live production certification.

MERGE_SHA: pending merge
