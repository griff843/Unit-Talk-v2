# Discord Sandbox QA Setup

## Purpose

Unit Talk V2 needs a dedicated Discord QA environment so Discord-path validation does not depend on production canary channels. Production canary channels are not a safe primary QA surface because they share real routing, real operators, and real guild state. A sandbox guild lets the team verify role-gated visibility, slash-command behavior, and pick-delivery UX without mutating the production server or exposing production credentials.

This runbook covers repo-side setup for a separate sandbox guild named `Unit Talk V2 Sandbox` and a separate Discord application named `Unit Talk QA Bot`.

## Required Boundaries

- No production server mutation.
- No production token exposure.
- No bot database access.
- No Supabase credentials in the Discord bot or QA bot.
- No direct Discord bot access to `@unit-talk/db`.
- No bypass of `apps/api`; Discord remains an `apps/api` consumer only.

## Recommended Sandbox Guild Layout

Sandbox guild name:

- `Unit Talk V2 Sandbox`

Recommended channels:

- `#qa-bot-log`
- `#qa-access-check`
- `#qa-pick-delivery`
- `#free-picks`
- `#vip-picks`
- `#vip-plus-picks`
- `#admin-ops`
- `#recap`

Recommended roles:

- `QA_Admin`
- `QA_Operator`
- `QA_Capper`
- `QA_VIP`
- `QA_VIPPlus`
- `QA_Free`
- `QA_NoAccess`

## Permission Matrix

The matrix below is the recommended visibility baseline for sandbox QA. It is intentionally simple and environment-specific; do not hardcode these role IDs in repo code.

| Channel | QA_Admin | QA_Operator | QA_Capper | QA_VIP | QA_VIPPlus | QA_Free | QA_NoAccess |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `#qa-bot-log` | View | View | Hide | Hide | Hide | Hide | Hide |
| `#qa-access-check` | View | View | View | View | View | View | Hide |
| `#qa-pick-delivery` | View | View | View | View | View | Hide | Hide |
| `#free-picks` | View | View | View | View | View | View | Hide |
| `#vip-picks` | View | View | View | View | View | Hide | Hide |
| `#vip-plus-picks` | View | View | View | Hide | View | Hide | Hide |
| `#admin-ops` | View | View | Hide | Hide | Hide | Hide | Hide |
| `#recap` | View | View | View | View | View | View | Hide |

Recommended interpretation:

- `QA_Admin` can verify all channels and final permission state.
- `QA_Operator` can validate bot/admin workflows without owning the full guild.
- `QA_Capper` can validate capper-facing command access without member-tier leakage.
- `QA_VIP` can see `#free-picks` and `#vip-picks`, but not `#vip-plus-picks`.
- `QA_VIPPlus` can see all member delivery channels.
- `QA_Free` can see only public/free surfaces.
- `QA_NoAccess` is the negative-control persona for hidden-channel assertions.

## Current Sandbox Snapshot

Current non-production sandbox implementation:

- guild host: `griff843's server`
- guild ID: `1195598141026742343`
- role/channel IDs: recorded in the ignored local file `discord-qa-role-channel-map.local.json`

This current host guild is acceptable for QA because it is non-production and isolated from the live Unit Talk production server. Do not treat it as production infrastructure.

## Manual Discord Developer Portal Checklist

Create and configure a separate Discord application manually in the Discord Developer Portal:

1. Create a new application named `Unit Talk QA Bot`.
2. Add a bot user for that application.
3. Generate and store a bot token only for the QA app.
4. Invite the QA bot to the sandbox guild only.
5. Use guild-scoped slash commands only.
6. Do not reuse the production bot token.
7. Do not invite the QA bot into the production guild.
8. Keep QA credentials out of committed files and out of screenshots shared in docs.

## QA Environment Variable Checklist

Add sandbox-only values in local, secret-bearing env files or secret stores. Do not commit real values.

- `DISCORD_QA_BOT_TOKEN`
- `DISCORD_QA_CLIENT_ID`
- `DISCORD_QA_GUILD_ID`
- `DISCORD_QA_ROLE_MAP`
- `DISCORD_QA_CHANNEL_MAP`
- `UNIT_TALK_QA_API_URL`

Recommended usage:

- `DISCORD_QA_BOT_TOKEN`: bot token for `Unit Talk QA Bot`.
- `DISCORD_QA_CLIENT_ID`: application ID for the QA Discord app.
- `DISCORD_QA_GUILD_ID`: guild ID for `griff843's server` in the current sandbox implementation.
- `DISCORD_QA_ROLE_MAP`: local path to the finalized role/channel map JSON.
- `DISCORD_QA_CHANNEL_MAP`: local path to the finalized role/channel map JSON.
- `UNIT_TALK_QA_API_URL`: staging or QA `apps/api` base URL used by Discord QA flows.

`UNIT_TALK_QA_API_URL` must point at `apps/api`. The QA bot must not hold Supabase credentials and must not bypass the API.

## Recording Final Guild, Channel, and Role IDs

After the sandbox guild and QA bot exist, record the final IDs without committing secrets:

1. Copy `docs/05_operations/templates/discord-qa-role-channel-map.local.example.json` to the repo root as `discord-qa-role-channel-map.local.json`.
2. Keep `discord-qa-role-channel-map.local.json` local-only. It is gitignored and must not be committed.
3. Fill in:
   - sandbox `guildId`
   - every role ID for `admin`, `operator`, `capper`, `vip`, `vipPlus`, `free`, `noAccess`
   - every channel ID for `qaBotLog`, `qaAccessCheck`, `qaPickDelivery`, `freePicks`, `vipPicks`, `vipPlusPicks`, `adminOps`, `recap`
4. Point `DISCORD_QA_ROLE_MAP` and `DISCORD_QA_CHANNEL_MAP` at that local file path if the workflow uses file paths.
5. Run the offline validator before using the map in QA automation.

## How This Unblocks UTV2-827 and UTV2-828

- UTV2-827 needs a sandbox guild, stable QA role IDs, and channel visibility expectations so `access_check` can move from stubbed/advisory checks to real assertions.
- UTV2-828 needs a sandbox guild, QA bot credentials, a QA API target, and deterministic channel IDs so `pick_delivery` can validate end-to-end Discord delivery without production canary traffic.

Without this sandbox split, both lanes remain blocked on external infrastructure and cannot safely use production canary channels as their main QA environment.

## Explicit No-Go

- Do not mutate the production Discord server.
- Do not expose or reuse production bot tokens.
- Do not add database access to the bot or QA bot.
- Do not hardcode environment-specific role IDs in repo code.
- Do not call Discord APIs from this setup lane.
