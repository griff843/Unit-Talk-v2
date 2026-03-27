# UTV2-58 — T2 Discord /recap Slash Command (Capper Self-Service)

**Status:** RATIFIED
**Lane:** `lane:codex` (T2 implementation)
**Tier:** T2
**Milestone:** M10
**Ratified:** 2026-03-27
**Blocked by:** UTV2-57 (shares recap embed builder)
**Authority:** Claude lane — M10 contract authoring session 2026-03-27

---

## Problem Statement

Cappers have no self-service way to review their recent settled picks from Discord. The `/stats` command shows aggregate performance, but not pick-level results. Cappers must use the operator dashboard or the API directly to see individual settled outcomes. A `/recap` command closes this gap with a private, capper-scoped pick list.

**Current state:** No `/recap` command exists. The `/stats` command aggregates across a trailing window but does not show individual pick results. The operator `/api/operator/stats` endpoint supports per-capper filtering but returns aggregates, not a pick list.

---

## Scope

One deliverable: a new `/recap` slash command in `apps/discord-bot/src/commands/recap.ts`.

### Command Definition

```
/recap [limit]
```

- `limit` — optional integer, min 1, max 20, default 10
- Response visibility: **ephemeral** (private to the calling user)

### Behavior

1. Resolve the capper name from `interaction.user` (same resolution logic as `/pick` — use `displayName` if available, fall back to `user.username`)
2. Call a new endpoint `GET /api/operator/capper-recap?submittedBy=<name>&limit=<n>` (or extend the existing stats endpoint — see Implementation Notes)
3. If picks returned: render ephemeral embed listing each settled pick — market, selection, result, P&L in units
4. If no settled picks: reply ephemeral `"No settled picks found."`

### Embed Format (success)

Title: `<CappperName> · Last <N> Settled Picks`

One field per pick (or a table-style description block):
- Market + selection
- Result: `W`, `L`, or `P`
- P&L: `+1.0u` / `-0.5u`

Maximum 20 entries — enforced by `limit` option cap.

### New API Endpoint

`GET /api/operator/capper-recap?submittedBy=<name>&limit=<n>`

- Returns `{ ok: true, data: { picks: Array<{ market, selection, result, profitLoss, settledAt }> } }`
- Queries `settlement_records` joined with `picks` where `picks.submitted_by = submittedBy`
- Orders by `settled_at DESC`, limits to `n` rows
- Returns empty array (not 404) when no results
- Permitted to add this route to `apps/api/src/server.ts`

---

## Acceptance Criteria

- [ ] AC-1: `/recap` command registered with optional `limit` option (default 10, max 20)
- [ ] AC-2: Returns ephemeral embed with capper's last N settled picks (market, selection, result, P&L)
- [ ] AC-3: Returns ephemeral `"No settled picks found."` when capper has no settled picks
- [ ] AC-4: `submittedBy` resolved from Discord interaction user (displayName preferred, username fallback) — not user-supplied text
- [ ] AC-5: `pnpm verify` exits 0; test count >= baseline + 2
- [ ] AC-6: At least 2 new tests: success with results (embed built correctly), empty state (no picks message)

---

## Constraints

- Response must be ephemeral (`responseVisibility: 'private'`) — pick history is capper-private
- `submittedBy` must be resolved from the Discord interaction user — do not expose a free-text capper lookup option
- Use the recap embed builder from UTV2-57 (`apps/discord-bot/src/embeds/recap-embed.ts`) where applicable; do not duplicate embed logic
- Permitted files: `apps/discord-bot/src/commands/recap.ts` (new), `apps/discord-bot/src/discord-bot-foundation.test.ts`, `apps/api/src/server.ts` (new route), `apps/api/src/server.test.ts`
- Do NOT touch: `apps/operator-web`, `apps/smart-form`, `apps/ingestor`, `apps/worker`
- Do not add a new write surface — this is read-only

---

## Implementation Notes

```typescript
// recap.ts — follows the same pattern as stats.ts and pick.ts
export function createRecapCommand(apiClient: ApiClient): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('recap')
      .setDescription("Show your last N settled picks")
      .addIntegerOption((option) =>
        option
          .setName('limit')
          .setDescription('Number of picks to show (1–20, default 10)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(20),
      ),
    responseVisibility: 'private',
    async execute(interaction: ChatInputCommandInteraction): Promise<void> { ... },
  };
}
```

The `GET /api/operator/capper-recap` endpoint is preferred over extending `/api/operator/stats` to avoid coupling the aggregate stats shape with a pick-list shape. If `DatabaseSettlementRepository` does not already expose a `findBySubmittedBy` method, add it to the repository interface and both implementations before wiring the route.

---

## Out of Scope

- Server-wide pick list (no admin override — capper-scoped only)
- Sport or date filtering (limit only in V1)
- Paginated results beyond the 20-pick cap
- Public (non-ephemeral) recap display

---

## Verification

After implementation, run `/recap` as a Discord user with settled picks. Confirm:
- Embed is ephemeral (only visible to the calling user)
- Picks shown match `settlement_records` for that `submittedBy` username
- `limit` option respected — sending `limit=3` shows 3 picks
- User with no settled picks sees `"No settled picks found."` message
