# Discord `/stats` Command Spec

> **Status:** DRAFT — pending `/stats` contract ratification before implementation begins
> **Tier:** T2 — additive; no new migration, no settlement path changes
> **Authority:** This spec is a product surface definition. A ratified T2 contract in `docs/05_operations/` is required before implementation begins.
> **Unlock condition:** T1 Automated Grading must be CLOSED; `settlement_records` must have meaningful graded records in production before this surface is useful.
> **Last updated:** 2026-03-26

---

## Purpose

`/stats` gives cappers and operators a bounded, self-serve view into pick performance over a time window. It surfaces win rate, ROI, and CLV% — the three signals the system already computes — in a Discord-native embed. It is read-only and stateless: no DB writes, no pick creation.

---

## What `/stats` Displays

### Required Fields (Minimum Viable Surface)

| Field | Source | Description |
|---|---|---|
| `Picks` | `settlement_records` count | Total settled picks in the window |
| `Record` | `settlement_records.result` | W–L–P (wins, losses, pushes) |
| `Win Rate` | wins / (wins + losses) | Excludes pushes from denominator |
| `ROI` | `flat_bet_roi_pct` | Flat-bet return on investment % |
| `Avg CLV%` | `avg_clv_percent` from daily-rollup | Average closing line value across picks |
| `Beats Line` | `beatsClosingLine` count / total | % of picks that beat the closing line |

### Optional Fields (when data is available)

| Field | Source | Description |
|---|---|---|
| `Best Sport` | grouped by `picks.sport` | Highest win rate sport in the window |
| `Best Market` | grouped by `picks.market_key` | Highest win rate market type |
| `Streak` | ordered `settlement_records` | Current W or L streak |
| `Last 5` | trailing 5 results | `W W L W L` visual sequence |

### Display Scope

The embed renders exactly one scope at a time:

| Scope | Description |
|---|---|
| **Capper** | Stats for one capper (`/stats capper:@user`) |
| **Server** | Aggregate stats across all cappers on the server (default when no capper specified) |

---

## Command Signature

```
/stats [capper] [window] [sport]
```

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `capper` | User mention | No | Server aggregate | The capper to look up |
| `window` | Integer | No | `30` | Trailing N days (7, 14, 30, 90) |
| `sport` | String | No | All sports | Filter by sport (NBA, NFL, MLB, etc.) |

### Allowed `window` Values

`7`, `14`, `30`, `90` — discrete options only. Free-form integer input is rejected.

---

## Required API Surface

### Endpoint

```
GET /api/operator/stats
```

This is a new route on `apps/operator-web` (read-only, no auth required on internal network).

### Query Parameters

| Param | Type | Description |
|---|---|---|
| `capper` | string | Display name from `cappers.display_name` or `metadata.capper` — URL-encoded |
| `last` | integer | Trailing N days; default 30 |
| `sport` | string | Optional sport filter |

### Response Shape

```typescript
interface CapperStatsResponse {
  scope: 'capper' | 'server';
  capper: string | null;           // null when scope = 'server'
  window: number;                  // days
  sport: string | null;
  picks: number;                   // total settled in window
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;          // null if 0 picks
  roiPct: number | null;           // flat-bet ROI %
  avgClvPct: number | null;        // avg CLV % across picks with CLV data
  beatsLine: number | null;        // % of picks beating closing line
  picksWithClv: number;            // denominator for CLV stats
  lastFive: Array<'W' | 'L' | 'P'>; // trailing 5 settled results, oldest first
}
```

### Data Sources

The endpoint queries `settlement_records` joined through `picks` and `submissions`:

```sql
-- Capper identity chain:
settlement_records.pick_id
  → picks.submission_id
  → submissions.submitted_by            -- or submissions.metadata->>'capper'
  → cappers.display_name

-- CLV:
settlement_records.payload->>'clvRaw'
settlement_records.payload->>'beatsClosingLine'

-- Result:
settlement_records.result              -- 'win' | 'loss' | 'push'

-- Sport filter:
picks.sport

-- Window filter:
settlement_records.created_at > now() - interval '<N> days'
```

No new tables. No new computed columns. All math is in the endpoint handler.

---

## Capper Identity Resolution

Discord picks store capper identity in two places:

1. `submissions.submitted_by` — Discord display name at submission time (string)
2. `submissions.metadata.capper` — same value, redundant copy in metadata

`/stats capper:@user` resolves via Discord `interaction.options.getUser('capper').displayName`, then matches against `submissions.submitted_by` (case-insensitive). If no exact match, the bot returns a disambiguation error with the closest match or prompts the user to check the spelling.

`cappers` table (`cappers.display_name`) is the authoritative display layer. If a capper entry exists, use its display name in the embed header; otherwise fall back to the raw `submitted_by` string.

---

## Discord Embed Format

```
┌─────────────────────────────────────────────────────────────┐
│ 📊  @CapperName — Last 30 Days (NBA)                        │
├─────────────────────────────────────────────────────────────┤
│  Record      23-11-2                                        │
│  Win Rate    67.6%                                          │
│  ROI         +8.3%                                          │
│  Avg CLV%    +2.1%  (21 picks with line data)               │
│  Beats Line  71%                                            │
├─────────────────────────────────────────────────────────────┤
│  Last 5      W  W  L  W  W                                  │
└─────────────────────────────────────────────────────────────┘
  Settled picks only · 36 total · /pick to add a new pick
```

### Embed Rules

- Color: green if `winRate >= 0.55`; yellow if `0.45 ≤ winRate < 0.55`; red if `winRate < 0.45`; gray if `picks < 10` (insufficient sample)
- Footer: "Settled picks only · N total · /pick to add a new pick"
- If `picks === 0` in the window: single-line "No settled picks in this window."
- If `picks < 5`: render record and win rate only; omit CLV fields with note "Insufficient sample for CLV stats."
- CLV fields are omitted entirely if `picksWithClv === 0`

---

## Access Control

`/stats` is **public within the server** — any member can view stats for any capper or the server aggregate. No role gate. This is intentional: stats are a social surface that drives engagement.

The role gate from `/pick` (`requiredRoles: [capperRoleId]`) does NOT apply here.

---

## Out of Scope (This Spec)

| Item | Reason |
|---|---|
| Leaderboard (`/leaderboard`) | Separate spec; different display surface |
| Historical charts / graphs | No charting library in scope |
| Per-pick breakdown | Too verbose for Discord embed; use operator web for drilldown |
| Live / in-progress picks | `stats` surface = settled only |
| DM delivery of stats | DM routing is blocked (no contract) |
| Write operations of any kind | Read-only surface |
| Pagination | Not needed for the default embed |

---

## Implementation Scope (When Authorized)

When a T2 contract is ratified, the implementation lane is:

| File | Change |
|---|---|
| `apps/discord-bot/src/commands/stats.ts` | New slash command; calls operator-web stats endpoint |
| `apps/discord-bot/src/command-registry.ts` | Register `/stats` |
| `apps/operator-web/src/server.ts` | New `GET /api/operator/stats` route |
| `apps/operator-web/src/server.test.ts` | ≥6 new tests: zero picks, <5 picks, CLV present/absent, capper scope, server scope |
| `apps/discord-bot/src/discord-bot-foundation.test.ts` | ≥2 new tests: embed renders, zero-picks path |

**No migration.** No schema changes. No settlement path changes. Reads `settlement_records` and `picks` via existing repository interfaces.

---

## Unlock Conditions

Before a T2 contract for `/stats` can be ratified:

1. **T1 Automated Grading is CLOSED** — `settlement_records.result` must be populated by the grading service; `/stats` over empty results is meaningless
2. **`GET /api/operator/stats` endpoint is designed and reviewed** — endpoint must be specced in the contract before bot code references it
3. **Capper identity resolution is confirmed** — verify `submissions.submitted_by` is reliably populated by `/pick` command in production

---

## References

- `docs/05_operations/T1_AUTOMATED_GRADING_CONTRACT.md` — upstream dependency
- `docs/03_product/DISCORD_BOT_FOUNDATION_SPEC.md` — bot architecture, role guard pattern
- `apps/operator-web/src/server.ts` — existing snapshot/recap endpoint patterns to mirror
- `packages/db/src/repositories.ts` — `SettlementRepository`, `PickRepository` interfaces
- `apps/discord-bot/src/commands/pick.ts` — capper identity storage pattern (`submitted_by`, `metadata.capper`)
