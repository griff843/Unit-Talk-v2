# Discord QA Unblock Plan

## Current Status

Discord QA infra is partially unblocked as of 2026-05-04:

- sandbox guild exists on non-production host guild `griff843's server`
- sandbox guild ID is `1195598141026742343`
- QA role IDs are collected
- QA channel IDs are collected
- local role/channel map file exists as `discord-qa-role-channel-map.local.json`

Still blocked external:

- separate `Unit Talk QA Bot` app has not been created yet
- QA bot has not been invited yet
- QA bot token and client ID do not exist yet
- persona auth is not yet wired to the sandbox guild
- staging `apps/api` target for Discord QA is not yet configured

## Local Config Pattern

Sandbox IDs are treated as local operational config in this lane.

- committed examples live under `docs/05_operations/templates/`
- real local IDs live in repo-root `discord-qa-role-channel-map.local.json`
- the real local map file is gitignored
- bot tokens must never be committed

## UTV2-827 Status

UTV2-827 depends on the Discord `access_check` skill becoming runnable against the sandbox environment.

Ready now:

- sandbox guild exists
- role/channel visibility matrix is implemented in Discord
- guild, role, and channel IDs are recorded locally

Still needed before UTV2-827 is unblocked:

- create the `Unit Talk QA Bot` app
- obtain `DISCORD_QA_BOT_TOKEN`
- obtain `DISCORD_QA_CLIENT_ID`
- invite the QA bot to the sandbox guild only
- wire persona auth to the sandbox guild for role assignment and access assertions

UTV2-827 status: infra-prep mostly complete, execution still blocked on QA bot credentials and auth wiring.

## UTV2-828 Status

UTV2-828 depends on the Discord `pick_delivery` skill becoming runnable against a sandbox environment with a QA delivery target.

Ready now:

- sandbox guild exists
- delivery target channels exist
- guild, role, and channel IDs are recorded locally

Still needed before UTV2-828 is unblocked:

- create and invite the `Unit Talk QA Bot`
- configure `DISCORD_QA_BOT_TOKEN` and `DISCORD_QA_CLIENT_ID`
- configure `UNIT_TALK_QA_API_URL`
- provide a seeded pick fixture path for deterministic delivery tests
- verify the delivery receipt path against the staging API-driven delivery flow

UTV2-828 status: infra-prep partially complete, still blocked on QA bot credentials, QA API target, fixture seeding, and receipt verification.

## Stability Gate

After sandbox setup is complete and the infrastructure proves stable, convert `qa-experience` for Discord paths from advisory to required only for Discord-specific paths. Do not promote that gate until:

- QA bot/app credentials are provisioned
- role/channel maps are finalized and stable
- access-check and pick-delivery runs are repeatable
- staging API-backed delivery verification is green

## No-Go Confirmation

- No production server mutation belongs in this lane.
- No production token exposure belongs in this lane.
- No bot database access belongs in this lane.
