# UTV2-57 — T2 Settlement-Triggered Discord Recap Embed

**Status:** RATIFIED
**Lane:** `lane:codex` (T2 implementation)
**Tier:** T2
**Milestone:** M10
**Ratified:** 2026-03-27
**Authority:** Claude lane — M10 contract authoring session 2026-03-27

---

## Problem Statement

After a pick is settled (grading run writes to `settlement_records`), there is no automatic notification in Discord. Cappers and community members have no in-channel signal that a result has posted. The settlement data — result, profit/loss, CLV — exists in the DB but never surfaces back to the channel where the pick was delivered.

**Current state:** Picks are delivered to Discord via the distribution worker, but settlement is silent. No recap embed is sent. Cappers must check the operator dashboard or query the API directly to see results.

---

## Scope

One deliverable: a settlement-triggered recap embed posted to the pick's original delivery channel at the end of `runGradingPass()`.

### Settlement Recap Trigger

At the end of `runGradingPass()` in `apps/api/src/grading-service.ts`, for each newly graded pick:

1. Look up the pick's original delivery channel from `distribution_receipts` (preferred) or `distribution_outbox` (fallback)
2. If no delivery target found: skip silently, log warning with pick ID and reason — do not throw
3. Build a recap embed using `apps/discord-bot/src/embeds/recap-embed.ts` (new file)
4. Post the embed to the resolved channel via the Discord REST API

**Embed content:**
- Pick market + selection
- Result: `Win`, `Loss`, or `Push`
- Profit/loss in units (e.g. `+1.0u` or `-0.5u`)
- CLV% if present in `settlement_records.payload.clvPercent` (display as `+3.8%`); `—` if absent
- Capper username (`submittedBy` from picks table)

**Channel resolution logic:**
- Query `distribution_receipts` for the pick_id — use `channel` field (populated since Migration 003)
- If no receipt row: query `distribution_outbox` for a `sent` row, use `target` to derive channel ID
- If neither: skip silently

**Source of truth for settlement data:** `settlement_records.payload` + `picks` table.

---

## Acceptance Criteria

- [ ] AC-1: After grading run, each newly settled pick triggers a Discord embed post to the pick's original delivery channel
- [ ] AC-2: Embed shows: market, selection, result (Win/Loss/Push), profit/loss units, CLV% (or `—` if absent), capper username
- [ ] AC-3: If pick has no delivery receipt/target: skip silently, log reason (pick ID + why skipped), do not throw
- [ ] AC-4: `pnpm verify` exits 0; test count >= baseline + 2
- [ ] AC-5: At least 2 new tests: embed built correctly for win with CLV, embed skipped when no receipt

---

## Constraints

- Do not change `settlement_records` schema — no migration
- Do not change `runGradingPass()` return type or existing callers
- Permitted files: `apps/api/src/grading-service.ts`, `apps/api/src/server.ts` (if new route needed for triggering), new `apps/discord-bot/src/embeds/recap-embed.ts`, `apps/api/src/server.test.ts` or `apps/api/src/grading-service.test.ts`
- Do NOT touch: `apps/worker`, `apps/operator-web`, `apps/smart-form`, `apps/ingestor`
- Recap embed builder must be a pure function (no side effects) — testable without Discord credentials
- Discord posting may be a no-op in test environments (check for `DISCORD_BOT_TOKEN` presence)

---

## Implementation Notes

```typescript
// recap-embed.ts — pure builder, no Discord client dependency
export interface RecapEmbedInput {
  market: string;
  selection: string;
  result: 'win' | 'loss' | 'push';
  stakeUnits: number;
  profitLoss: number;
  clvPercent: number | null;
  submittedBy: string;
}

export function buildRecapEmbed(input: RecapEmbedInput): EmbedBuilder { ... }
```

Channel resolution should use the `channel` field from `distribution_receipts` (added in Migration 003) which stores the raw channel ID string (e.g. `'discord:1296531122234327100'` or just the channel ID). Cross-reference `CLAUDE.md` Live Discord Targets table for channel ID mapping.

---

## Out of Scope

- Bulk recap of historical picks settled before this feature ships
- Recap for manually settled picks (source=`'feed'` blocked at service layer per Week 12)
- Retry logic for failed Discord post — log and skip
- New slash command for recap (see UTV2-58)

---

## Verification

After implementation, trigger a grading pass with a posted pick. Confirm:
- Discord embed appears in the pick's original delivery channel
- Embed fields match settlement data in `settlement_records`
- If grading a pick with no receipt: confirm no error thrown, warning logged
