# Agent Notify

Local ops-only notifications for agent runs. The scripts post to a private Discord webhook when an agent completes or fails.

This does not post to any public Unit Talk Discord channel, does not activate delivery targets, does not write to the database, and does not touch pick lifecycle, promotion, settlement, or distribution logic.

## Discord Setup

Create a private Discord server or private channel, then open channel settings and go to Integrations -> Webhooks. Create a webhook and copy its URL.

## Local Env

Add the webhook URL to `local.env`:

```bash
DISCORD_OPS_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Never commit the webhook URL. `.env.example` documents the optional variable only.

## Claude Code

Claude Code Stop hooks are already wired in `.claude/settings.json`. No manual activation step is required.

## Codex

Codex dispatch notifications are wired through `scripts/codex-dispatch.ts`. Dispatch sends a best-effort notification when a packet is ready, when dispatch fails, or when required operator input is missing. Notification failures do not change the dispatch exit code.

## Manual Test

```bash
DISCORD_OPS_WEBHOOK_URL=<url> npx tsx scripts/agent-notify/notify.ts --event=complete --agent=claude --detail=test
```

Expected result: Discord returns a successful webhook response and the message appears in the private test channel.

## Disable

Unset `DISCORD_OPS_WEBHOOK_URL`. When the variable is absent or empty, the notifier exits silently with status 0.
