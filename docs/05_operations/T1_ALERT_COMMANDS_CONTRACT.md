# T1 Contract — UTV2-65: Alert Commands (/heat-signal, /alerts-setup)

**Status:** RATIFIED 2026-03-28
**Lane:** Codex (implementation) / Claude (contract)
**Tier:** T1
**Milestone:** M13
**Blocked by:** UTV2-59 DONE ✅, UTV2-114 DONE ✅
**Issue:** [UTV2-65](https://linear.app/unit-talk-v2/issue/UTV2-65)

---

## 1. Decision

Implement two Discord slash commands that surface live alert signal data from the alert agent:

- **`/heat-signal`** — read-only view of recent notable+ line movement detections. Available to all members.
- **`/alerts-setup`** — read-only view of current alert agent status and recent signal counts. Operator-only.

Both commands are **read-only**. No write surfaces on the bot. No per-user preferences. No new DB tables.

### Out of scope

- Per-user alert subscription preferences (no DB schema additions)
- Role-assignment from command interaction
- Alert configuration writes (enabling/disabling agent, changing min tier via command)
- DM delivery of alerts
- `/heat-signal` public posting (all replies are ephemeral)

---

## 2. New API Endpoints (apps/api)

Two new GET routes required. Both are read-only. No auth — internal API, same pattern as existing operator routes.

### 2.1 `GET /api/alerts/recent`

Returns the most recent `alert_detections` rows at or above `notable` tier, ordered by `current_snapshot_at DESC`.

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | `5` | Max rows returned. Capped at 10. |
| `minTier` | `notable` \| `alert-worthy` | `notable` | Minimum tier to include. |

**Response shape:**
```typescript
{
  detections: Array<{
    id: string;
    eventId: string;
    marketKey: string;
    bookmakerKey: string;
    marketType: 'spread' | 'total' | 'moneyline' | 'player_prop';
    direction: 'up' | 'down';
    tier: 'notable' | 'alert-worthy';
    oldLine: number;
    newLine: number;
    lineChange: number;
    lineChangeAbs: number;
    velocity: number | null;
    timeElapsedMinutes: number;
    currentSnapshotAt: string;   // ISO
    notified: boolean;
    cooldownExpiresAt: string | null;  // ISO or null
  }>;
  total: number;  // count returned (≤ limit)
}
```

**Empty state:** returns `{ detections: [], total: 0 }` — never errors for empty `alert_detections`.

**Handler location:** `apps/api/src/index.ts` — register alongside existing routes. Delegate to a pure `getRecentAlerts(repo, options)` function in a new `alert-query-service.ts`.

---

### 2.2 `GET /api/alerts/status`

Returns current alert agent configuration state and recent signal counts. Reads from env + `alert_detections` DB.

**No query params.**

**Response shape:**
```typescript
{
  enabled: boolean;         // ALERT_AGENT_ENABLED !== 'false'
  dryRun: boolean;          // ALERT_DRY_RUN !== 'false'
  minTier: string;          // ALERT_MIN_TIER env value
  lookbackMinutes: number;  // ALERT_LOOKBACK_MINUTES env value
  last1h: {
    notable: number;        // count of notable rows with current_snapshot_at > now-1h
    alertWorthy: number;    // count of alert-worthy rows same window
    notified: number;       // count of notified=true rows same window
  };
  lastDetectedAt: string | null;  // max(current_snapshot_at) across all rows, or null
}
```

**Handler location:** same pattern — `getAlertStatus(repo, env)` in `alert-query-service.ts`.

---

## 3. Discord Bot Commands (apps/discord-bot)

### 3.1 `/heat-signal`

**File:** `apps/discord-bot/src/commands/heat-signal.ts`

**Slash command definition:**
```
/heat-signal [count]
  count: integer, optional, min 1 max 10, default 5
```

**Role guard:** none — available to all members.

**Response:** ephemeral always (never public).

**Behavior:**
1. Call `apiClient.get('/api/alerts/recent?limit={count}&minTier=notable')`
2. If `detections.length === 0`: reply with embed saying "No notable line movements detected in the current window."
3. Otherwise: render embed (see §3.3).

**Error handling:** if API call fails, reply ephemerally: "Alert data temporarily unavailable."

---

### 3.2 `/alerts-setup`

**File:** `apps/discord-bot/src/commands/alerts-setup.ts`

**Slash command definition:**
```
/alerts-setup
  (no options — status view only)
```

**Role guard:** operator role required (`requireOperatorRole()` from existing `role-guard.ts`).

**Response:** ephemeral always.

**Behavior:**
1. Call `apiClient.get('/api/alerts/status')`
2. Render status embed (see §3.4).

**Error handling:** if API call fails, reply ephemerally: "Alert status temporarily unavailable."

---

### 3.3 `/heat-signal` Embed Spec

**Title:** `🔥 Heat Signal — Top ${count} Line Movements`
**Color:**
- All `alert-worthy` → `0xff6600` (orange)
- All `notable` → `0xff9900` (amber)
- Mixed → `0xff9900` (amber — use most common tier)

**Description:** one line per detection, formatted as:

```
[TIER_ICON] **[MARKET_KEY]** — [OLD] → [NEW] ([+/-X.X pts/juice]) · [BOOK] · [DIRECTION_ARROW]
```

Where:
- `TIER_ICON`: `⚡` for alert-worthy, `📈` for notable
- Change label: spread/total use `pts`, moneyline uses `juice`
- `DIRECTION_ARROW`: `⬆️` for up, `⬇️` for down
- Max 5 lines. Each line ≤ 120 chars.

**Footer:** `Last updated: [currentSnapshotAt of most recent row] · /heat-signal`

**Example:**
```
⚡ **spreads/nfl** — -3.0 → -5.5 (-2.5 pts) · fanduel · ⬇️
📈 **totals/nba** — 224.5 → 226.0 (+1.5 pts) · draftkings · ⬆️
```

---

### 3.4 `/alerts-setup` Embed Spec

**Title:** `⚙️ Alert Agent Status`
**Color:** `0x5865f2` (Discord blurple — neutral status)

**Fields:**

| Field name | Value |
|---|---|
| Agent | `✅ Enabled` or `⛔ Disabled` |
| Mode | `🔴 LIVE` or `🟡 DRY RUN` |
| Min Tier | `watch` / `notable` / `alert-worthy` |
| Lookback | `{N} minutes` |
| Last Hour — Notable | `{n} signals` |
| Last Hour — Alert-Worthy | `{n} signals` |
| Last Hour — Notified | `{n} sent` |
| Last Detection | `{ISO timestamp}` or `—` |

All fields inline: false.

---

## 4. api-client Extension (apps/discord-bot)

`apps/discord-bot/src/api-client.ts` already exposes typed GET calls. Add two typed methods:

```typescript
getRecentAlerts(limit?: number, minTier?: 'notable' | 'alert-worthy'): Promise<AlertsRecentResponse>
getAlertStatus(): Promise<AlertStatusResponse>
```

Where `AlertsRecentResponse` and `AlertStatusResponse` match the shapes in §2.1 and §2.2.

---

## 5. Registration

`apps/discord-bot/src/command-registry.ts` — add both commands to the registry.

`apps/discord-bot/src/commands/help.ts` — add both to `COMMAND_ENTRIES`:
```typescript
{ name: 'heat-signal', description: 'Show recent notable line movement signals' },
{ name: 'alerts-setup', description: 'Show alert agent status (operator only)' },
```

Guild deploy must be re-run after adding commands. Total registered commands: 7 (was 5).

---

## 6. Kill Switches

No new kill switches required. The agent-level `ALERT_AGENT_ENABLED=false` and `ALERT_DRY_RUN=true` are surfaced read-only via `/alerts-setup`. Commands themselves have no kill switch — they are read-only query surfaces.

---

## 7. Acceptance Criteria

- [ ] `GET /api/alerts/recent` returns correct shape; empty state returns `{ detections: [], total: 0 }`
- [ ] `GET /api/alerts/status` returns correct shape from env + DB counts
- [ ] `/heat-signal` renders embed for 1–10 detections; empty state message for zero
- [ ] `/heat-signal` response is always ephemeral
- [ ] `/alerts-setup` requires operator role; returns 403-equivalent embed for non-operators
- [ ] `/alerts-setup` response is always ephemeral
- [ ] Both commands registered in registry and listed in `/help`
- [ ] `pnpm verify` exits 0
- [ ] ≥ 4 net-new tests:
  - `getRecentAlerts` — empty result, populated result, limit clamped at 10
  - `getAlertStatus` — enabled/dry-run flags read from env correctly
  - Embed rendering for `/heat-signal` — mixed tiers, empty state
  - Role guard on `/alerts-setup` rejects non-operator

---

## 8. Out-of-Scope (explicit)

- Writing alert config from the bot (no `POST /api/alerts/config`)
- Per-user alert preferences table
- DM delivery
- Public (non-ephemeral) posting of `/heat-signal` results
- `/heat-signal` posting to a channel on a schedule (that is the alert agent's job)
- Any modifications to `alert-agent.ts`, `alert-agent-service.ts`, or `alert-notification-service.ts`
