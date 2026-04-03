# Recap Contract

**Status:** RATIFIED  
**Authority:** Runtime (`apps/api/src/recap-service.ts`)  
**Updated:** 2026-04-03

---

## 1. Timezone Authority

All recap window computation is in **UTC**. There is no ET offset in the runtime.

- Window boundaries: `Date.UTC(...)` — pure UTC midnight anchors
- Trigger detection: `now.getUTCHours()`, `now.getUTCDay()`, `now.getUTCDate()`
- Labels: formatted with `timeZone: 'UTC'`

**Implication:** A "daily" recap triggered at 11:00 UTC covers UTC midnight-to-midnight, which is 7:00 AM ET / 6:00 AM CT the prior day to the same time today. Do not document this as an ET-anchored window.

---

## 2. Cadence and Trigger Schedule

The recap scheduler calls `detectRecapCollision(now)` every minute. It fires a recap when:

| UTC time | UTC day / date | Recap type |
|----------|---------------|-----------|
| 11:00 UTC | Any weekday except Mon | `daily` |
| 11:00 UTC | Monday (not 1st Mon of month) | `weekly` |
| 11:00 UTC | 1st of month (not a Monday) | `monthly` |
| 11:00 UTC | 1st Monday of month (date ≤ 7) | `combined` (weekly + monthly) |

Outside of 11:00 UTC exactly, `detectRecapCollision` returns `'none'` — no recap fires.

---

## 3. Window Definitions

### Daily

- `startsAt`: current UTC midnight − 24 hours
- `endsAt`: current UTC midnight
- Covers: the prior calendar day in UTC
- Label: `Daily Recap - <Month Day>`

### Weekly

- Week start: Monday UTC midnight (Sunday = day 0 → offset 6; Monday = day 1 → offset 0)
- `startsAt`: the Monday one week before current week's Monday
- `endsAt`: current week's Monday UTC midnight
- Covers: Mon–Sun of the prior full week (inclusive start, exclusive end)
- Label: `Weekly Recap - <Mon Day>-<Sun Day>`

### Monthly

- `startsAt`: first day of the prior calendar month (UTC)
- `endsAt`: first day of the current calendar month (UTC)
- Covers: the entire prior calendar month
- Label: `Monthly Recap - <Month Year>`

### Combined (weekly + monthly collision)

When the first Monday of a month falls exactly on the 1st, `detectRecapCollision` returns `'combined'`. The caller must post both a weekly and a monthly recap. Each recap uses its own idempotency key and is posted independently.

---

## 4. Settlement Inclusion Criteria

A settlement record is included in a recap window if and only if:

1. `status = 'settled'`
2. `result IN ('win', 'loss', 'push')` — voids and other statuses are excluded
3. `created_at >= startsAt AND created_at < endsAt`

Up to 5,000 most recent settlement records are scanned per recap computation (`RECENT_SETTLEMENT_LIMIT = 5_000`). If the window has 0 qualifying settlements, the recap is skipped (`ok: false, reason: 'no settled picks in window'`).

---

## 5. Top Play Selection

Top play = the settlement row with highest `profitLossUnits`. Tie-breaking:

1. Higher `profitLossUnits` first
2. Higher `stake_units` first (default 1u if null)
3. Later `created_at` first

---

## 6. Profit/Loss Unit Computation

| Result | Formula |
|--------|---------|
| `push` | 0 |
| `loss` | −stake |
| `win` (positive odds) | stake × (odds / 100) |
| `win` (negative odds) | stake × (100 / |odds|) |
| `win` (null/invalid odds) | stake (1:1 fallback) |

Stake defaults to 1u when `stake_units` is null or non-finite.

---

## 7. Embed Required Fields

Every recap embed (Discord rich embed) must include all of the following:

| Field | Content |
|-------|---------|
| `title` | `<Period> Recap - <date range>` |
| `color` | `0x2f855a` (green) if `netUnits ≥ 0`; `0xc53030` (red) otherwise |
| `Record` (inline) | `W-L-P` format |
| `Net Units` (inline) | `+X.XXu` format with sign |
| `ROI` (inline) | `+X.XX%` format with sign |
| `Sample` (inline) | `N picks over D days` |
| `Top Play` (full width) | Selection (market), Result, P/L, Capper |

**Small sample warning:** If `totalPicks < 20`, the Sample field appends: `_Small sample — interpret with caution_`

---

## 8. Idempotency

Recap posts are deduplicated by idempotency key:

```
recap:<period>:<channel>:<windowEndsAt>
```

If an outbox row already exists with `status = 'sent'` for this key, the recap service returns `ok: true, postsCount: 0` without re-posting.

If a row exists in `pending` or `processing`, it is reused rather than creating a duplicate.

---

## 9. Delivery Channel

Default channel: `discord:recaps` (channel ID `1300411261854547968`).

Channel may be overridden via `options.channel` (manual trigger) or `UNIT_TALK_DISCORD_TARGET_MAP` env variable for named target resolution.

Receipt type recorded: `discord.message`  
Audit action: `distribution.sent`, actor: `recap-service`

---

## 10. Dry-Run Mode

`RECAP_DRY_RUN=true` causes `postRecapSummary` to return `ok: true, postsCount: 0, dryRun: true` without posting to Discord or writing an outbox row. Used in development and CI.

---

## 11. Dev vs Prod Routing

| Environment | Behavior |
|-------------|----------|
| Dev (no `DISCORD_BOT_TOKEN`) | Returns `ok: false, reason: 'DISCORD_BOT_TOKEN not configured'` |
| Dev (`RECAP_DRY_RUN=true`) | Skips post, returns summary, no outbox row |
| Prod | Posts to `discord:recaps`, writes outbox + receipt + audit |

No separate dev channel routing is implemented in the runtime. Dev isolation is achieved entirely via `RECAP_DRY_RUN`.

---

## 12. What This Contract Does Not Cover

- Manual recap triggers via API (`POST /api/recap/:period`) — covered in route-level docs
- Recap content policy (what qualifies a pick for inclusion beyond settlement status) — governed by settlement-service
- Retroactive recap correction — settlement records are immutable; corrections use `corrects_id` chain and produce new settlement records which will appear in future windows
