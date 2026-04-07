/**
 * Worker health alert check.
 *
 * Queries system_runs for the most recent worker.heartbeat.
 * If the heartbeat is older than STALE_THRESHOLD_MINUTES, emits a CRITICAL log
 * line and optionally posts a Discord webhook alert.
 *
 * Intended to run on a short cron (every 5–10 minutes) as an independent
 * observer — not as part of ops:brief (which requires manual invocation).
 *
 * Usage:
 *   pnpm worker:alert-check
 *   # Or with explicit threshold:
 *   WORKER_ALERT_THRESHOLD_MINUTES=60 pnpm worker:alert-check
 */

import { createClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';

const STALE_THRESHOLD_MINUTES = Number.parseInt(
  process.env['WORKER_ALERT_THRESHOLD_MINUTES'] ?? '120',
  10,
);

const env = loadEnvironment();

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[worker-alert] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — cannot check.');
  process.exit(1);
}

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: rows } = await db
  .from('system_runs')
  .select('status, started_at')
  .eq('run_type', 'worker.heartbeat')
  .order('started_at', { ascending: false })
  .limit(1);

const lastRun = rows?.[0];

if (!lastRun) {
  emit('CRITICAL', 'No worker.heartbeat rows found in system_runs — worker has never run or table is empty.');
  await postDiscordAlert('🚨 Worker has never written a heartbeat. Worker may not be configured correctly.');
  process.exit(1);
}

const ageMs = Date.now() - new Date(lastRun.started_at).getTime();
const ageMin = Math.round(ageMs / 60_000);

if (ageMin > STALE_THRESHOLD_MINUTES) {
  const msg = `Worker heartbeat is ${ageMin}m old (threshold: ${STALE_THRESHOLD_MINUTES}m). Last status: ${lastRun.status}. Worker is likely DOWN.`;
  emit('CRITICAL', msg);
  await postDiscordAlert(`🚨 ${msg}`);
  process.exit(1);
}

emit('OK', `Worker heartbeat is ${ageMin}m old (threshold: ${STALE_THRESHOLD_MINUTES}m). Status: ${lastRun.status}.`);
process.exit(0);

// ---------------------------------------------------------------------------

function emit(level: 'OK' | 'CRITICAL', message: string) {
  console.log(JSON.stringify({ level, service: 'worker', check: 'heartbeat', message, ts: new Date().toISOString() }));
}

async function postDiscordAlert(message: string) {
  const webhookUrl = env.UNIT_TALK_DISCORD_TARGET_MAP
    ? (() => {
        try {
          const map = JSON.parse(env.UNIT_TALK_DISCORD_TARGET_MAP) as Record<string, string>;
          return map['discord:canary'];
        } catch {
          return undefined;
        }
      })()
    : undefined;

  if (!webhookUrl || !env.DISCORD_BOT_TOKEN) {
    // No webhook configured — log only.
    return;
  }

  // Post to Discord canary channel via the REST API.
  const channelId = webhookUrl;
  try {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: message }),
    });
  } catch (error) {
    console.error('[worker-alert] Failed to post Discord alert:', error instanceof Error ? error.message : String(error));
  }
}
