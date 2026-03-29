# Discord Command Catalog

## Metadata

| Field | Value |
|-------|-------|
| Status | Ratified |
| Ratified | 2026-03-29 |
| Issue | UTV2-159 |
| Bot | `Unit Talk#9476` |
| Guild | `1284478946171293736` |
| Deployment | Guild-scoped (not global) |
| Commands registered | 9 (confirmed 2026-03-29) |

This document is the authoritative registry of deployed Discord slash commands for Unit Talk V2. It defines the purpose, access, visibility, and behavioral rules for each command.

**Rule:** A command is not considered live until it appears here and has been deployed via the guild deploy script. Commands not in this catalog should not be referenced as live in product or operational docs.

---

## Global Rules

### Fail-Closed Visibility

All commands default to **private** responses (ephemeral — visible only to the invoking user). A command must explicitly declare `responseVisibility: 'public'` to post a public embed. This is a runtime-enforced policy, not a per-invocation option for members.

### API Boundary

All commands read from `apps/api`. No command writes to the database directly. Commands are read-only surfaces unless they submit picks through the intake API.

### Role Guard

Commands may be gated by Discord member roles via the `RoleGuard` utility. The required role for each command is noted below.

### Error Handling

Commands must acknowledge within 3 seconds. If the API is unavailable or the command fails, the user receives a private error message. The bot never silently drops interactions.

---

## Live Commands

### `/pick` — Submit a Pick

| Field | Value |
|-------|-------|
| Status | LIVE |
| Access | Capper role required |
| Visibility | Private (confirmation to invoker) |
| Contract | `docs/05_operations/UTV2-59_PICK_GUILD_DEPLOY_CONTRACT.md` |

Submits a pick through the canonical API intake path. The pick enters the submission pipeline at `POST /api/submissions` and is subject to all promotion evaluation, lifecycle, and distribution rules.

This command is the Discord-native entry point to the same pipeline as the Smart Form. The source field is set to `'discord-bot'`.

---

### `/stats` — Capper Performance View

| Field | Value |
|-------|-------|
| Status | LIVE |
| Access | Any member (read-only) |
| Visibility | Private (ephemeral) |
| Contract | `docs/05_operations/T2_DISCORD_STATS_CONTRACT.md` |

Displays pick performance stats for a tagged capper over a configurable time window.

Fields displayed: total picks, win/loss/push record, win rate, flat-bet ROI, average CLV%.

CLV% only populates for picks that have a closing line recorded in `settlement_records`. Picks without closing lines contribute to win/loss but not CLV%.

Usage: `/stats @capper` or `/stats @capper window:30d`

---

### `/leaderboard` — Ranked Capper Leaderboard

| Field | Value |
|-------|-------|
| Status | LIVE |
| Access | Any member (read-only) |
| Visibility | Public |
| Contract | `docs/05_operations/T2_DISCORD_LEADERBOARD_CONTRACT.md` |

Displays a ranked leaderboard of cappers by performance metrics (win rate, ROI, CLV%). The leaderboard ranks only cappers with a minimum number of settled picks to avoid small-sample noise.

This is one of the only commands with public visibility — the leaderboard embed is visible to all channel members when invoked.

---

### `/help` — Help Information

| Field | Value |
|-------|-------|
| Status | LIVE |
| Access | Any member |
| Visibility | Private (ephemeral) |

Displays a help embed explaining available commands and how to use the bot. Content is static and maintained in the command module.

---

### `/recap` — Capper Self-Service Settled Picks

| Field | Value |
|-------|-------|
| Status | LIVE |
| Access | Capper role (self-service) or any member (for tagged capper) |
| Visibility | Private (ephemeral) |
| Contract | `docs/05_operations/UTV2-58_RECAP_COMMAND_CONTRACT.md` |

Displays recent settled picks for a capper, including CLV% and stake units. Designed for cappers to review their own recent results and for members who want a pick-level breakdown instead of the rolled stats from `/stats`.

Fields displayed per pick: sport, market, result, stake units, CLV% (if available).

---

### `/alerts-setup` — Alert Agent Status (Operator)

| Field | Value |
|-------|-------|
| Status | LIVE |
| Access | Operator role required |
| Visibility | Private (ephemeral) |
| Contract | `docs/05_operations/T1_ALERT_COMMANDS_CONTRACT.md` |

Displays current alert agent status: enabled/disabled, dry-run mode, minimum tier threshold, lookback window, and recent detection counts (notable, alert-worthy, notified). Operator-only surface — not visible to general members.

---

### `/heat-signal` — Recent Line Movement Signals

| Field | Value |
|-------|-------|
| Status | LIVE |
| Access | Tier-gated (per role guard configuration) |
| Visibility | Private (ephemeral) |

Shows recent notable line movement detections. Default: 5 most recent. Accepts `count` option (1–10). Each result shows detection classification and context.

---

### `/trial-status` — Current Access Tier View

| Field | Value |
|-------|-------|
| Status | LIVE |
| Access | Any member |
| Visibility | Private (ephemeral) |

Shows the invoking member's current access tier and what that tier includes. Designed for members to understand their current access level and what surfaces they can reach.

---

### `/upgrade` — Upgrade Path View

| Field | Value |
|-------|-------|
| Status | LIVE |
| Access | Any member |
| Visibility | Private (ephemeral) |

Shows the member's current tier and what higher tiers unlock. Conversion-oriented — surfaces the upgrade path without requiring a support interaction. Supports both access clarity and upgrade consideration.

---

## Deployment

Commands are deployed via the idempotent guild deploy script:

```bash
pnpm --filter @unit-talk/discord-bot deploy-commands
```

The script registers all commands in `apps/discord-bot/src/commands/` to the configured guild. Guild-scoped registration takes effect immediately (no Discord propagation delay). Global registration is not used.

After deploying new commands, confirm registration by checking guild command list and updating this catalog.
