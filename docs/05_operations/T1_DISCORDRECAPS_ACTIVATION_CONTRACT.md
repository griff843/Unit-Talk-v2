# T1 discord:recaps Activation Contract

**Status:** RATIFIED 2026-03-28
**Issue:** UTV2-113
**Lane:** claude (contract) → codex (activation via UTV2-90)
**Tier:** T1 — touches live Discord routing and channel target map
**Authority:** This document is the authoritative routing and proof specification for activating `discord:recaps` as a dedicated recap destination. UTV2-90 implementation must not invent routing behavior not defined here.

---

## 1. Activation Decision

**`discord:recaps` is APPROVED for activation** as the canonical recap destination, replacing the current default of `discord:best-bets`.

### Rationale

The recap scheduler and compute service are already live on main (`recap-service.ts`, `recap-scheduler.ts`, commit `4b5ccd7`). The current behavior silently defaults to `discord:best-bets` when no channel is specified, which is wrong:

- `discord:best-bets` is a selective execution board for qualified pick delivery. Recap posts are aggregate summaries, not picks.
- Posting recaps to `discord:best-bets` creates routing drift: users see mixed content, operators cannot distinguish pick delivery health from recap health.
- A dedicated `discord:recaps` surface gives observability (recap posts observable independently), cleaner operator triage, and correct product semantics.

### Not activated by this contract

This contract authorizes the routing change only. The following require separate contracts:
- Per-capper breakdown embeds (richer than current aggregate)
- Micro-recap (sub-daily polling) — assessed in §9
- CLV enrichment in recap embeds
- Tier/role gating on the recaps channel

---

## 2. Current State (as of 2026-03-28)

| Surface | State |
|---------|-------|
| `recap-service.ts` | Live — `computeRecapSummary`, `postRecapSummary`, `buildRecapEmbed` |
| `recap-scheduler.ts` | Live — 60s tick, in-process cron, structured error logging |
| Schedule | Daily 11:00 UTC; Weekly Mon 11:00 UTC; Monthly 1st 11:00 UTC; Combined on first Monday of month |
| Current channel | `discord:best-bets` (wrong — implicit default) |
| Target for activation | `discord:recaps` (not yet in target map) |
| In-memory idempotency | Live — keyed by `window.endsAt`; resets on process restart |

---

## 3. Channel Target Specification

### 3.1 Channel ID (required before UTV2-90 ships)

`discord:recaps` does not exist in `docs/05_operations/discord_routing.md` or `UNIT_TALK_DISCORD_TARGET_MAP`. The channel must be:

1. Created in the Discord guild (`1284478946171293736`) if not already present
2. Channel ID confirmed by the operator/PM
3. Added to `discord_routing.md` under Approved V2 Targets
4. Added to `UNIT_TALK_DISCORD_TARGET_MAP` in `local.env` / `.env.example`

**UTV2-90 is blocked from shipping until the channel ID is confirmed and recorded in `discord_routing.md`.**

### 3.2 Routing Change

The `postRecapSummary` function in `recap-service.ts` defaults to `discord:best-bets` when no channel is provided:

```typescript
const channel = options.channel?.trim() || 'discord:best-bets';
```

UTV2-90 must change this default to `discord:recaps`. The scheduler call at `checkAndPostRecaps` passes no explicit channel — it relies on this default. Changing the default is the minimal required code change.

Alternative: pass `channel: 'discord:recaps'` explicitly from the scheduler. Either approach is acceptable; explicit is preferred for clarity.

### 3.3 Canary-First Rule

Consistent with all V2 channel activations:

1. First proof run must post to `discord:canary` only
2. Canary proof must succeed before `discord:recaps` receives live posts
3. Canary proof is conducted by the claude lane (UTV2-113 proof gate, see §7)

---

## 4. Schedule Contract

The following schedule is ratified and must not change in UTV2-90:

| Period | Trigger | UTC Time | Notes |
|--------|---------|----------|-------|
| `daily` | Every day | 11:00 AM | Covers previous calendar day (UTC midnight to midnight) |
| `weekly` | Every Monday | 11:00 AM | Covers Mon–Sun of prior week; first Monday of month = combined |
| `monthly` | 1st of month | 11:00 AM | Covers prior full calendar month |
| `combined` | First Monday of month | 11:00 AM | Posts weekly then monthly in sequence; one idempotency mark each |

**Implementation truth:** `detectRecapTrigger` in `recap-scheduler.ts` governs trigger detection. Do not change schedule without updating this contract.

All window boundaries use UTC explicitly. `getRecapWindow` already uses `Date.UTC` throughout — this is correct and must be preserved.

---

## 5. Embed Contract

### 5.1 Required Fields (current — live on main)

| Field | Value |
|-------|-------|
| Title | `window.label` (e.g., `Daily Recap - Mar 28`) |
| Color | `0x2f855a` (green) if `netUnits >= 0`, else `0xc53030` (red) |
| Record | `{wins}-{losses}-{pushes}` |
| Net Units | Signed with `u` suffix (e.g., `+3.5u`) |
| ROI | Signed with `%` suffix (e.g., `+12.5%`) |
| Top Play | Selection, market, result, P/L, capper name |

### 5.2 Minimum Required for discord:recaps Activation

No new embed fields are required for UTV2-90. The existing `buildRecapEmbed` output is sufficient for the activation proof. Additional enrichment (CLV, per-capper breakdown) is explicitly out of scope for UTV2-90 and requires a follow-on contract.

### 5.3 Empty-Data Behavior

If no settled picks exist in the window: `computeRecapSummary` returns `null`, `postRecapSummary` returns `{ ok: false, reason: 'no settled picks in window' }`, the scheduler marks the period as posted (no retry), and no Discord post is made. This is correct behavior — do not change it.

---

## 6. Anti-Noise Policy

### 6.1 In-Memory Idempotency (current)

The scheduler uses `lastPostedAt: Partial<Record<RecapPeriod, string>>` keyed by `window.endsAt`. This prevents duplicate posts within a single process lifetime.

**Known limitation:** if the process restarts between 11:00:00 and 11:00:59 UTC (the single-minute posting window), a second post is possible. This is an accepted low-frequency risk for single-instance deployment. Multi-instance deployments require DB-backed idempotency — not required for UTV2-90.

### 6.2 Dry-Run Mode (new — required for UTV2-90)

UTV2-90 must add `RECAP_DRY_RUN` env var support:

```
RECAP_DRY_RUN=true|false   # If true: compute summary but do not post to Discord; log result only
```

When `RECAP_DRY_RUN=true`:
- `computeRecapSummary` runs normally
- Discord post is skipped
- Log output: `{ service: 'recap-scheduler', event: 'tick.dry_run', period, summary }`
- Idempotency mark is NOT set (allows a real post when dry-run is disabled)

Dry-run mode is required for safe initial deployment verification without posting to live channels.

---

## 7. Proof Gate (claude lane — UTV2-113)

Before UTV2-90 merges, the claude lane must run and record a canary proof:

### 7.1 Required Proof Steps

1. **`RECAP_DRY_RUN=true` test**: confirm recap compute succeeds against live DB (or returns `no settled picks` gracefully)
2. **Canary post**: manually trigger `postRecapSummary` with `channel: 'discord:canary'` — verify embed appears in canary channel
3. **Channel ID confirmed**: `discord:recaps` channel ID is in `discord_routing.md`
4. **Target map confirmed**: `UNIT_TALK_DISCORD_TARGET_MAP` includes `discord:recaps` entry
5. **`pnpm verify` exits 0**: after UTV2-90 changes

### 7.2 Proof Artifact

Proof is recorded in a file at `out/sprints/UTV2-113/` following the standard proof template. The proof must show:
- Canary embed screenshot or Discord message ID
- Dry-run log output (or confirmation of graceful empty-data no-op)
- `discord_routing.md` updated with channel ID
- Gate confirmation: `pnpm verify` exit 0

### 7.3 Post-Proof Authorization

Once proof is recorded and linked on UTV2-113 in Linear:
- UTV2-90 moves from Backlog → Ready
- Codex may begin implementation
- `discord:recaps` routing is authorized for live posts

---

## 8. Rollback Expectations

### 8.1 Rollback Trigger Conditions

Roll back `discord:recaps` routing if:
- Recap posts appear in wrong channel (routing regression)
- Duplicate posts in a single window (idempotency failure)
- Volume is excessive — more than expected posts per day
- Any post contains incorrect summary data (wrong window, wrong counts)

### 8.2 Rollback Procedure

1. Set `RECAP_DRY_RUN=true` immediately (zero downtime, no deploy required) to stop Discord posts
2. Investigate root cause
3. If channel routing is wrong: revert `discord:recaps` → `discord:best-bets` default until fixed
4. Do not delete the `discord:recaps` channel or remove from target map — preserve for re-activation

### 8.3 Rollback Is Not a Failure

The recap scheduler is a background process. Rolling back to dry-run mode has zero user-facing impact. No pick delivery, grading, or settlement is affected.

---

## 9. Micro-Recap — Not In Scope

The legacy system had a micro-recap loop (1–5 minute polling) that posted settlement recaps immediately after individual games resolved. V2 already has per-pick recap via `postSettlementRecapIfPossible()` in `grading-service.ts` (UTV2-57), which fires after each newly graded pick and posts to the pick's original delivery channel.

**Decision:** The micro-recap concept from legacy is already served by the per-pick settlement recap in V2. A separate scheduled micro-recap is not needed and is out of scope for UTV2-90. If a dedicated rapid-fire recap surface is wanted in future, it requires a separate contract.

---

## 10. UTV2-90 Implementation Scope

UTV2-90 (Codex T2) is authorized to implement the following — no more:

- [ ] Confirm `discord:recaps` channel ID with PM; add to `discord_routing.md` and `UNIT_TALK_DISCORD_TARGET_MAP`
- [ ] Change default channel in `postRecapSummary` from `discord:best-bets` to `discord:recaps` (or pass explicitly from scheduler)
- [ ] Add `RECAP_DRY_RUN` env var support (§6.2)
- [ ] Update `.env.example` to include `DISCORD_RECAPS_CHANNEL_ID` note and `RECAP_DRY_RUN=false`
- [ ] ≥ 3 net-new tests: dry-run mode skips Discord post, correct channel resolved, empty-data no-op preserved
- [ ] `pnpm verify` exits 0

UTV2-90 must NOT:
- Change recap schedule timing
- Add new embed fields (CLV, per-capper breakdown, streaks)
- Change `computeRecapSummary` logic
- Add DB-backed idempotency (out of scope — accepted risk noted in §6.1)
- Widen scope to other Discord channels

---

## 11. Out of Scope (this contract)

- Per-capper breakdown embeds
- CLV% enrichment in recap embeds
- Streak detection and highlights
- Parlay grouping / breakdowns
- Micro-recap / near-real-time recap posting (covered by per-pick settlement recap — §9)
- Tier/role gating on `discord:recaps` channel
- DB-backed idempotency for multi-instance deployments
- Any other Discord channel routing changes

---

## 12. Authority and Update Rules

This contract is the authority for:
- All routing decisions in UTV2-90
- The embed minimum field set for recap activation
- The dry-run mode specification
- Proof gate requirements before `discord:recaps` goes live

**Update this contract if and only if:**
- The channel ID changes
- The schedule changes
- The rollback policy changes
- A new embed requirement is ratified for the activation scope

Do not update this contract to reflect implementation details. Runtime truth lives in the code.
