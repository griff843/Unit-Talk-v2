/**
 * WEEK20-DISCORD-LIVE-CANARY-PROOF
 *
 * Sends one controlled canary message through the real V2 Discord delivery adapter
 * to prove live posting works. Uses the actual createDiscordDeliveryAdapter code path.
 *
 * Required environment:
 *   DISCORD_BOT_TOKEN — a valid Discord bot token
 *   CANARY_CHANNEL_ID — the Discord channel to post to (defaults to canary channel)
 *
 * Usage:
 *   DISCORD_BOT_TOKEN=<token> npx tsx apps/worker/src/canary-live-proof.ts
 */

import { loadEnvironment } from '@unit-talk/config';
import { createDiscordDeliveryAdapter } from './delivery-adapters.js';
import type { OutboxRecord } from '@unit-talk/db';

const environment = loadEnvironment();
const targetMap = readTargetMap(environment.UNIT_TALK_DISCORD_TARGET_MAP);
const botToken = process.env.DISCORD_BOT_TOKEN?.trim() || environment.DISCORD_BOT_TOKEN?.trim();
const canaryChannelId =
  process.env.CANARY_CHANNEL_ID?.trim() ||
  targetMap['discord:canary'] ||
  '1296531122234327100';
const canaryTarget = targetMap['discord:canary'] ? 'discord:canary' : `discord:${canaryChannelId}`;

if (!botToken) {
  console.error(JSON.stringify({
    verdict: 'NOT_PROVEN',
    reason: 'DISCORD_BOT_TOKEN is not set. Cannot attempt live delivery.',
  }, null, 2));
  process.exit(1);
}

const syntheticOutbox: OutboxRecord = {
  id: `canary-live-proof-${Date.now()}`,
  pick_id: `canary-pick-${Date.now()}`,
  target: canaryTarget,
  status: 'processing',
  attempt_count: 0,
  next_attempt_at: null,
  last_error: null,
  claimed_at: new Date().toISOString(),
  claimed_by: 'canary-live-proof',
  idempotency_key: `canary-live-proof-${Date.now()}`,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  payload: {
    market: 'Week 20 Canary Proof',
    selection: 'Live Discord Delivery Verified',
    line: null,
    odds: null,
    source: 'canary-live-proof',
    lifecycleState: 'canary',
    metadata: {
      sport: 'Platform Validation',
      eventName: 'WEEK20-DISCORD-LIVE-CANARY-PROOF',
      capper: 'Unit Talk V2 CI',
    },
  },
};

const adapter = createDiscordDeliveryAdapter({
  dryRun: false,
  botToken,
  targetMap,
});

console.log(JSON.stringify({
  phase: 'PRE_DELIVERY',
  target: syntheticOutbox.target,
  channelId: canaryChannelId,
  outboxId: syntheticOutbox.id,
  timestamp: new Date().toISOString(),
}, null, 2));

try {
  const result = await adapter(syntheticOutbox);
  console.log(JSON.stringify({
    phase: 'POST_DELIVERY',
    verdict: 'SUCCESS',
    result,
    timestamp: new Date().toISOString(),
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    phase: 'POST_DELIVERY',
    verdict: 'FAIL',
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString(),
  }, null, 2));
  process.exit(1);
}

function readTargetMap(rawValue: string | undefined) {
  if (!rawValue) {
    return {} as Record<string, string>;
  }

  try {
    return JSON.parse(rawValue) as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
}
