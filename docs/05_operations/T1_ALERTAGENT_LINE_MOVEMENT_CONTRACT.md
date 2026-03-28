# T1 AlertAgent Contract — Time-Aware Line Movement Detection + Signal Routing

**Status:** RATIFIED 2026-03-28
**Issue:** UTV2-112
**Lane:** claude (contract) → codex (implementation via UTV2-59)
**Tier:** T1 — touches live market data, Discord routing, and new DB tables
**Authority:** This document is the authoritative design specification for AlertAgent line movement detection. Implementation must not invent product behavior not defined here.

---

## 1. Purpose

Define the complete contract for detecting, classifying, persisting, and routing line movement signals in Unit Talk V2. This contract unblocks UTV2-59 (AlertAgent implementation) and any follow-on notification lanes.

The primary goal is to distinguish **real signal** from **routine drift** so that alerts inform capper decisions rather than produce noise.

---

## 2. Terminology

These terms have precise meanings throughout this contract and all downstream implementation.

| Term | Definition |
|------|-----------|
| **snapshot** | A single `provider_offers` row captured at a point in time via `snapshot_at`. |
| **detection** | The raw measurement: "line moved X units between snapshot A and snapshot B." A detection has no quality judgment. |
| **signal** | A classified detection that has passed the minimum movement threshold for its market type. Every signal has a tier. |
| **notification** | A signal that has passed anti-spam gates and has been formatted and sent to a downstream consumer channel. Not every signal becomes a notification. |
| **cooldown** | The minimum elapsed time before the same entity+market can produce another notification of the same tier. |
| **idempotency key** | A deterministic string that uniquely identifies one signal event. Used to deduplicate across retries and process restarts. |

The pipeline is strictly one-directional:
```
snapshots → detections → signals (classified) → notifications (gated)
```

A detection that does not reach the minimum threshold for its market type is discarded silently. Only signals are persisted.

---

## 3. Data Inputs

The AlertAgent reads exclusively from `provider_offers`. It does not read from `picks`, `distribution_outbox`, or any other table at detection time.

**Required columns (reference `packages/db/src/database.types.ts` for exact names):**
- `event_id` — links offer to game
- `participant_id` or equivalent market entity identifier
- `market_key` — normalized market key (e.g., `spread`, `total`, `moneyline`, `h2h`, `player_points`)
- `bookmaker_key` — source book identifier
- `line` — the numeric line value (points for spread/total/prop; implied probability or juice for moneyline)
- `snapshot_at` — timestamp of this snapshot (primary input to window detection)

The ingestor is the only writer of `provider_offers`. The AlertAgent is read-only against this table.

---

## 4. Evaluation Window Model

### 4.1 Window Definition

Detection compares a **current snapshot** against a **baseline snapshot** drawn from the same `(event_id, market_key, bookmaker_key)` tuple within a configurable lookback window.

```
baseline = earliest snapshot within [now - lookbackMinutes, now)
           for the same (event_id, market_key, bookmaker_key)
```

If no baseline exists within the window, no detection is produced.

**Default lookback window:** 60 minutes.

### 4.2 Why Earliest-in-Window, Not Most-Recent

The legacy approach compared the current line against the most recent prior snapshot. This misses accumulating moves that arrive in small steps:

```
T=0:  line = 4.5
T=10: line = 5.0   (0.5 pts — below threshold vs most-recent)
T=20: line = 5.5   (0.5 pts — below threshold vs most-recent)
T=30: line = 6.0   (0.5 pts — below threshold vs most-recent)
```

Using earliest-in-window:
- Delta = 6.0 − 4.5 = 1.5 pts over 30 min → notable threshold crossed

The window model is required to catch slow burns.

### 4.3 Velocity

Velocity supplements the magnitude check. It measures how fast the move is happening:

```
lineVelocity = |currentLine - baselineLine| / max(timeElapsedMinutes, 1)
```

Velocity is expressed in **units per minute**. High velocity at a sub-threshold magnitude can still produce a signal (see §5.3).

### 4.4 Multiple Books

Each `(event_id, market_key, bookmaker_key)` triple is evaluated independently. A move at one book does not automatically produce a signal for a different book offering the same market on the same event.

---

## 5. Movement Classification

### 5.1 Market Type Definitions

The following market types govern threshold selection:

| Market Type | Key Pattern Examples | Line Unit |
|-------------|---------------------|-----------|
| `spread` | `spread`, `run_line`, `puck_line`, `handicap` | points |
| `total` | `totals`, `over_under`, `game_ou` | points |
| `moneyline` | `h2h`, `moneyline`, `1x2` | juice (absolute American odds change) |
| `player_prop` | `player_*` | prop units (stat-specific) |

If market_key does not match any known pattern, classify as `player_prop` as a conservative default.

### 5.2 Threshold Matrix

Signals are assigned one of three tiers: **watch**, **notable**, or **alert-worthy**.

| Market Type | watch (min) | notable | alert-worthy |
|-------------|------------|---------|--------------|
| `spread` | ≥ 0.5 pts | ≥ 2.0 pts | ≥ 3.5 pts |
| `total` | ≥ 0.5 pts | ≥ 1.5 pts | ≥ 3.0 pts |
| `moneyline` | ≥ 5 juice | ≥ 10 juice | ≥ 20 juice |
| `player_prop` | ≥ 0.25 units | ≥ 0.5 units | ≥ 1.5 units |

*Juice* = absolute value of the American odds change (e.g., −110 → −130 = 20 juice). For two-sided markets, use the change in the side that moved more.

### 5.3 Velocity Override

Velocity can elevate a `notable` to `alert-worthy` even if the magnitude threshold is not met:

| Market Type | Velocity threshold for elevation |
|-------------|----------------------------------|
| `spread` | ≥ 0.5 pts in ≤ 15 min |
| `total` | ≥ 0.5 pts in ≤ 15 min |
| `moneyline` | ≥ 10 juice in ≤ 15 min |
| `player_prop` | ≥ 0.25 units in ≤ 15 min |

A `watch`-tier detection is **never** elevated to `alert-worthy` by velocity alone. It must first meet the `notable` magnitude threshold.

### 5.4 Direction

Direction is always recorded:
- `up` — line increased (e.g., spread grew, total went over, prop went up)
- `down` — line decreased

Direction does not affect tier classification but is required in the persisted record and any notification embed.

### 5.5 Discarding Sub-Watch Detections

Detections below the `watch` minimum threshold are discarded without persisting. They generate no DB row, no log entry, and no notification.

---

## 6. Anti-Noise Policy

### 6.1 Idempotency Key

The idempotency key uniquely identifies one signal event. It is computed deterministically from:

```
components = [
  event_id,
  market_key,
  bookmaker_key,
  signal_tier,                        // 'watch' | 'notable' | 'alert-worthy'
  floor(snapshot_at / 5min_bucket)    // 5-minute bucket
]
idempotency_key = sha256(components.join('|')).slice(0, 32)
```

Two evaluations that produce the same idempotency key are the same event. Only the first write is accepted (ON CONFLICT DO NOTHING on the `alert_detections` table).

### 6.2 Cooldown Windows

Cooldown governs **notification** only. A signal is always persisted to `alert_detections`. Only the notification step is gated by cooldown.

| Signal Tier | Cooldown window (same entity + market_key) |
|------------|---------------------------------------------|
| `watch` | No notification (never notified) |
| `notable` | 30 minutes |
| `alert-worthy` | 15 minutes |

Cooldown is tracked in the `alert_detections` table via `cooldown_expires_at`. To check cooldown:

```
SELECT id FROM alert_detections
WHERE event_id = $event_id
  AND market_key = $market_key
  AND bookmaker_key = $bookmaker_key
  AND tier = $tier
  AND notified = true
  AND cooldown_expires_at > now()
ORDER BY notified_at DESC
LIMIT 1
```

If a row is returned, suppress notification. Otherwise proceed.

**This is DB-backed, not in-memory.** The legacy cooldown manager used a local TTL cache that was lost on process restart. V2 must use DB-backed cooldown so state survives restarts and is observable to operators.

### 6.3 `watch` Signals

`watch` signals are persisted for history and operator visibility but are **never notified**. They exist to support future analytics (e.g., "how many moves preceded this big move?") and operator-surface queries.

---

## 7. Persistence Model

### 7.1 Table: `alert_detections`

A new table. Migration required before UTV2-59 can ship.

```sql
CREATE TABLE alert_detections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key     TEXT NOT NULL UNIQUE,
  event_id            UUID NOT NULL REFERENCES events(id),
  market_key          TEXT NOT NULL,
  bookmaker_key       TEXT NOT NULL,
  baseline_snapshot_at TIMESTAMPTZ NOT NULL,
  current_snapshot_at  TIMESTAMPTZ NOT NULL,
  old_line            NUMERIC NOT NULL,
  new_line            NUMERIC NOT NULL,
  line_change         NUMERIC NOT NULL,         -- signed
  line_change_abs     NUMERIC NOT NULL,         -- absolute value
  velocity            NUMERIC,                  -- units/minute; NULL if time_elapsed = 0
  time_elapsed_minutes NUMERIC NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  market_type         TEXT NOT NULL CHECK (market_type IN ('spread', 'total', 'moneyline', 'player_prop')),
  tier                TEXT NOT NULL CHECK (tier IN ('watch', 'notable', 'alert-worthy')),
  notified            BOOLEAN NOT NULL DEFAULT false,
  notified_at         TIMESTAMPTZ,
  notified_channels   TEXT[],                   -- e.g., ['discord:canary', 'discord:trader-insights']
  cooldown_expires_at TIMESTAMPTZ,              -- set when notified = true
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alert_detections_event_market_idx
  ON alert_detections (event_id, market_key, bookmaker_key, tier, notified_at DESC);

CREATE INDEX alert_detections_created_at_idx
  ON alert_detections (created_at DESC);

CREATE INDEX alert_detections_cooldown_idx
  ON alert_detections (event_id, market_key, bookmaker_key, tier, cooldown_expires_at)
  WHERE notified = true;
```

### 7.2 Immutability

`alert_detections` rows are **append-only**. The `notified` flag and `notified_at` / `notified_channels` / `cooldown_expires_at` columns may be updated once (on notification), but the detection data (`old_line`, `new_line`, `tier`, etc.) must never be mutated after insert.

No immutability trigger is required for this table (unlike `audit_log`), but a guard against re-classification of an existing detection should be enforced in application code.

### 7.3 metadata JSONB

Capture additional context that is useful for debugging but not required for detection logic:

```json
{
  "participant_name": "LeBron James",
  "sport": "NBA",
  "event_name": "Lakers vs Celtics",
  "game_date": "2026-04-01",
  "velocity_elevated": true
}
```

---

## 8. Downstream Consumer Routing

### 8.1 Routing Table

| Signal Tier | Notification Target | Condition |
|------------|---------------------|-----------|
| `watch` | None | Never notified |
| `notable` | `discord:canary` | Always (operator visibility lane) |
| `alert-worthy` | `discord:canary` + `discord:trader-insights` | `trader-insights` only after M13 board confirms channel is ready for alert traffic |

**`discord:best-bets` is not an alert routing target.** Best bets is for qualified pick delivery only.

`discord:exclusive-insights` and `discord:strategy-room` are not yet ratified for alert routing. Do not route to them in UTV2-59 or follow-on lanes without a separate contract.

### 8.2 Routing Decision Point

Routing decisions must be made at notification time, not at detection time. The detection pipeline should produce a fully-classified, persisted signal and pass it to a separate notification step. This preserves separation of concerns and makes notification independently testable.

### 8.3 Canary-First Rule

Consistent with all V2 channel activations, the first proof run for any new notification type must go through `discord:canary` before any real channel. The canary proof must succeed before real-channel routing is enabled.

### 8.4 Discord Embed Contract

Embeds for line movement notifications must include at minimum:

| Field | Content |
|-------|---------|
| Title | `📈 LINE MOVEMENT — [EVENT NAME]` |
| Description | `[MARKET_KEY]: [OLD_LINE] → [NEW_LINE] (+/−X.X pts)` |
| Fields | Direction, tier, velocity (if elevated), time elapsed, book |
| Color | `0xff9900` (amber) for `notable`; `0xff6600` (orange) for `alert-worthy` |
| Footer | Snapshot timestamp + `discord:canary` or channel name |

Exact embed field layout is implementation-defined by Codex. This contract defines the minimum required data.

---

## 9. Decomposition — UTV2-59 vs Follow-On

### 9.1 UTV2-59 Scope (detection layer only)

UTV2-59 is bounded to:

- [ ] DB migration: `alert_detections` table (or note if rolled into a broader migration)
- [ ] `AlertDetectionRepository` interface + `InMemoryAlertDetectionRepository` + `DatabaseAlertDetectionRepository` in `packages/db`
- [ ] `detectLineMovement(currentOffer, baselineOffer)` — pure function, returns `LineMovementDetection | null`
- [ ] `classifyMovement(detection, marketType)` → `AlertSignal` with tier
- [ ] `shouldNotify(signal, repo)` → boolean (cooldown check against DB)
- [ ] `runAlertDetectionPass(offerRepo, detectionRepo)` — orchestration function (reads recent offers, runs detection, persists signals)
- [ ] ≥ 8 net-new tests covering: detection produces correct tier, velocity elevation, cooldown suppression, idempotency key collision, below-watch discard
- [ ] `pnpm verify` exits 0

UTV2-59 **must not** include Discord delivery. No webhook calls. No embed building.

### 9.2 Follow-On Issues (not in UTV2-59)

| Issue | Scope |
|-------|-------|
| UTV2-59b (new) | Notification layer — embed building, Discord delivery, canary proof, cooldown write-back |
| UTV2-59c (new) | `/heat-signal` Discord bot command — queries `alert_detections` for recent `alert-worthy` signals |
| UTV2-65 | `/alerts-setup` and `/heat-signal` commands — depends on 59b+59c |

These issues should be created and linked to UTV2-59 before UTV2-59 is closed.

---

## 10. Configuration Surface

The AlertAgent must support runtime configuration without code changes. Minimum required env vars:

```
ALERT_AGENT_ENABLED=true|false       # Master kill switch
ALERT_LOOKBACK_MINUTES=60            # Default evaluation window
ALERT_DRY_RUN=true|false             # If true: persist but do not notify; log instead
ALERT_MIN_TIER=watch|notable|alert-worthy  # Floor tier to persist (default: watch)
```

Threshold values in §5.2 and cooldown windows in §6.2 are code constants in the initial implementation. They may be promoted to configuration in a future contract if sport-specific tuning is needed.

---

## 11. Proof Requirements (for UTV2-59 implementation review)

When UTV2-59 opens for T1 review, the proof must demonstrate:

1. **Detection correct:** given two `provider_offers` rows with a known delta, `detectLineMovement` produces a detection with correct `line_change`, `velocity`, `direction`, and `market_type`
2. **Tier correct:** classification matches the threshold matrix for each market type (spread, total, moneyline, player_prop)
3. **Velocity elevation:** a `notable`-magnitude signal with qualifying velocity is classified as `alert-worthy`
4. **Below-watch discard:** a delta below the `watch` threshold produces `null`
5. **Idempotency:** two identical evaluations produce the same `idempotency_key`; second insert is a no-op
6. **Cooldown suppression:** `shouldNotify` returns false when a matching notified row exists with `cooldown_expires_at > now()`
7. **DB rows exist:** after `runAlertDetectionPass`, `alert_detections` contains correct rows
8. **`pnpm verify` exits 0**

---

## 12. Out of Scope (this contract)

- Hedge detection (separate future contract required)
- Steam move detection (separate future contract required)
- Injury alerts (out of V2 scope until player data feed is live)
- Multi-book consensus signal computation
- LLM-generated advice or commentary (not required for alerting)
- Real-time streaming / WebSocket delivery
- Per-capper alert preferences / subscription management
- Redis or distributed cooldown (DB-backed cooldown is sufficient for current scale)

---

## 13. Authority and Update Rules

This contract is the authority for:
- All implementation decisions in UTV2-59 and follow-on alert lanes
- Operator-surface display of `alert_detections` data
- Discord embed format for line movement notifications

**Update this contract if and only if:**
- A threshold value is tuned based on observed signal volume in production (log the rationale)
- A new market type is added
- The routing targets change

Do not update this contract to reflect implementation details. Runtime truth lives in the code. This contract defines intent and acceptance criteria.
