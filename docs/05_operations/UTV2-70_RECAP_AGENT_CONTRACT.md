# UTV2-70 — T2 RecapAgent: Scheduled Daily/Weekly Discord Recap Posts

**Status:** RATIFIED
**Lane:** `lane:codex` (T2 implementation)
**Tier:** T2
**Milestone:** M12
**Ratified:** 2026-03-27
**Authority:** Claude lane — M12 contract authoring session 2026-03-27
**Blocked by:** UTV2-68 (SGO results ingest) — recap is only meaningful once settlement data is auto-populated

---

## Problem

The system can compute settlement summaries via `GET /api/operator/recap` and has a fully designed embed spec (`docs/discord/discord_embed_system_spec.md` §4–7). Neither is wired to a schedule. Recap posts never happen automatically.

The schedule is ratified in `discord_embed_system_spec.md`:
- **Daily Recap:** 11:00 AM daily
- **Weekly Recap:** Monday at 5:00 PM
- **Monthly Recap:** First Monday of the month at 5:00 PM
- **Collision rule:** If monthly falls on same Monday as weekly, publish one combined `Weekly + Monthly Recap`

---

## Scope

**One new internal route + one new module. No new app. No new package.**

### 1. New internal route — `POST /api/recap/post`

Add to `apps/api/src/server.ts`:

```
POST /api/recap/post
Body: { period: 'daily' | 'weekly' | 'monthly', channel?: string }
```

- `period` determines the lookback window:
  - `daily` → yesterday (midnight to midnight UTC)
  - `weekly` → prior Monday through Sunday UTC
  - `monthly` → prior calendar month UTC
- `channel` optional override; defaults to `discord:best-bets`
- Calls `computeRecapSummary(period, repositories)` (see below)
- Builds Discord embed using `buildRecapEmbedData()` from `@unit-talk/discord-bot`
- Posts to Discord via bot token — same pattern as `postSettlementRecapIfPossible()` in `grading-service.ts`
- Returns `{ ok: true, postsCount: number, channel: string }` or `{ ok: false, reason: string }` if no settled picks in window
- No-ops silently if `DISCORD_BOT_TOKEN` absent

### 2. New function — `computeRecapSummary(period, repositories)`

New file: `apps/api/src/recap-service.ts`

```typescript
export type RecapPeriod = 'daily' | 'weekly' | 'monthly';

export interface RecapWindow {
  startsAt: string;   // ISO UTC
  endsAt: string;     // ISO UTC
  label: string;      // e.g. "Daily Recap — Mar 27", "Weekly Recap — Mar 24–30"
}

export function getRecapWindow(period: RecapPeriod, now?: Date): RecapWindow

export async function computeRecapSummary(
  period: RecapPeriod,
  repositories: Pick<RepositoryBundle, 'settlements' | 'picks'>,
  now?: Date,
): Promise<RecapSummary | null>   // null = no settled picks in window
```

- Queries `settlement_records` for rows where `created_at` falls in window
- Joins to picks for `stakeUnits`, `odds`, `selection`, `market`, `submittedBy`
- Computes: record (W-L-P), net units, ROI, top play (highest unit win)
- Returns `null` if no picks settled in the window (caller skips posting)

### 3. Collision detection

```typescript
export function detectRecapCollision(now: Date): 'weekly' | 'monthly' | 'combined' | 'none'
```

- Returns `'combined'` when it's the first Monday of the month
- Returns `'weekly'` on other Mondays at 5PM
- Returns `'monthly'` should never occur independently (always combined with weekly)
- Returns `'daily'` at 11AM any day
- Returns `'none'` otherwise

### 4. Scheduler trigger — `apps/api/src/recap-scheduler.ts`

Simple time-check function called from a 1-minute polling loop:

```typescript
export function shouldPostRecap(now: Date): RecapPeriod | 'combined' | null
```

- Returns the period to post if current UTC time matches a scheduled window (within 1-minute bucket)
- Used by the API process on startup to register a `setInterval(checkAndPost, 60_000)` loop
- Idempotent: tracks `lastPostedAt` per period in memory; won't re-post within the same day/week/month

**No Temporal. No Redis. No external scheduler.** The API process itself runs the 60-second check loop. If the API process restarts within a posting window, it re-checks and posts if not yet posted.

---

## Permitted Files

- `apps/api/src/recap-service.ts` — NEW: `computeRecapSummary`, `getRecapWindow`, `detectRecapCollision`
- `apps/api/src/recap-service.test.ts` — NEW: ≥6 tests
- `apps/api/src/recap-scheduler.ts` — NEW: `shouldPostRecap`, scheduler registration
- `apps/api/src/server.ts` — add `POST /api/recap/post` route
- `apps/api/src/server.test.ts` — add route tests
- `apps/api/src/index.ts` — register scheduler on startup

**Do NOT touch:** `apps/discord-bot`, `apps/worker`, `apps/operator-web`, `apps/ingestor`, `packages/*`

---

## Non-Goals

- No new Discord channel activation — posts to `discord:best-bets` by default; `discord:recaps` remains blocked until ratified
- No per-capper recaps — aggregate only; individual capper recaps use the existing `/recap` slash command
- No backfill — only the current window is computed; historical periods are not retroactively posted
- No external cron service — in-process 60-second loop only
- No persistence of "last posted" state across restarts — if API restarts, the loop re-evaluates and posts if window not yet posted today (idempotency via time-window check, not a DB flag)

---

## Acceptance Criteria

- [ ] AC-1: `getRecapWindow('daily', now)` returns correct UTC midnight-to-midnight window for yesterday
- [ ] AC-2: `getRecapWindow('weekly', now)` returns correct Mon–Sun window for prior week
- [ ] AC-3: `detectRecapCollision(now)` returns `'combined'` on first Monday of month, `'weekly'` on other Mondays
- [ ] AC-4: `computeRecapSummary` returns correct record, net units, ROI for a set of known settlements
- [ ] AC-5: `computeRecapSummary` returns `null` when no picks settled in window
- [ ] AC-6: `POST /api/recap/post` with `{ period: 'daily' }` returns `{ ok: true }` when picks exist; `{ ok: false, reason: 'no settled picks in window' }` when none
- [ ] AC-7: `POST /api/recap/post` no-ops and returns `{ ok: false, reason: 'DISCORD_BOT_TOKEN not configured' }` when token absent
- [ ] AC-8: Scheduler loop fires at correct UTC times (unit test with mocked clock)
- [ ] AC-9: `pnpm verify` exits 0; test count ≥ baseline + 6

---

## Constraints

- Post to `discord:best-bets` (channel `1288613037539852329`) by default — do not hardcode channel ID, resolve via `UNIT_TALK_DISCORD_TARGET_MAP`
- Embed content must use settled truth only — no ungraded picks, no projected values
- Recap skips silently if no settled picks exist in the window — no empty embed posted
- Do not surface `metadata.kellySizing` or `metadata.deviggingResult` in public recap embeds
