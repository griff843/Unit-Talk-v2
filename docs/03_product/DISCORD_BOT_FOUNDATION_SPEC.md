# Discord Bot Foundation Spec — Unit Talk V2

**Document type:** T2 Implementation Spec (not a T1 contract, not a readiness decision)
**Status:** **CLOSED — DISCORD_BOT_FOUNDATION_CLOSED** (2026-03-26). 581/581 tests. `pnpm verify` exit 0.
**Authority lane:** T2 rules apply. No T1 contract required for this slice. Both prerequisite T1 sprints (Provider Ingestion + Smart Form V1) are CLOSED.
**Checklist item:** `production_readiness_checklist.md §3.2` — Discord bot foundation (connection, command router)
**Does not overlap:** T1 Provider Ingestion contract · Smart Form V1 contract · Discord channel activation governance

---

## 1. Scope of the Foundation Slice

The foundation slice makes `apps/discord-bot` a real, running Discord application.
It is not a command suite build. It is the connective skeleton every future command and handler will attach to.

The foundation slice delivers exactly:

| Deliverable | Description |
|---|---|
| Connection lifecycle | Client instantiation, login, ready/disconnect handling |
| Startup and shutdown | Ordered startup sequence, SIGINT/SIGTERM graceful exit |
| Command registry | A typed handler map that loads command modules at startup |
| Interaction router | `interactionCreate` listener that dispatches to the correct handler |
| Slash command registration script | Idempotent guild-scoped deploy script, not runtime registration |
| Configuration contract | All env vars required by the bot, loaded via `@unit-talk/config` |
| Role guard utility | Foundation-level access gate on Discord member roles |
| API client boundary | Single HTTP client pointing at `apps/api`; no direct DB access |
| Failure handlers | Ack-within-3s discipline, unhandled command response, API unavailability |

---

## 2. What the Stub Already Has

`apps/discord-bot/src/index.ts` currently exports a single placeholder function:

```typescript
// Current state — entire file
export function createDiscordReceiptEvent(): DomainEvent<{ receipt: 'placeholder' }> { ... }
console.log(JSON.stringify(createDiscordReceiptEvent(), null, 2));
```

The package has:
- Correct `@unit-talk/discord-bot` package identity
- Correct workspace dependencies: `@unit-talk/config`, `@unit-talk/contracts`, `@unit-talk/events`, `@unit-talk/observability`
- TypeScript build pipeline (`tsc`, `tsx`, `type-check` scripts)
- **No** discord.js or discord-interactions dependency installed
- **No** connection logic, command router, or slash command definitions

The existing placeholder file must be replaced in its entirety by the foundation implementation.


---

## 3. Configuration / Environment Contract

The bot reads from the same env-file chain as all other V2 apps:
`local.env` > `.env` > `.env.example`, parsed by `@unit-talk/config`.

All required variables except `UNIT_TALK_API_URL` already appear in `.env.example`.
`UNIT_TALK_API_URL` must be added to `.env.example` as part of this slice.

| Variable | Source | Required | Description |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | `.env.example` existing | Yes | Bot login token — never logged or surfaced in responses |
| `DISCORD_CLIENT_ID` | `.env.example` existing | Yes | Application ID for slash command registration |
| `DISCORD_GUILD_ID` | `.env.example` existing | Yes | Guild `1284478946171293736` — guild-scoped commands only |
| `UNIT_TALK_API_URL` | New — add to `.env.example` | Yes | Base URL of `apps/api` (e.g. `http://localhost:4000`) |
| `UNIT_TALK_APP_ENV` | `.env.example` existing | Yes | `local` / `staging` / `production` — controls log verbosity |

**Hard rule:** The bot MUST NOT read `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY`. Any import of `@unit-talk/db` from `apps/discord-bot` is a boundary violation.

---

## 4. Connection Lifecycle

### 4.1 Discord.js Client Instantiation

```
Client({
  intents: [Guilds, GuildMembers, GuildMessages]
})
```

These are the required intents for the foundation slice only. Additional intents (e.g. `MessageContent`) are added per-command when a ratified command requires them — not speculatively.

The bot token comes from `DISCORD_BOT_TOKEN`. It is never logged and never surfaced in any error response or embed.

### 4.2 Events the Bot Must Register

| Event | Handler responsibility |
|---|---|
| `ready` | Log `Bot ready — logged in as <tag>` via observability package; signal startup complete |
| `interactionCreate` | Dispatch to command router |
| `error` | Log via observability; do NOT crash the process |
| `disconnect` | Log warning; process does not exit — process manager handles restart |

### 4.3 Reconnect Behavior

discord.js handles reconnect natively with exponential backoff.
The bot process does NOT implement custom reconnect logic at the foundation layer.
Persistent disconnect is an ops concern (process manager / deployment restart), not a bot concern.

---

## 5. Startup and Shutdown

### 5.1 Startup Sequence (ordered, fail-fast)

```
1. Load config from @unit-talk/config — exit(1) immediately if required vars absent
2. Initialize logger via @unit-talk/observability
3. Load command registry (import all modules from ./commands/ directory)
4. Attach interactionCreate listener to client
5. Attach error and disconnect listeners to client
6. client.login(DISCORD_BOT_TOKEN)
7. Await 'ready' event — log ready signal
```

Startup MUST exit non-zero immediately if any of these are missing or empty:
`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `UNIT_TALK_API_URL`

### 5.2 Shutdown Sequence (SIGINT / SIGTERM)

```
1. Log "Bot shutting down — received <signal>"
2. client.destroy()
3. Log "Client destroyed"
4. process.exit(0)
```

In-flight interactions already acknowledged by `deferReply()` are safe — Discord holds the response window open for 15 minutes after deferral. The bot does not need to track in-flight state at the foundation layer.


---

## 6. Command Router Structure

### 6.1 CommandHandler Interface

```typescript
interface CommandHandler {
  data: SlashCommandBuilder;          // discord.js builder — name, description, options
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  requiredRoles?: string[];           // Discord role IDs; if present, role guard runs before execute()
}
```

### 6.2 Command Registry

The command registry is a `Map<string, CommandHandler>` keyed by command name.
Commands are loaded from `./commands/` at startup by iterating the directory.
The registry is immutable at runtime — no dynamic command registration after startup.

### 6.3 Interaction Router (dispatch order)

On `interactionCreate`:

```
1. If !interaction.isChatInputCommand() → ignore silently
2. Look up command by name in registry
   → if not found → reply ephemeral "Unknown command"
3. If command.requiredRoles is defined → run role guard
   → if guard fails → reply ephemeral "You don't have access to this command"
4. await interaction.deferReply({ ephemeral: true })   <- MUST happen before any async work
5. await command.execute(interaction)
6. On uncaught error from execute() → editReply generic error message; log full error via observability
```

**Ack-within-3s discipline:** `deferReply()` MUST be called before any I/O or await. Discord closes the interaction window at 3 seconds with no exception. This is the single most common failure mode in Discord bot implementation and must be enforced at code review.

---

## 7. Slash Command Registration Pattern

Slash command registration is a **deploy-time operation**, not a bot startup operation.
The running bot process does NOT register commands on login.

### 7.1 Deploy Script

`apps/discord-bot/scripts/deploy-commands.ts`

Uses `@discordjs/rest` to call the Discord REST API, targeting `DISCORD_GUILD_ID` only.
Guild-scoped commands propagate within seconds. Global commands can take up to 1 hour.
Global registration is deferred until a production deployment strategy is defined.

### 7.2 Registration Flow

```
1. Load config — same required vars as bot startup
2. Import all CommandHandler modules from ./commands/
3. Extract command.data.toJSON() from each handler
4. REST PUT /applications/{CLIENT_ID}/guilds/{GUILD_ID}/commands  (full replace, idempotent)
5. Log count of registered commands on success
```

Stale commands are removed automatically by the full-replace PUT.
Add `"deploy-commands": "tsx scripts/deploy-commands.ts"` to `package.json` scripts.

### 7.3 Registration Scope Boundary

- Guild-scoped for all V2 work
- Global registration requires a separate explicit decision — not in this slice
- No per-command registration at runtime

---

## 8. Routing Authority Boundaries

The Discord bot is a **consumer** of `apps/api`. It has no independent write authority.

| Boundary | Rule |
|---|---|
| DB access | Prohibited. Bot must not import `@unit-talk/db` or hold Supabase credentials. |
| Write authority | All mutations go through `POST /api/submissions` or other ratified API routes only. |
| Read access | Permitted via `GET /api/operator/*` endpoints that expose non-sensitive data. |
| Promotion authority | Bot cannot promote or suppress picks directly. Submission via API triggers the promotion pipeline. |
| Override authority | Bot CANNOT call `applyPromotionOverride()`. Operator override is an operator-web concern only. |
| Single-writer discipline | `apps/api` is the sole canonical DB writer. This constraint applies to the bot equally. |

### 8.1 API Client Contract

The foundation provides a single HTTP client module used by all command handlers:

```typescript
// apps/discord-bot/src/api-client.ts
export function createApiClient(baseUrl: string): ApiClient
```

Command handlers receive the API client as a dependency — they do not construct raw `fetch()` calls inline. This ensures the base URL, timeout, and error handling are consistent and testable.

---

## 9. Role / Access Gating

Role gating at the foundation level enforces the model defined in `docs/03_product/ROLE_ACCESS_MATRIX.md`.

### 9.1 Role Guard Signature

```typescript
function checkRoles(
  interaction: ChatInputCommandInteraction,
  requiredRoles: string[]   // Discord role IDs
): boolean
```

Checks `interaction.member.roles.cache` against the provided list.
Member must hold **at least one** of the required roles to pass.
On failure: reply ephemeral "You don't have access to this command."

### 9.2 Foundation Role Map Shape

A typed `RoleMap` object is loaded from env vars at startup.
Role IDs are NOT hardcoded in source — they differ between environments.
The foundation spec does not prescribe the exact env var names for role IDs; the implementation can use a structured `DISCORD_ROLE_MAP` JSON env var or individual named vars (to be decided by the implementation lane).

| Role Purpose | Commands gated at this role (future slices) |
|---|---|
| Capper | `/pick`, `/edit-pick`, `/delete-pick`, `/capper-stats` |
| Operator | `/admin-*` family (not in this slice) |
| VIP+ | `/trader-insights`, `/exclusive-insights` (not in this slice) |
| Any authenticated member | `/stats`, `/recap`, `/top-plays` (not in this slice) |

The foundation implements the `RoleMap` type and `checkRoles()` utility only. Command modules declare `requiredRoles` at definition time. The foundation does not implement any of the listed commands.


---

## 10. How Bot Commands Interact with Canonical API Surfaces

All bot commands follow this single, uniform pattern:

```
/command issued by user
  → interaction router dispatches
  → role guard runs (if requiredRoles defined)
  → deferReply({ ephemeral: true })
  → apiClient.post('/api/submissions', payload)
    OR apiClient.get('/api/operator/...')
  → format response as Discord embed or plain ephemeral text
  → editReply(formatted response)
```

The bot never calls the distribution worker, never touches the outbox, and never posts to Discord channels directly. Channel posts are the distribution worker's responsibility. Bot interactions are stateless request/response only.

### 10.1 Anticipated API Surface per Future Command (planning hints only)

| Command (future slice) | API surface |
|---|---|
| `/pick` | `POST /api/submissions` |
| `/stats` | `GET /api/operator/recap` |
| `/recap` | `GET /api/operator/recap` |
| `/portfolio` | `GET /api/operator/picks-pipeline` (capper identity resolution TBD) |
| `/pick-result` | Requires a ratified manual result entry route — not yet defined in V2 |

Each command will be specced individually in its own implementation slice. This table is a planning hint only, not a binding contract.

---

## 11. Failure Modes and Recovery Expectations

| Failure | Bot behavior | Recovery path |
|---|---|---|
| Required env var missing at startup | Log error, `process.exit(1)` | Fix env config, redeploy |
| `apps/api` unavailable during command | `editReply` "Service temporarily unavailable — try again shortly" (ephemeral) | API recovers; next invocation succeeds |
| Interaction not acknowledged within 3s | Discord surfaces "This interaction failed" to user | Fix handler to call `deferReply()` before any async work |
| Unknown command name in registry | Reply ephemeral "Unknown command" | Redeploy with corrected command set |
| `execute()` throws unhandled error | `editReply` generic error message; full error logged via observability | Fix handler bug, redeploy |
| `client.error` event fires | Log error via observability; process continues | discord.js reconnects automatically |
| Persistent disconnect | Log warning; no process exit | Ops process manager (pm2 / Docker restart policy) restarts |
| Role guard fails | Reply ephemeral "You don't have access to this command" | User acquires correct role and retries |

No dead-letter queue, no retry logic, no in-process state persistence at the foundation layer.
Bot commands are stateless. All durability guarantees live in `apps/api` and the database.

---

## 12. Intentionally Out of Scope for the Foundation Slice

| Item | Reason deferred |
|---|---|
| Business commands (`/pick`, `/stats`, `/recap`, `/portfolio`, etc.) | Separate implementation slices per checklist §3.3–3.16 |
| DM routing (`discord:strategy-room`) | Architectural gap — requires a ratified contract |
| Thread posting (`discord:game-threads`) | Architectural gap — thread routing not in V2 worker; requires contract |
| Global slash command registration | Requires production deployment strategy decision |
| LLM / OpenAI integration (`/ask-ai`) | Blocked on OpenAI integration (checklist §3.15) |
| Capper onboarding flow | T1 — requires contract (checklist §3.9) |
| Trial management | Depends on capper tier system design (checklist §3.10, §3.11) |
| Capper identity resolution (Discord user to capper record) | Not yet designed in V2 |
| Proactive channel posting | Distribution worker responsibility — not the bot |
| Discord component interactions (buttons, modals, select menus) | Added per-command when ratified |
| API rate limit management | Deferred — not a foundation concern |
| Redis session/cache layer | Deferred (checklist §5.10) |
| Operator override from bot | Prohibited — bot has no override authority |
| Schema changes | None required — bot reads and writes only through `apps/api` |

---

## 13. Package Dependencies to Add

Before implementation begins:

```
pnpm --filter @unit-talk/discord-bot add discord.js @discordjs/rest
```

Do not add `@supabase/supabase-js` to `apps/discord-bot`. It must never appear as a dependency of this app.

---

## 14. Expected Implementation Surface

Files created or replaced by the Codex implementation lane:

| File | Purpose |
|---|---|
| `apps/discord-bot/src/index.ts` | Bot entry point — replaces current placeholder entirely |
| `apps/discord-bot/src/client.ts` | Client factory with intent configuration |
| `apps/discord-bot/src/command-registry.ts` | Command module loading and registry map |
| `apps/discord-bot/src/router.ts` | `interactionCreate` dispatch + role guard integration |
| `apps/discord-bot/src/role-guard.ts` | `checkRoles()` utility |
| `apps/discord-bot/src/api-client.ts` | HTTP client bound to `UNIT_TALK_API_URL` |
| `apps/discord-bot/src/config.ts` | Env loading wrapper using `@unit-talk/config` |
| `apps/discord-bot/src/commands/` | Directory — empty at foundation; populated by later slices |
| `apps/discord-bot/scripts/deploy-commands.ts` | Guild command registration script |

No schema migrations. No new shared packages. No changes to `apps/api`, `apps/worker`, `apps/operator-web`, or `apps/smart-form`.

### 14.1 Implementation Readiness Gate

Reviewed 2026-03-26. Gate state at lane open:

- [x] Active T1 sprints closed — Provider Ingestion ✅ + Smart Form V1 ✅
- [ ] `UNIT_TALK_API_URL` added to `.env.example` — **Codex first-commit prerequisite** (listed in §3 as part of slice)
- [ ] `discord.js` and `@discordjs/rest` installed via pnpm in `apps/discord-bot` — **Codex setup step** (per §13)
- [x] `DISCORD_BOT_TOKEN` populated in `local.env` ✅
- [ ] `DISCORD_CLIENT_ID` populated in `local.env` — **user must supply Discord Application ID** from developer portal; bot implementation and type-check proceed without it; only `deploy-commands.ts` is blocked
- [x] Spec reviewed and marked implementation-ready by Claude governance lane ✅ (2026-03-26)

---

## 15. Authority References

| Document | Role |
|---|---|
| `docs/05_operations/discord_routing.md` | Live routing state, channel IDs, approved targets, architectural gaps |
| `docs/03_product/ROLE_ACCESS_MATRIX.md` | Role model and access design principles |
| `docs/02_architecture/contracts/writer_authority_contract.md` | Single-writer discipline — bot is a consumer, not a writer |
| `docs/02_architecture/contracts/submission_contract.md` | Submission intake authority — bot submits through `apps/api` |
| `docs/06_status/production_readiness_checklist.md` | Section 3 — checklist item §3.2 this slice addresses |
| `docs/05_operations/agent_delegation_policy.md` | T2 implementation lane routing rules |
| `.env.example` | Environment variable source of truth |
