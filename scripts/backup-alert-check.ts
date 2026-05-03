import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';

export interface BackupFinding {
  level: 'OK' | 'CRITICAL';
  check: 'daily';
  ageHours: number | null;
  message: string;
}

export function parseBackupThresholdHours(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function evaluateBackupFinding(
  isoTimestamp: string | null,
  thresholdHours: number,
  now = new Date(),
): BackupFinding {
  if (!isoTimestamp) {
    return {
      level: 'CRITICAL',
      check: 'daily',
      ageHours: null,
      message: 'No backup.daily rows found in system_runs — backup has never run or heartbeat was never wired.',
    };
  }

  const ageHours = (now.getTime() - new Date(isoTimestamp).getTime()) / 3_600_000;
  const ageHoursRounded = Math.round(ageHours * 10) / 10;

  if (ageHours > thresholdHours) {
    return {
      level: 'CRITICAL',
      check: 'daily',
      ageHours: ageHoursRounded,
      message: `Backup is ${ageHoursRounded}h old (threshold: ${thresholdHours}h). Last backup may have failed or was skipped.`,
    };
  }

  return {
    level: 'OK',
    check: 'daily',
    ageHours: ageHoursRounded,
    message: `Backup is ${ageHoursRounded}h old (threshold: ${thresholdHours}h).`,
  };
}

function emit(level: BackupFinding['level'], message: string, ageHours: number | null): void {
  console.log(
    JSON.stringify({
      level,
      service: 'backup',
      check: 'daily',
      ageHours,
      message,
      ts: new Date().toISOString(),
    }),
  );
}

async function postDiscordAlert(message: string): Promise<void> {
  const env = loadEnvironment();

  if (env.UNIT_TALK_OPS_ALERT_WEBHOOK_URL) {
    try {
      await fetch(env.UNIT_TALK_OPS_ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `Backup alert\n${message}` }),
      });
    } catch (error) {
      console.error('[backup-alert] Failed to post Discord webhook:', error instanceof Error ? error.message : String(error));
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
      body: JSON.stringify({ content: `Backup alert\n${message}` }),
    });
  } catch (error) {
    console.error('[backup-alert] Failed to post Discord alert:', error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  const env = loadEnvironment();

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[backup-alert] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — cannot check.');
    process.exit(1);
  }

  const thresholdHours = parseBackupThresholdHours(
    process.env['BACKUP_ALERT_THRESHOLD_HOURS'],
    25,
  );

  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: rows } = await db
    .from('system_runs')
    .select('status, started_at, finished_at, details')
    .eq('run_type', 'backup.daily')
    .order('started_at', { ascending: false })
    .limit(1);

  const lastRun = rows?.[0] ?? null;
  const finding = evaluateBackupFinding(
    lastRun?.started_at ?? null,
    thresholdHours,
  );

  emit(finding.level, finding.message, finding.ageHours);

  if (finding.level === 'CRITICAL') {
    await postDiscordAlert(`🚨 ${finding.message}`);
    process.exit(1);
  }

  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[backup-alert] Unhandled error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
