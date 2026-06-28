/**
 * Grading staleness alert check.
 *
 * Queries system_runs for grading.run rows in the last 24h.
 *
 * Two failure conditions:
 *   1. No grading.run row in the last 24h → grading cron is dead or not running
 *   2. Any grading.run row with picksGraded = 0 → grading ran but graded nothing
 *      (potential upstream blockage: no settled results, no eligible picks)
 *
 * Intended to run on a scheduled GHA cron (daily or more frequent).
 *
 * Usage:
 *   pnpm grading:alert-check
 *   # Or with explicit window:
 *   GRADING_ALERT_WINDOW_HOURS=48 pnpm grading:alert-check
 */

import { createClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';

const WINDOW_HOURS = Number.parseInt(
  process.env['GRADING_ALERT_WINDOW_HOURS'] ?? '24',
  10,
);

const env = loadEnvironment();

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[grading-alert] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — cannot check.',
  );
  process.exit(1);
}

interface GradingRunDetails {
  picksGraded?: number;
  failed?: number;
  [key: string]: unknown;
}

interface SystemRunRow {
  id: string;
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  details: GradingRunDetails | null;
}

async function main() {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const windowStart = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await db
    .from('system_runs')
    .select('id, run_type, status, started_at, finished_at, details')
    .eq('run_type', 'grading.run')
    .gte('started_at', windowStart)
    .order('started_at', { ascending: false });

  if (error) {
    emit('CRITICAL', `DB query failed: ${error.message}`);
    await postDiscordAlert(`Grading alert check failed: DB query error — ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const runs = (rows ?? []) as SystemRunRow[];

  // Check 1: no grading run in window → cron is dead
  if (runs.length === 0) {
    const msg = `No grading.run in the last ${WINDOW_HOURS}h. Grading cron may be stalled or not configured.`;
    emit('CRITICAL', msg);
    await postDiscordAlert(msg);
    process.exitCode = 1;
    return;
  }

  const mostRecent = runs[0]!;
  const ageMin = Math.round(
    (Date.now() - new Date(mostRecent.started_at).getTime()) / 60_000,
  );

  // Check 2: any run with 0 picks graded
  const zeroGradedRuns = runs.filter(
    (r) => typeof r.details?.picksGraded === 'number' && r.details.picksGraded === 0,
  );

  if (zeroGradedRuns.length > 0) {
    const msg =
      `${zeroGradedRuns.length} of ${runs.length} grading.run(s) in the last ${WINDOW_HOURS}h ` +
      `completed with 0 picks graded. Last run was ${ageMin}m ago (status: ${mostRecent.status}). ` +
      `Possible cause: no settled game results, no eligible picks, or upstream blockage.`;
    emit('WARN', msg);
    await postDiscordAlert(msg);
    // Exit 1 so GHA step fails and the run is visible in the checks list
    process.exitCode = 1;
    return;
  }

  emit(
    'OK',
    `${runs.length} grading.run(s) in last ${WINDOW_HOURS}h. ` +
      `Most recent was ${ageMin}m ago (status: ${mostRecent.status}, ` +
      `picksGraded: ${mostRecent.details?.picksGraded ?? 'unknown'}).`,
  );
}

function emit(level: 'OK' | 'WARN' | 'CRITICAL', message: string) {
  console.log(
    JSON.stringify({
      level,
      service: 'grading',
      check: 'staleness',
      message,
      ts: new Date().toISOString(),
    }),
  );
}

async function postDiscordAlert(message: string) {
  const webhookUrl = process.env['UNIT_TALK_OPS_ALERT_WEBHOOK_URL'];
  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `[grading-alert] ${message}` }),
    });
  } catch (err) {
    console.error(
      '[grading-alert] Failed to post Discord alert:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

main().catch((err) => {
  console.error(
    '[grading-alert] Unexpected error:',
    err instanceof Error ? err.message : String(err),
  );
  process.exitCode = 1;
});
