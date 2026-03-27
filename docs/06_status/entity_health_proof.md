# UTV2-45 — Entity Health Verification Proof

**Task:** T3 Live DB entity health verification (lane:augment, verification-only)
**Issue:** UTV2-45
**Observed at:** 2026-03-27T06:06–06:08 UTC
**Verified by:** Augment (independent verification)
**Main commit at time of proof:** `4bf5844` — `feat: add operator entity ingest health surfaces (#19)`

---

## 1. Implementation Status

UTV2-42 (Operator Entity Ingest Health) is **MERGED to main** as of commit `4bf5844`.
The queue file listed it as IN_REVIEW — that was stale. Runtime truth wins.

All surfaces verified live:
- `GET /api/operator/snapshot` → includes `entityHealth` ✅
- `GET /api/operator/participants` → route present and returning data ✅
- `apps/operator-web` runs against live Supabase in `database` mode ✅

---

## 2. entityHealth — Live DB vs Operator Surface

Server started from repo root (`pnpm exec tsx apps/operator-web/src/index.ts`).
Note: pnpm filter changes cwd to `apps/operator-web`, which breaks `loadEnvironment()` —
must be launched from repo root so `local.env` is found.

### GET /api/operator/snapshot → data.entityHealth

```json
{
  "resolvedEventsCount": 46,
  "upcomingEventsCount": 18,
  "resolvedPlayersCount": 535,
  "resolvedTeamsWithExternalIdCount": 124,
  "totalTeamsCount": 124,
  "observedAt": "2026-03-27T06:06:21.792Z"
}
```

`persistenceMode: "database"` — confirmed live DB, not demo fallback.

### Direct Supabase Query (cross-reference)

Script: `pnpm exec tsx scripts/_utv2-45-db-check.ts` (ephemeral, deleted after run)
Queried at: `2026-03-27T06:07:49.797Z`

```json
{
  "events": {
    "totalRows": 46,
    "resolvedCount": 46,
    "upcomingCount": 18
  },
  "participants": {
    "playerCount": 535,
    "teamTotalCount": 124,
    "teamResolvedWithExternalIdCount": 124
  }
}
```

### Match verdict

| Field | Operator Surface | Direct DB Query | Match |
|---|---|---|---|
| `resolvedEventsCount` | 46 | 46 | ✅ |
| `upcomingEventsCount` | 18 | 18 | ✅ |
| `resolvedPlayersCount` | 535 | 535 | ✅ |
| `resolvedTeamsWithExternalIdCount` | 124 | 124 | ✅ |
| `totalTeamsCount` | 124 | 124 | ✅ |

**All five entityHealth fields match live DB row counts exactly.**

Incidental observation: `resolvedEventsCount == totalRows` (46 == 46) — every event row
has a non-null `external_id`. This is consistent with the SGO ingest writing `external_id`
on all ingested events.

---

## 3. GET /api/operator/participants?q=brunson

```
GET http://localhost:4200/api/operator/participants?q=brunson
Observed at: 2026-03-27T06:06:22.225Z
```

Response:
```json
{
  "participants": [
    {
      "id": "8c4d79d3-dbeb-41a6-a9cf-38724817012e",
      "displayName": "Jalen Brunson",
      "participantType": "player",
      "sport": "NBA",
      "league": "NBA",
      "externalId": "JALEN_BRUNSON_1_NBA",
      "metadata": {
        "team_external_id": "NEW_YORK_KNICKS_NBA"
      }
    }
  ],
  "total": 1,
  "observedAt": "2026-03-27T06:06:22.225Z"
}
```

**Verdict:** Jalen Brunson is resolved in the entity catalog. `externalId=JALEN_BRUNSON_1_NBA`,
team linked to `NEW_YORK_KNICKS_NBA`. Entity resolution ran successfully.

Direct DB cross-reference confirmed same row (`ilike '%brunson%'` → 1 row, matching ID).

---

## 4. Participant Route — Sample

```
GET http://localhost:4200/api/operator/participants?type=player&limit=5
total: 535
```

First 5 returned (alphabetical by display_name):
- Aaron Gordon (NBA, Denver Nuggets)
- Aaron Holiday (NBA, Houston Rockets)
- Aaron Judge (MLB, New York Yankees)
- Aaron Nesmith (NBA, Indiana Pacers)
- Ace Bailey (NBA, Utah Jazz)

All have `externalId` set — consistent with resolved entity catalog.

---

## 5. Verdict

| Check | Result |
|---|---|
| `entityHealth` present in snapshot | ✅ PASS |
| `resolvedEventsCount` matches live DB | ✅ PASS (46 == 46) |
| `resolvedPlayersCount` matches live DB | ✅ PASS (535 == 535) |
| `resolvedTeamsWithExternalIdCount` matches live DB | ✅ PASS (124 == 124) |
| `GET /api/operator/participants?q=brunson` returns Jalen Brunson | ✅ PASS |
| `persistenceMode: "database"` (not demo fallback) | ✅ PASS |

**UTV2-42 implementation verified against live DB. All AC checks pass.**
