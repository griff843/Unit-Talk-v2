# PROOF: UTV2-1264
MERGE_SHA: 862106f527098b929cfe25d672eb8f95766a41f0

## Verification

ASSERTIONS:
- [x] Root cause documented: the reported 1,833-row `missing_event_context` bucket conflates player props sharing the `points-all-game-ou` market key — it is not a clean game-total population. Live audit found 445 event-scoped `points-all-game-ou` universe rows, 388 with verified closing line + both closing odds, 57 canonical `game_total_ou` picks already computing through universe provenance, and 27 real scanner game totals falling to `missing_event_context` despite retaining canonical `eventId`/`providerEventId`/event start time because their referenced universe row no longer resolves.
- [x] Join chain from game-total pick to closing line implemented in `clv-service.ts`, resolving event-scoped totals through retained event identity and querying verified closing data with a null participant.
- [x] A retained `providerEventId` plus valid `eventStartTime` resolves without a local `events` row.
- [x] Retained event start is the offer cutoff, so an otherwise valid post-start snapshot cannot be selected.
- [x] Repeated same-day event names are disambiguated by exact retained start time.
- [x] No fabricated CLV — only verified historical closing odds from provider data used.
- [x] `pnpm verify` green, including `pnpm test:db` and the live T1 proof suites (see EVIDENCE).
- [x] R-level check PASS, no artifacts required.

EVIDENCE:
```text
$ pnpm verify
(exit 0: env:check, lint, type-check, build, test, test:db, and T1 live proofs green)

$ npx tsx --test apps/api/src/clv-service.test.ts
1..38
# tests 38
# pass 38
# fail 0
# skipped 0

$ pnpm test:db
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

## Runtime proof

A read-only audit against Supabase project `zfzdnfwdarxucxtaojxm` loaded production-shaped scanner game-total picks and their provider aliases/offers. Removing only stale universe linkage in memory exercised the new retained-identity path: 10/10 sampled rows computed CLV from verified provider snapshots, with 0 selected snapshots after each retained event start. No live rows were inserted, updated, or deleted.
