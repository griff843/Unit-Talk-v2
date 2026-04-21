import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { loadEnvironment, type AppEnv } from '@unit-talk/config';

interface AlertFinding {
  level: 'OK' | 'CRITICAL';
  check: 'cycle' | 'offers' | 'results';
  ageMinutes: number | null;
  message: string;
}

const env = loadEnvironment();

export function parseThreshold(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveIngestorAlertThresholds(environment: Pick<
  AppEnv,
  | 'UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES'
  | 'INGESTOR_ALERT_OFFERS_THRESHOLD_MINUTES'
  | 'INGESTOR_ALERT_RESULTS_THRESHOLD_MINUTES'
  | 'INGESTOR_ALERT_CYCLE_THRESHOLD_MINUTES'
>) {
  return {
    offers: parseThreshold(
      environment.UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES ?? environment.INGESTOR_ALERT_OFFERS_THRESHOLD_MINUTES,
      30,
    ),
    results: parseThreshold(environment.INGESTOR_ALERT_RESULTS_THRESHOLD_MINUTES, 60),
    cycle: parseThreshold(environment.INGESTOR_ALERT_CYCLE_THRESHOLD_MINUTES, 30),
  };
}

export function evaluateAgeFinding(
  check: AlertFinding['check'],
  isoTimestamp: string | null,
  thresholdMinutes: number,
  status: string | null,
  now = new Date(),
): AlertFinding {
  if (!isoTimestamp) {
    return {
      level: 'CRITICAL',
      check,
      ageMinutes: null,
      message: `No ${check} timestamp found; ingestor ${check} freshness cannot be proven.`,
    };
  }

  const ageMinutes = Math.round((now.getTime() - new Date(isoTimestamp).getTime()) / 60_000);
  const suffix = status ? ` Last status: ${status}.` : '';

  if (ageMinutes > thresholdMinutes) {
    return {
      level: 'CRITICAL',
      check,
      ageMinutes,
      message: `Ingestor ${check} freshness is ${ageMinutes}m old (threshold: ${thresholdMinutes}m).${suffix}`,
    };
  }

  return {
    level: 'OK',
    check,
    ageMinutes,
    message: `Ingestor ${check} freshness is ${ageMinutes}m old (threshold: ${thresholdMinutes}m).${suffix}`,
  };
}

function emit(level: AlertFinding['level'], message: string, check: AlertFinding['check'], ageMinutes: number | null) {
  console.log(
    JSON.stringify({
      level,
      service: 'ingestor',
      check,
      ageMinutes,
      message,
      ts: new Date().toISOString(),
    }),
  );
}

async function postDiscordAlert(message: string) {
  if (env.UNIT_TALK_OPS_ALERT_WEBHOOK_URL) {
    try {
      await fetch(env.UNIT_TALK_OPS_ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `Ingestor alert\n${message}` }),
      });
    } catch (error) {
      console.error('[ingestor-alert] Failed to post Discord webhook:', error instanceof Error ? error.message : String(error));
    }
    return;
  }

  const channelId = env.UNIT_TALK_DISCORD_TARGET_MAP
    ? (() => {
        try {
          const map = JSON.parse(env.UNIT_TALK_DISCORD_TARGET_MAP) as Record<string, string>;
          return map['discord:canary'];
        } catch {
          return undefined;
        }
      })()
    : undefined;

  if (!channelId || !env.DISCORD_BOT_TOKEN) {
    return;
  }

  try {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: `Ingestor alert\n${message}` }),
    });
  } catch (error) {
    console.error('[ingestor-alert] Failed to post Discord alert:', error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[ingestor-alert] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set - cannot check.');
    process.exit(1);
  }

  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const [{ data: cycleRows }, { data: offerRows }, { data: resultRows }] = await Promise.all([
    db
      .from('system_runs')
      .select('status, started_at')
      .eq('run_type', 'ingestor.cycle')
      .order('started_at', { ascending: false })
      .limit(1),
    db
      .from('provider_offers')
      .select('snapshot_at')
      .order('snapshot_at', { ascending: false })
      .limit(1),
    db
      .from('game_results')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const lastCycle = cycleRows?.[0] ?? null;
  const lastOffer = offerRows?.[0] ?? null;
  const lastResult = resultRows?.[0] ?? null;
  const thresholds = resolveIngestorAlertThresholds(env);

  const findings = [
    evaluateAgeFinding('cycle', lastCycle?.started_at ?? null, thresholds.cycle, lastCycle?.status ?? null),
    evaluateAgeFinding('offers', lastOffer?.snapshot_at ?? null, thresholds.offers, null),
    evaluateAgeFinding('results', lastResult?.created_at ?? null, thresholds.results, null),
  ];

  for (const finding of findings) {
    emit(finding.level, finding.message, finding.check, finding.ageMinutes);
  }

  const criticalFindings = findings.filter((finding) => finding.level === 'CRITICAL');
  if (criticalFindings.length > 0) {
    await postDiscordAlert(criticalFindings.map((finding) => `- ${finding.message}`).join('\n'));
    process.exit(1);
  }

  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[ingestor-alert] Unhandled error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
