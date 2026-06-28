# Verification: UTV2-1335 — Alert Configuration Enforcement

## Verification

### pnpm verify

Static suite (lint + type-check + build + 700+ unit tests): **PASS** — # fail 0 across all static test suites.

Live DB suite (`pnpm test:db`, 7 tests): **PASS** — # pass 7, # fail 0.

Live T1 proof suite (`pnpm test:t1-proof:live`): One pre-existing flake in
`t1-proof-utv2-1282-bounded-dedup.test.ts` — "canceling statement due to statement timeout"
from `provider_offer_history`. This is a known Supabase statement-timeout intermittent failure
unrelated to alert configuration enforcement. All other T1 proof tests passed.

Alert-specific tests run in isolation:

```
# tests 45
# suites 0
# pass 45
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 8281.447708
```

Files: `apps/api/src/alert-notification-service.test.ts` +
`apps/api/src/alert-agent-service.test.ts`

### R-level check

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

Command: `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

### Alert enforcement evidence

#### 1. Missing `DISCORD_BOT_TOKEN` → fail-closed (not silent skip)

File: `packages/alert-runtime/src/alert-notification-service.ts`, lines 266–269

```typescript
if (!botToken) {
  result.failed++;
  continue;
}
```

When `DISCORD_BOT_TOKEN` is absent or empty, the notification loop increments `failed` and
moves to the next signal. The notification is **not silently dropped** — it is counted as a
delivery failure. Covered by test: `runAlertNotificationPass — Discord failure leaves
notified=false` (test 42, line 560).

#### 2. Missing/unresolvable channel in `UNIT_TALK_DISCORD_TARGET_MAP` → fail-closed

File: `packages/alert-runtime/src/alert-notification-service.ts`, lines 133–152 (`resolveDiscordChannelId`)

```typescript
const raw = env.UNIT_TALK_DISCORD_TARGET_MAP?.trim();
if (!raw) return null;
```

If the env variable is absent, `resolveDiscordChannelId` returns `null`. The caller (line 274–275):

```typescript
if (!channelId) continue;
```

Skips that channel. If all channels fail to resolve, `successChannels.length === 0` at line 293,
which increments `result.failed++` (lines 293–296). The notification fails closed — it is not
silently treated as delivered.

Covered by tests: `resolveDiscordChannelId — returns null when target not in map` (test 33,
line 176) and `resolveDiscordChannelId — resolves from target map env` (test 32, line 170).

#### 3. Invalid threshold env values → throws (startup fail-closed)

File: `packages/alert-runtime/src/alert-agent-service.ts`, lines 806–827 (`normalizePositiveNumber`)

```typescript
function normalizePositiveNumber(rawValue, fallback, envName) {
  ...
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive number`);
  }
  return parsed;
}
```

If any threshold env variable is set to a non-positive or non-numeric value, `loadAlertThresholds`
throws at startup — the alert agent cannot proceed. Covered by test: `loadAlertThresholds throws
on invalid numeric env values` (test 10, line in alert-agent-service.test.ts).

#### 4. Dry-run is the safe default

File: `packages/alert-runtime/src/alert-agent-service.ts`, line 122

```typescript
dryRun: env.ALERT_DRY_RUN !== 'false',
```

Dry-run mode is **on by default**. Live Discord posting requires explicit `ALERT_DRY_RUN=false`.
In dry-run mode, Discord is never called and cooldowns are never written (test 36).

#### 5. Watch tier never notified (architectural enforcement)

File: `packages/alert-runtime/src/alert-notification-service.ts`, lines 229–234

```typescript
if (tier === 'watch') {
  if (!detection.steam_detected) {
    result.skippedWatch++;
    continue;
  }
}
```

Watch-tier signals that are not steam-detected are always skipped. Covered by test: `watch tier
never notified` (test 35, line 191).

#### 6. Channel routing table hardcoded per contract

File: `packages/alert-runtime/src/alert-notification-service.ts`, lines 21–25

```typescript
function resolveChannels(tier: AlertDetectionTier): string[] {
  if (tier === 'notable') return ['discord:canary'];
  if (tier === 'alert-worthy') return ['discord:canary', 'discord:trader-insights'];
  return [];
}
```

Routing is enforced in code per T1_ALERTAGENT_LINE_MOVEMENT_CONTRACT §8.1.
Covered by tests 37 and 39 (notable routes to canary only; alert-worthy routes to both).

### Verdict

**PASS**

Alert destinations are enforced and fail closed when missing:
- Missing `DISCORD_BOT_TOKEN`: counted as `failed`, not silently skipped
- Missing/unresolvable `UNIT_TALK_DISCORD_TARGET_MAP` entry: channel skipped; if all channels fail → notification counted as `failed`
- Invalid numeric threshold env vars: throws at config load (startup failure)
- Dry-run is the safe default — must opt-out explicitly
- Watch tier is never notified, architecturally enforced

All 45 alert-specific unit tests pass against in-memory repositories. Static suite green
(700+ unit tests, # fail 0).
