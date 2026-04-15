import { createClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';

interface AlertFinding {
  level: 'OK' | 'CRITICAL';
  check: 'cycle' | 'offers' | 'results';
  ageMinutes: number | null;
  message: string;
}

const OFFER_THRESHOLD_MINUTES = parseThreshold('INGESTOR_ALERT_OFFERS_THRESHOLD_MINUTES', 30);
const RESULTS_THRESHOLD_MINUTES = parseThreshold('INGESTOR_ALERT_RESULTS_THRESHOLD_MINUTES', 60);
const CYCLE_THRESHOLD_MINUTES = parseThreshold('INGESTOR_ALERT_CYCLE_THRESHOLD_MINUTES', 30);

const env = loadEnvironment();

function parseThreshold(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function evaluateAgeFinding(
  check: AlertFinding['check'],
  isoTimestamp: string | null,
  thresholdMinutes: number,
  status: string | null,
): AlertFinding {
  if (!isoTimestamp) {
    return {
      level: 'CRITICAL',
      check,
      ageMinutes: null,
      message: `No ${check} timestamp found; ingestor ${check} freshness cannot be proven.`,
    };
  }

  const ageMinutes = Math.round((Date.now() - new Date(isoTimestamp).getTime()) / 60_000);
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
      .select('created_at')
      .order('created_at', { ascending: false })
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

  const findings = [
    evaluateAgeFinding('cycle', lastCycle?.started_at ?? null, CYCLE_THRESHOLD_MINUTES, lastCycle?.status ?? null),
    evaluateAgeFinding('offers', lastOffer?.created_at ?? null, OFFER_THRESHOLD_MINUTES, null),
    evaluateAgeFinding('results', lastResult?.created_at ?? null, RESULTS_THRESHOLD_MINUTES, null),
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

main().catch((error) => {
  console.error('[ingestor-alert] Unhandled error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
