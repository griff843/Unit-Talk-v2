# UTV2-59 — T3 /pick Guild Deployment Verification

**Status:** RATIFIED
**Lane:** `lane:augment` (T3 ops verification)
**Tier:** T3
**Milestone:** M10
**Ratified:** 2026-03-27
**Authority:** Claude lane — M10 contract authoring session 2026-03-27

---

## Problem Statement

UTV2-53 added the `/pick` slash command to the codebase (merged PR #29, 2026-03-27). The `deploy-commands` script registers slash commands with the Discord guild via the Discord API. It has not been re-run since UTV2-53 merged — the `/pick` command exists in code but is not registered in the guild. Cappers cannot invoke `/pick` from Discord until it is deployed.

**Current state:** `/pick` command handler exists in `apps/discord-bot/src/commands/pick.ts` and is exported by `loadCommandRegistry()`. The Discord guild does not yet have `/pick` in its application command list. `UTV2-47` fixed the `APPLICATION_ID` mismatch — `deploy-commands` should now exit cleanly.

**Secondary concern:** Confirm that `/stats`, `/leaderboard`, and `/help` are still registered after the re-deploy (deploy-commands replaces the full guild command set).

---

## Scope

This is an **ops verification task only**. No runtime code changes. One deliverable: confirm `/pick` is live in the Discord guild slash command list.

### Steps

1. Ensure `local.env` has the correct `DISCORD_CLIENT_ID` (set during UTV2-47)
2. Run: `pnpm --filter @unit-talk/discord-bot deploy-commands`
3. Confirm: exit 0, no `DiscordAPIError`, command list logged to stdout includes `/pick`
4. In Discord: open the guild, type `/` — confirm `/pick`, `/stats`, `/leaderboard`, `/help` all appear
5. If `DiscordAPIError[20012]` appears: `DISCORD_CLIENT_ID` in `local.env` is still wrong — re-check the Discord Developer Portal (Applications → select the app owning the bot token → copy Application ID)

### If CLIENT_ID is correct but deploy fails

Check for rate limiting (`DiscordAPIError[429]`). Wait 60 seconds and retry. Do not modify source files.

---

## Acceptance Criteria

- [ ] AC-1: `pnpm --filter @unit-talk/discord-bot deploy-commands` exits 0
- [ ] AC-2: No `DiscordAPIError[20012]` or other `DiscordAPIError` in stdout/stderr
- [ ] AC-3: `/pick` command visible in Discord guild slash command list (screenshot or bot ephemeral response on `/pick` invocation confirms)
- [ ] AC-4: `/stats`, `/leaderboard`, `/help` also confirmed still registered in guild after deploy

---

## Constraints

- No changes to any `src/` files — this is an ops task, not an implementation task
- `local.env` is gitignored — credential changes do not land in git
- Permitted git-tracked change: `.env.example` comment/placeholder update if the example is misleading (e.g. wrong placeholder format for `DISCORD_CLIENT_ID`)
- Do not touch `apps/discord-bot/src/**`, `apps/api/**`, or any other runtime code
- Do not commit `local.env` under any circumstances

---

## Implementation Notes

The `deploy-commands` script is at `apps/discord-bot/src/deploy-commands.ts` (or similar). It uses `REST` from `discord.js` with `DISCORD_BOT_TOKEN` and `DISCORD_CLIENT_ID` from the environment to PUT the full application command set for the guild.

`loadCommandRegistry()` auto-discovers command handlers from `apps/discord-bot/src/commands/`. The `/pick` command in `pick.ts` exports `createDefaultCommand()` — confirm `loadCommandRegistry()` picks it up without manual wiring.

---

## Out of Scope

- Implementing any new commands
- Changing command schemas or option definitions
- Any database queries or API calls beyond the deploy-commands script

---

## Verification

Proof is a screenshot or description of the Discord guild slash command picker showing `/pick` alongside `/stats`, `/leaderboard`, and `/help`. Alternatively: invoke `/pick` in the guild and receive the ephemeral submission embed (success or validation error is acceptable — both confirm the command is registered).
