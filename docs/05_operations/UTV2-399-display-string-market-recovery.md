# UTV2-399: Operator Recovery — Display-String Market Picks

## Context

Before UTV2-399, manual Smart Form submissions that bypassed the live-offer browse flow
could produce picks with `market` values like `"NBA - Player Prop"` instead of canonical
market type IDs like `"player_points_ou"`. These picks cannot be graded because the grading
service matches `picks.market` against `game_results.market_key`, which stores canonical IDs.

The fix (UTV2-399) blocks new display-string markets at both the client (BetForm guard) and
the API (422 UNRESOLVABLE_MARKET guardrail). Picks already in the database with display-string
markets require manual correction.

---

## Identifying Affected Picks

Run this against the live database to find all picks with display-string markets:

```sql
SELECT id, market, status, metadata->>'sport' AS sport, metadata->>'statType' AS stat_type,
       metadata->>'player' AS player, created_at
FROM picks
WHERE market LIKE '% - %'
ORDER BY created_at DESC;
```

The pattern `% - %` matches the display-string fallback format `"<Sport> - <Market Label>"`.

---

## Recovery Path

For each affected pick, determine the canonical `market_type_id` from `stat_type` in metadata,
then POST to the settle endpoint with the corrected market embedded in the correction payload.

**There is no `/api/picks/:id/correct-market` endpoint.** The only settlement correction path
is via `POST /api/picks/:id/settle`. The `market` field on the pick record itself cannot be
mutated after insertion — this is a schema invariant (`settlement_records.corrects_id`).

### Option A — Settle with grading off (mark as void if unresolvable)

If the pick cannot be graded (game results not available or market truly unresolvable):

```bash
curl -s -X POST http://localhost:4000/api/picks/<PICK_ID>/settle \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPERATOR_API_KEY" \
  -d '{
    "result": "void",
    "notes": "UTV2-399: pick had display-string market value, cannot be graded — voided by operator"
  }'
```

### Option B — Correct via re-submission (preferred when game has results)

If the game is settled and results are available in `game_results`:

1. Identify the canonical `market_type_id` for the pick's stat type using the mapping in
   `apps/smart-form/lib/form-utils.ts` → `STAT_LABEL_TO_MARKET_TYPE_ID`.

2. Submit a corrected pick via the API with the canonical market value:
   ```bash
   curl -s -X POST http://localhost:4000/api/submissions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $OPERATOR_API_KEY" \
     -d '{
       "source": "smart-form",
       "submittedBy": "<original_capper>",
       "market": "player_points_ou",
       "selection": "<original_selection>",
       "line": <original_line>,
       "odds": <original_odds>,
       "stakeUnits": <original_units>,
       "confidence": <original_confidence>,
       "eventName": "<event_name>",
       "metadata": {
         "sport": "NBA",
         "marketType": "player-prop",
         "statType": "Points",
         "overUnder": "over",
         "player": "<player_name>",
         "capper": "<capper>",
         "submissionMode": "manual",
         "marketResolution": "canonical",
         "correctionOf": "<original_pick_id>",
         "correctionReason": "UTV2-399: original pick had display-string market"
       }
     }'
   ```

3. Void the original pick (see Option A above).

---

## Known Affected Picks (as of 2026-04-05)

The 7 picks submitted manually via Smart Form before UTV2-399 deployment that may have
display-string markets. Query using the SQL above to get exact IDs and markets.

Run the automated grading endpoint after any corrections to verify settlement:

```bash
curl -s -X POST http://localhost:4000/api/grading/run \
  -H "Authorization: Bearer $OPERATOR_API_KEY" \
  -d '{}'
```

---

## Prevention (Post-UTV2-399)

- **Client-side**: `BetForm.tsx` `onSubmit` blocks submission with a toast when
  `resolveCanonicalMarketTypeId()` returns null for manual player-prop picks.
- **API-side**: `processSubmission()` in `submission-service.ts` throws
  `ApiError(422, 'UNRESOLVABLE_MARKET')` for any market value containing ` - `.
- **`metadata.marketResolution`**: set to `'canonical'` or `'display-fallback'` on all
  new submissions for auditability.

The display-string fallback path in `buildSubmissionPayload` is preserved as a last resort
but the API guardrail now rejects it, making the fallback unreachable in practice.
