# PROOF: UTV2-1264
MERGE_SHA: ace2260b9cc1bbf721c0f4a02d84a978d459a2c0

## Verification

ASSERTIONS:
- [x] Root cause documented: the reported 1,833-row `missing_event_context` bucket conflates player props sharing the `points-all-game-ou` market key — it is not a clean game-total population. Live audit found 445 event-scoped `points-all-game-ou` universe rows, 388 with verified closing line + both closing odds, 57 canonical `game_total_ou` picks already computing through universe provenance, and 27 real scanner game totals falling to `missing_event_context` despite retaining canonical `eventId`/`providerEventId`/event start time because their referenced universe row no longer resolves.
- [x] Join chain from game-total pick to closing line implemented in `clv-service.ts`, resolving event-scoped totals through retained event identity and querying verified closing data with a null participant.
- [x] No fabricated CLV — only verified historical closing odds from provider data used.
- [x] `pnpm verify` green (see EVIDENCE).
- [x] R-level check PASS, no artifacts required.

EVIDENCE:
```text
$ pnpm verify
(all steps green: env:check, lint, type-check, build, test)

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
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```

## Note

Dispatched via Codex (`codex-sol-high`). The Codex CLI process hit `ETIMEDOUT` after completing the implementation and audit but before finishing `pnpm verify`/`pnpm test:db`/PR creation. Work was committed locally (`feat(api): UTV2-1264 resolve game-total CLV`); the orchestrator pushed the branch and is completing verification below since the automated flow could not finish.
