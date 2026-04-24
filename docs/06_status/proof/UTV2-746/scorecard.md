# UTV2-746 SGO Contract Hardening — Replay Audit & Trust Scorecard

**Status:** Complete (T2, no runtime verification required)
**SHA:** c4b26b673412ef64fd9e7675f200261686466d44
**Evidence:** `docs/06_status/proof/UTV2-746/evidence.json`
**Scorecard docs:** `docs/05_operations/SGO_REPLAY_SCORECARD.md`, `docs/05_operations/SGO_CONTRACT_HARDENING.md`

---

## Hardening Sprint Summary (UTV2-664 → UTV2-745)

12 issues Done. 10 mapped to merged PRs or SHAs. All rules canonicalized in contract matrix.

| Bucket | Before Sprint | After Sprint |
|---|---|---|
| Grading result source | `results.game` (wrong) | `odds.<oddID>.score` ✅ |
| Finalization gate | `status.completed` (unreliable) | `status.finalized` ✅ |
| Finalized repoll | None — events stuck `in_progress` | Periodic repoll added ✅ UTV2-745 |
| CLV closing line coverage (MLB) | ~0% | **88.1%** ✅ UTV2-738 |
| CLV closing line coverage (NBA) | ~0% | **82.8%** ✅ UTV2-738 |
| PostgREST 1000-row cap | Silently truncating | Paginated `.range()` ✅ UTV2-738 |
| Legacy totals grading skip | 100% skip rate | Market key join fixed ✅ UTV2-733 |
| SGO request contract | 4 independent param builders | Centralized module ✅ UTV2-743 |
| Historical open/close odds capture | Missing `includeOpenCloseOdds=true` | Fixed ✅ UTV2-721 |
| Market key normalization | Raw SGO key in grading join | Canonical form ✅ UTV2-664 |

## Grading Skip Snapshot (pre-repoll, 2026-04-23T21:22Z)

- Attempted: 326 | Graded: 0 | Skipped: 326
- Bucket A `event_not_completed`: 286 (87.7%) — **cleared by UTV2-745** (Done PR #454)
- Bucket B `missing_participant_id`: 40 (12.3%) — open, owned by UTV2-740

## Remaining Gaps

| Gap | Issue | State |
|---|---|---|
| 40 player alias rows unresolved | UTV2-740 | Ready for Codex |
| Participant-aware market aliasing in materializer | UTV2-732 | Codex lane active |
| `scoringSupported` hard gate | UTV2-742 | Ready for Codex |
| `includeOpenCloseOdds=true` always in historical | UTV2-744 | Ready for Codex |
| R5 replay CLV ROI proof | UTV2-736 | Blocked (needs 732+745 data) |
| `event_id` FK in market_universe | deferred | Phase 3 |
