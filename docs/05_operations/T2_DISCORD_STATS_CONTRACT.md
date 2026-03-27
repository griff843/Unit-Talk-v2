# T2 Discord `/stats` Command — Implementation Contract

> **Status:** RATIFIED
> **Tier:** T2 — additive; no new migration, no settlement path changes
> **Lane:** `lane:codex` (implementation), `lane:claude` (verification)
> **Issue:** UTV2-31
> **Authority:** `docs/03_product/DISCORD_STATS_COMMAND_SPEC.md` (product intent)
> **Predecessor:** UTV2-28 T1 Automated Grading (CLOSED — settlement_records now populated)
> **Ratified:** 2026-03-26

---

## 1. Scope

Implement the `/stats` Discord slash command with a backing `GET /api/operator/stats` endpoint.

- `/stats [capper] [window] [sport]` — read-only stats surface
- No role gate (public within server)
- No DB writes, no pick creation
- Settled picks only (`settlement_records.result` = win/loss/push)

## 2. File Scope

| File | Change |
|---|---|
| `apps/operator-web/src/server.ts` | Add `GET /api/operator/stats` route |
| `apps/operator-web/src/server.test.ts` | ≥6 new tests (see §6) |
| `apps/discord-bot/src/commands/stats.ts` | New slash command (NEW FILE) |
| `apps/discord-bot/src/command-registry.ts` | Register `/stats` |
| `apps/discord-bot/src/discord-bot-foundation.test.ts` | ≥2 new tests |

No other files change. No new packages. No migrations. No schema changes.

## 3. API Endpoint

### 3.1 Route

```
GET /api/operator/stats
```

On `apps/operator-web`. Read-only. No authentication required (internal network).

### 3.2 Query Parameters

| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `capper` | string | No | omit → server scope | URL-decoded, case-insensitive match |
| `last` | integer | No | `30` | Must be one of: 7, 14, 30, 90. Other values → 400 |
| `sport` | string | No | all sports | Case-insensitive match to `picks.sport` |

### 3.3 Response Shape

```typescript
interface CapperStatsResponse {
  scope: 'capper' | 'server';
  capper: string | null;          // null when scope = 'server'
  window: number;                 // days
  sport: string | null;
  picks: number;                  // total settled picks in window
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;         // wins / (wins + losses); null if 0 picks
  roiPct: number | null;          // flat-bet ROI %; null if 0 picks
  avgClvPct: number | null;       // avg CLV % across picks with CLV data; null if 0
  beatsLine: number | null;       // fraction (0–1) of picks beating closing line; null if no CLV
  picksWithClv: number;           // how many picks had CLV data
  lastFive: Array<'W' | 'L' | 'P'>; // trailing 5 settled results, oldest first
}
```

HTTP 200 on success. HTTP 400 if `last` is not one of 7, 14, 30, 90.

### 3.4 Data Sources

Query `settlement_records` joined through `picks` and `submissions`. All math is in the endpoint handler — no new DB functions.

```
settlement_records.pick_id → picks.submission_id → submissions.submitted_by (capper identity)
settlement_records.result                         (win / loss / push)
settlement_records.payload->>'clvRaw'             (CLV %)
settlement_records.payload->>'beatsClosingLine'   (boolean)
picks.sport                                       (sport filter)
settlement_records.created_at > now() - N days   (window filter)
settlement_records.source = 'grading'             (graded records only)
```

### 3.5 Capper Identity

Capper identity is matched via `submissions.submitted_by` (case-insensitive). Discord picks store the capper's display name at submission time. No `cappers` table lookup required for V1 — fall back to raw string match.

If `capper` param is provided but no matching `submitted_by` exists, return HTTP 200 with `picks: 0` (not 404).

### 3.6 ROI Calculation

Flat-bet ROI = ((wins × 1.0 - losses × 1.0) / (wins + losses)) × 100 when no unit sizes are tracked. If the system later tracks units, ROI is unit-weighted — defer to flat-bet for V1. Pushes excluded from both numerator and denominator.

## 4. Discord Command

### 4.1 Signature

```
/stats [capper] [window] [sport]
```

| Option | Type | Required | Choices | Default |
|---|---|---|---|---|
| `capper` | User | No | — | omit → server scope |
| `window` | Integer | No | 7, 14, 30, 90 | 30 |
| `sport` | String | No | — | all |

### 4.2 Bot Behavior

1. Extract `capper.displayName` (if provided), `window`, `sport` from interaction options
2. Call `GET /api/operator/stats?capper=<name>&last=<window>&sport=<sport>` (uses `OPERATOR_WEB_URL` env var)
3. Render embed per §4.3
4. Reply with embed (non-ephemeral — stats are a public social surface)

If API call fails (network error or non-200): reply with ephemeral "Stats are temporarily unavailable."

### 4.3 Embed Format

**Title:** `📊 @CapperName — Last N Days (Sport)` or `📊 Server Stats — Last N Days`

**Fields:**

| Field | Value | Omit if |
|---|---|---|
| Record | `W–L–P` | never |
| Win Rate | `67.6%` | `picks = 0` |
| ROI | `+8.3%` | `picks = 0` |
| Avg CLV% | `+2.1% (N picks with line data)` | `picksWithClv = 0` |
| Beats Line | `71%` | `picksWithClv = 0` |
| Last 5 | `W  W  L  W  W` | `picks = 0` |

**Sample size guards:**
- `picks = 0`: Single description "No settled picks in this window."
- `picks < 5`: Render Record and Win Rate only. Footer note: "Insufficient sample for CLV stats."
- `picks < 10`: Embed color = gray (regardless of win rate)

**Color logic** (when `picks >= 10`):
- Green: `winRate >= 0.55`
- Yellow: `0.45 ≤ winRate < 0.55`
- Red: `winRate < 0.45`

**Footer:** `Settled picks only · N total · /pick to add a new pick`

## 5. Acceptance Criteria

- [ ] AC-1: `GET /api/operator/stats` returns `CapperStatsResponse` for a capper with settled graded picks
- [ ] AC-2: `GET /api/operator/stats` returns `picks: 0` when no matching picks exist in window
- [ ] AC-3: `GET /api/operator/stats?last=99` returns HTTP 400
- [ ] AC-4: `GET /api/operator/stats?capper=X&sport=NBA` filters by sport correctly
- [ ] AC-5: When `picksWithClv = 0`, `avgClvPct` and `beatsLine` are null
- [ ] AC-6: `/stats` command registered in guild (shows in Discord command list)
- [ ] AC-7: `/stats` embed renders correct color (green/yellow/red/gray) based on sample size + win rate
- [ ] AC-8: `/stats` embed omits CLV fields when `picksWithClv = 0`
- [ ] AC-9: No role gate — any server member can invoke `/stats`
- [ ] AC-10: `pnpm verify` exits 0; ≥8 net-new tests wired into `pnpm test` (discord-bot tests added to `test:apps`; clv-service.test.ts and grading-service.test.ts must NOT be removed); total ≥ 590

## 6. Tests Required

### operator-web tests (≥6)

1. Returns win/loss/push counts and win rate for a capper with settled picks
2. Returns `picks: 0` and nulls when capper has no picks in window
3. Returns HTTP 400 when `last` is not an allowed value (7/14/30/90)
4. Sport filter: only returns picks matching sport param
5. CLV fields are null when no picks have CLV data in payload
6. Window filter: picks outside the N-day window are excluded

### discord-bot tests (≥2)

1. `/stats` command is registered in command registry (name + options present)
2. Stats embed renders with correct field layout for a non-zero result fixture

## 7. Proof Requirements

- [ ] `pnpm verify` exits 0; test count ≥ 590 (baseline 551 + 31 discord-bot foundation wired + ≥8 net-new)
- [ ] `GET /api/operator/stats` returns correct response for at least one capper with graded picks in live DB
- [ ] `/stats` shows in Discord command list after `pnpm --filter @unit-talk/discord-bot deploy-commands`
- [ ] Embed renders in Discord with correct color and CLV fields (or omission if no CLV data)

## 8. Out of Scope

- Leaderboard `/leaderboard` — separate spec
- Per-pick breakdown in embed
- Live/in-progress picks (settled only)
- DM delivery
- Historical charts
- Pagination
- Capper management (`cappers` table lookup) — raw `submitted_by` match for V1

## 9. Dependency Chain

- UTV2-28 (T1 Automated Grading) — **CLOSED** ✅ — `settlement_records.source = 'grading'` now live
- UTV2-32 (this contract) — **RATIFIED** ✅ — unlocks UTV2-31 implementation
- UTV2-31 (implementation) — **BLOCKED** — also requires this contract (now satisfied)

UTV2-31 may now open.
