# T2 Contract: Discord `/leaderboard` Command

> **Status:** RATIFIED
> **Tier:** T2 — additive; no new migration, no settlement path changes
> **Lane:** `lane:codex` (implementation), `lane:claude` (verification)
> **Issue:** UTV2-43
> **Predecessor:** UTV2-31 Discord `/stats` — CLOSED ✅ (`settlement_records`, `picks`, `submissions` join pattern established)
> **Ratified:** 2026-03-27

---

## 1. Scope

Implement the `/leaderboard` Discord slash command with a backing `GET /api/operator/leaderboard` endpoint.

- `/leaderboard [window] [sport] [limit]` — read-only public surface
- No role gate (public within server)
- No DB writes, no pick creation
- Settled picks only (`settlement_records.source = 'grading'`, result = win/loss/push)
- Ranks cappers by win rate (primary) then ROI (secondary)

---

## 2. File Scope

| File | Change |
|---|---|
| `apps/operator-web/src/server.ts` | Add `GET /api/operator/leaderboard` route |
| `apps/operator-web/src/server.test.ts` | ≥6 new tests (see §6) |
| `apps/discord-bot/src/commands/leaderboard.ts` | New slash command (NEW FILE) |
| `apps/discord-bot/src/command-registry.ts` | Register `/leaderboard` |
| `apps/discord-bot/src/discord-bot-foundation.test.ts` | ≥2 new tests |

No other files change. No new packages. No migrations. No schema changes.

---

## 3. API Endpoint

### 3.1 Route

```
GET /api/operator/leaderboard
```

On `apps/operator-web`. Read-only. No authentication required.

### 3.2 Query Parameters

| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `last` | integer | No | `30` | Must be one of: 7, 14, 30, 90. Other values → 400 |
| `sport` | string | No | all sports | Case-insensitive match to `picks.sport` |
| `limit` | integer | No | `10` | 1–25 inclusive. Out of range → clamped (not error) |
| `minPicks` | integer | No | `3` | Minimum settled picks to appear in rankings. Filters noise. |

### 3.3 Response Shape

```typescript
interface LeaderboardEntry {
  rank: number;
  capper: string;                 // submitted_by display name
  picks: number;                  // total settled picks in window
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;         // wins / (wins + losses); null if 0 decided picks
  roiPct: number | null;          // flat-bet ROI %; null if 0 decided picks
  avgClvPct: number | null;       // avg CLV % across picks with CLV data; null if none
  streak: number;                 // current streak (positive = wins, negative = losses, 0 = push/break)
}

interface LeaderboardResponse {
  window: number;
  sport: string | null;
  minPicks: number;
  entries: LeaderboardEntry[];
  observedAt: string;
}
```

HTTP 200 on success. HTTP 400 if `last` is not one of 7, 14, 30, 90.

### 3.4 Data Sources

Same join as `/stats`: `settlement_records → picks → submissions`. All math in handler.

```
settlement_records.pick_id → picks.submission_id → submissions.submitted_by (capper identity)
settlement_records.result                         (win / loss / push)
settlement_records.payload->>'clvRaw'             (CLV %)
picks.sport                                       (sport filter)
settlement_records.created_at > now() - N days   (window filter)
settlement_records.source = 'grading'             (graded records only)
```

### 3.5 Ranking Logic

1. Group settled picks by `submitted_by` (case-insensitive, trimmed)
2. Filter out cappers with fewer than `minPicks` settled picks
3. Sort by `winRate DESC`, then `roiPct DESC` (secondary tiebreaker)
4. Assign `rank` 1-N after sorting
5. Return top `limit` entries

**Cappers with 0 decided picks** (all pushes): `winRate = null`, sorted below all cappers with a decided record.

**Streak calculation:** Walk the last N settled results for the capper (sorted by `settled_at` desc), counting consecutive identical results from the most recent. Wins are positive, losses negative, push breaks streak and returns 0.

### 3.6 ROI Calculation

Same as `/stats`: flat-bet ROI = ((wins − losses) / (wins + losses)) × 100. Pushes excluded.

---

## 4. Discord Command

### 4.1 Signature

```
/leaderboard [window] [sport] [limit]
```

| Option | Type | Required | Choices | Default |
|---|---|---|---|---|
| `window` | Integer | No | 7, 14, 30, 90 | 30 |
| `sport` | String | No | — | all |
| `limit` | Integer | No | — | 10 |

### 4.2 Bot Behavior

1. Extract `window`, `sport`, `limit` from interaction options
2. Call `GET /api/operator/leaderboard?last=<window>&sport=<sport>&limit=<limit>`
3. Render embed per §4.3
4. Reply with embed (non-ephemeral — leaderboard is a public social surface)

If API call fails or non-200: reply with ephemeral "Leaderboard is temporarily unavailable."

### 4.3 Embed Format

**Title:** `🏆 Leaderboard — Last N Days` (or `🏆 Leaderboard — Last N Days (Sport)` if sport filtered)

**Description (if no entries):** "No cappers with ≥3 settled picks in this window."

**Fields (one per entry, up to 10):**

```
#1  CapperName          W–L–P  67.6%  +8.3% ROI  🔥5
#2  AnotherCapper       W–L–P  61.5%  +3.1% ROI  ❄️2
```

Format per entry: `#{rank}  {capper}  {wins}–{losses}–{pushes}  {winRate}%  {roiPct}% ROI  {streak_icon}{|streak|}`

**Streak icons:**
- `streak > 0`: 🔥 (win streak)
- `streak < 0`: 🧊 (loss streak)
- `streak = 0`: — (omit streak display)

**Footer:** `Min {minPicks} settled picks · {window}-day window · /stats @capper for details`

**Color:** Gold (#FFD700) always (leaderboard is celebratory, not health-coded).

---

## 5. Acceptance Criteria

- [ ] AC-1: `GET /api/operator/leaderboard` returns ranked entries for cappers with ≥ minPicks settled picks
- [ ] AC-2: Returns empty `entries: []` when no cappers meet minPicks threshold
- [ ] AC-3: `GET /api/operator/leaderboard?last=99` returns HTTP 400
- [ ] AC-4: `?sport=NBA` filters to NBA picks only
- [ ] AC-5: Ranking is by winRate DESC, roiPct DESC as tiebreaker
- [ ] AC-6: `streak` correctly counts consecutive most-recent same-result picks
- [ ] AC-7: `/leaderboard` command registered in guild (shows in Discord command list)
- [ ] AC-8: Embed renders correct entry count and format
- [ ] AC-9: No role gate — any server member can invoke `/leaderboard`
- [ ] AC-10: `pnpm verify` exits 0; ≥8 net-new tests; total ≥ 606 (598 baseline + ≥8 new)

---

## 6. Tests Required

### operator-web tests (≥6)

1. Returns ranked entries for 3 cappers with different win rates
2. Returns `entries: []` when all cappers below minPicks threshold
3. Returns HTTP 400 when `last` is not an allowed value
4. Sport filter: only returns picks matching sport param
5. Ranking: lower win-rate capper ranked below higher win-rate capper
6. Window filter: picks outside N-day window excluded from ranking

### discord-bot tests (≥2)

1. `/leaderboard` command is registered with correct options (window, sport, limit)
2. Leaderboard embed renders correct rank format for a 2-entry fixture

---

## 7. Proof Requirements

- [ ] `pnpm verify` exits 0; test count ≥ 606
- [ ] `GET /api/operator/leaderboard` returns at least 1 entry from live DB (requires graded picks in `settlement_records`)
- [ ] `/leaderboard` shows in Discord command list after `pnpm --filter @unit-talk/discord-bot deploy-commands`
- [ ] Embed renders in Discord with correct format

---

## 8. Out of Scope

- Per-pick breakdown in leaderboard
- Historical trend charts
- All-time leaderboard (beyond 90-day window)
- Capper profiles or detail pages
- Pagination (top 25 max)
- Unit-weighted ROI (flat-bet only in V1)
- Ties resolved by anything other than ROI

---

## 9. Dependency Chain

- UTV2-31 (Discord `/stats`) — **CLOSED** ✅ — establishes settlement data join pattern and stats infrastructure
- UTV2-32 (this contract DOC) — **RATIFIED** ✅
- UTV2-43 (implementation) — **READY** upon this contract ratification
