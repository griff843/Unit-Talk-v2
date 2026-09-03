# UTV2-1823 Diff Summary

Generated at: 2026-09-03T05:05:38.734Z
Issue: UTV2-1823
Tier: T1
Lane type: runtime
Branch: claude/utv2-1823-authenticate-trace
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1501
Head SHA: 76d0f6f151d63f2eff08bcbcd6f3184fbfb044cf
Merge SHA: b7d9fc07fca5a03d5cf0b343beb3161c58295aed
Diff base: 01a2d2d67de5602441b9609d43a00c532dd73dce
Diff target: 76d0f6f151d63f2eff08bcbcd6f3184fbfb044cf

## What changed

| File | Change |
|---|---|
| `apps/api/src/server.ts` | The `GET /api/picks/{id}/trace` route match moves from above the auth gate into the gate predicate (`\|\| traceMatch`), and its handler moves below the gate. Role policy for the route is stated inline as operator-only, with a comment recording that it belongs in `ROUTE_ROLES` once a lane is authorized to edit the Tier C `apps/api/src/auth.ts`. |
| `apps/api/src/server.test.ts` | Three UTV2-1823 acceptance tests: anonymous 401 with no pick data in any field, authenticated operator 200 with all eight payload keys intact, authenticated unknown-id 404 `PICK_NOT_FOUND`. |

## Why

`apps/api/src/server.ts` has exactly one auth gate, and every route dispatched
above it returns before the gate runs. `GET /api/picks/{id}/trace` sat above it,
so any anonymous caller who knew or guessed a pick UUID could read that pick's
entire lifecycle aggregate over the public Caddy-terminated API hostname: the
`PickRecord` including `metadata` (`distributionMode`, `submittedBy`, `eventId`,
promotion scores), submission events, promotion history, outbox entries,
distribution receipts with their delivery targets and external ids, settlement
records, audit log entries and lifecycle events.

UTV2-1427 set the governing standard in the same predicate: the kill-switch
**GET** is gated because its response reveals staff-only operational state
rather than public delivery truth. A pick's full lifecycle, audit trail and
delivery receipts meet that standard.

This closes before the Track Only pilot because the pilot creates exactly the
record this route exposes.

## Blast radius

One predicate gains one disjunct; one route match and one handler move across
it. No repository, controller, response shape, role, token type or environment
variable changes. `apps/api/src/auth.ts` is not in the diff. No database
access, no migration, no member-facing delivery path. `r-level-check` returns
PASS with no rules matched.

## Known exposure this lane does NOT close

`GET /api/picks/{id}/routing-preview` and `GET /api/picks/{id}/promotion-preview`
remain unauthenticated and leak the same class of staff-only state (promotion
target, score and reason; resolved delivery target; outbox status and attempt
count; gate checks). They are not gated here because
`apps/command-center/src/lib/data/preview.ts` calls both with no
`Authorization` header, so gating them would break the operator surface —
which this issue's AC6 forbids. Closing them requires a credentialed Command
Center proxy first. See `verification.md` for the full disposition.

## Git Diff Stat
```
.ops/sync/UTV2-1823.yml                 | 300 ++++++++++++++++++++++++++++++++
 apps/api/src/server.test.ts             | 155 +++++++++++++++++
 apps/api/src/server.ts                  |  58 ++++--
 docs/06_status/lanes/UTV2-1823.json     |  37 ++++
 docs/06_status/proof/UTV2-1823/.gitkeep |   0
 5 files changed, 534 insertions(+), 16 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1823.yml
M	apps/api/src/server.test.ts
M	apps/api/src/server.ts
A	docs/06_status/lanes/UTV2-1823.json
A	docs/06_status/proof/UTV2-1823/.gitkeep
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 76d0f6f151d63f2eff08bcbcd6f3184fbfb044cf
Merge SHA: b7d9fc07fca5a03d5cf0b343beb3161c58295aed
