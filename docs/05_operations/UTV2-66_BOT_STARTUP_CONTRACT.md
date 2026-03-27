# UTV2-66 — T2 Discord Bot Startup Entry Point

**Status:** RATIFIED
**Lane:** `lane:augment` (T2 wiring — all pieces exist, no new logic)
**Tier:** T2
**Milestone:** M11
**Ratified:** 2026-03-27
**Authority:** Claude lane — M11 contract authoring session 2026-03-27

---

## Problem

`apps/discord-bot/src/index.ts` is the package library entry (exports `buildRecapEmbedData`). The `dev` script runs `tsx src/index.ts` which does nothing useful as an app entry point. There is no `main.ts` that connects the client, loads the registry, attaches the interaction handler, and calls `client.login()`. Commands appear in Discord (registered via `deploy-commands`) but the bot never responds to interactions.

All pieces exist — this is pure wiring:
- `createDiscordClient()` — `src/client.ts`
- `loadBotConfig()` — `src/config.ts`
- `loadCommandRegistry()` — `src/command-registry.ts`
- `createInteractionHandler()` — `src/router.ts`

---

## Scope

Create `apps/discord-bot/src/main.ts` as the bot process entry point. Update the `dev` script to run it.

---

## Permitted Files

- `apps/discord-bot/src/main.ts` — **new file** (the only material change)
- `apps/discord-bot/package.json` — update `dev` script only

**Do NOT touch:** `src/index.ts`, any command files, `src/router.ts`, `src/client.ts`, `src/config.ts`, `src/command-registry.ts`, any test files, any other package

---

## Required Implementation (`src/main.ts`)

```typescript
import { createDiscordClient } from './client.js';
import { loadCommandRegistry } from './command-registry.js';
import { createInteractionHandler } from './router.js';
import { loadBotConfig } from './config.js';

async function main() {
  let config;
  try {
    config = loadBotConfig();
  } catch (err) {
    console.error('[discord-bot] Startup failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const client = createDiscordClient();
  const registry = await loadCommandRegistry();

  client.once('ready', (readyClient) => {
    console.log(`[discord-bot] Ready as ${readyClient.user.tag}`);
  });

  client.on('interactionCreate', createInteractionHandler(registry));

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      console.log(`[discord-bot] ${signal} received — destroying client`);
      client.destroy();
      process.exit(0);
    });
  }

  await client.login(config.token);
}

main().catch((err) => {
  console.error('[discord-bot] Fatal error:', err);
  process.exit(1);
});
```

Do not deviate from this structure. Do not add logging beyond what is shown.

---

## package.json change

```json
"dev": "tsx src/main.ts"
```

(was `tsx src/index.ts`)

---

## Acceptance Criteria

- [ ] AC-1: `apps/discord-bot/src/main.ts` exists and matches the required implementation above
- [ ] AC-2: `package.json` `dev` script points to `src/main.ts`
- [ ] AC-3: `pnpm type-check` exits 0 (no new type errors)
- [ ] AC-4: Running `pnpm --filter @unit-talk/discord-bot dev` from repo root starts the bot process without crashing (confirm with `DISCORD_BOT_TOKEN` from `local.env`)
- [ ] AC-5: Bot responds to at least one slash command in Discord (e.g. `/help` returns the embed)

---

## Constraints

- No tests required — `main.ts` is a process entry point with no testable interface
- Do not add error handling, retry logic, or reconnection beyond what is shown
- Do not import from `apps/api` or any other app
- `src/index.ts` stays as-is (library entry for `apps/api` import of `buildRecapEmbedData`)
