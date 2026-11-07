import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const GRADING_CRON_LIVENESS_PATH =
  '/tmp/unit-talk-grading-cron-liveness';
export const GRADING_CRON_FRESHNESS_MULTIPLIER = 3;

export async function refreshGradingCronLiveness(
  path = GRADING_CRON_LIVENESS_PATH,
  now = Date.now(),
): Promise<void> {
  await writeFile(path, String(now), { mode: 0o600 });
}

export async function isGradingCronFresh(
  path = GRADING_CRON_LIVENESS_PATH,
  pollIntervalMs = 300_000,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) return false;
  try {
    const content = (await readFile(path, 'utf8')).trim();
    const timestamp = Number(content);
    const age = now - timestamp;
    return (
      content.length > 0 &&
      Number.isFinite(timestamp) &&
      age >= 0 &&
      age <= pollIntervalMs * GRADING_CRON_FRESHNESS_MULTIPLIER
    );
  } catch {
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const configuredPoll = Number.parseInt(
    process.env.UNIT_TALK_GRADING_CRON_POLL_MS ?? '',
    10,
  );
  const pollIntervalMs =
    Number.isFinite(configuredPoll) && configuredPoll >= 0
      ? configuredPoll
      : 300_000;
  void isGradingCronFresh(GRADING_CRON_LIVENESS_PATH, pollIntervalMs).then(
    (fresh) => process.exit(fresh ? 0 : 1),
  );
}
