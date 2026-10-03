# Discord presentation review packet

PR: https://github.com/griff843/Unit-Talk-v2/pull/1714
Issue: WORK-2026100301. Draft, not merge-ready.
Executable-source SHA: da000d16c15fb10b2a44e183cb6627e313677507.
Final HEAD is returned in the PM handoff; later evidence-only commits do not change executable sources.

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

Trusted expanded-scope approval currently cannot use this WORK ID in the UTV2-only scope-comment parser. Stage DB proof must run with staging-ci credentials. Production shadow safety needs CI resolution; this lane does not bypass it. Initial tier synchronization ran before the T1 label was applied and requires re-evaluation. Execution-model attestation is unavailable in this desktop session. PM merge approval remains outstanding.

The exact changed-file inventory is diff-summary.md. R2/R3/R4 artifacts are offline presentation evidence, not live production certification.
