import { pathToFileURL } from 'node:url';
import { loadEnvironment, type AppEnv } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
  type SystemRunRecord,
  type SystemRunRepository,
  type AlertDetectionRecord,
} from '@unit-talk/db';
import { createPrivilegedClient } from '@unit-talk/db/privileged-client-boundary';
import {
  loadAlertAgentConfig,
  runAlertDetectionPass,
  runAlertNotificationPass,
  type AlertNotificationPassOptions,
  type AlertNotificationPassResult,
  type RunAlertDetectionPassResult,
  resolveDiscordChannelId,
} from '@unit-talk/alert-runtime';

export type IngestorAlertCheck =
  | 'cycle'
  | 'offers'
  | 'results'
  | 'alert.detection'
  | 'alert.notification';

export interface AlertFinding {
  level: 'OK' | 'CRITICAL';
  check: IngestorAlertCheck;
  ageMinutes: number | null;
  message: string;
}

export interface AlertMonitorThresholds {
  offers: number;
  results: number;
  cycle: number;
  alertSystem: number;
}

export interface AlertMonitoringSnapshot {
  cycleStartedAt: string | null;
  cycleStatus: string | null;
  mergedCycleUpdatedAt: string | null;
  resultCreatedAt: string | null;
  latestCycleFailure: {
    providerKey: string | null;
    league: string | null;
    stageStatus: string | null;
    freshnessStatus: string | null;
    failureCategory: string;
    failureScope: string | null;
    affectedProviderKey: string | null;
    affectedSportKey: string | null;
    affectedMarketKey: string | null;
    lastError: string | null;
    updatedAt: string | null;
  } | null;
  alertDetectionRun: SystemRunRecord | null;
  alertNotificationRun: SystemRunRecord | null;
}

type AlertPassRepositories = Pick<
  RepositoryBundle,
  'alertDetections' | 'events' | 'providerOffers' | 'runs' | 'audit'
>;

interface AlertPassRunners {
  detection: typeof runAlertDetectionPass;
  notification: typeof runAlertNotificationPass;
}

export interface ScheduledAlertPassOptions {
  environment?: NodeJS.ProcessEnv;
  now?: Date;
  fetchImpl?: typeof fetch;
  sleepImpl?: AlertNotificationPassOptions['sleepImpl'];
  runners?: AlertPassRunners;
}

export interface ScheduledAlertPassResult {
  detection: RunAlertDetectionPassResult;
  notification: AlertNotificationPassResult;
}

export function parseThreshold(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveIngestorAlertThresholds(
  environment: Pick<
    AppEnv,
    | 'UNIT_TALK_APP_ENV'
    | 'UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES'
    | 'INGESTOR_ALERT_OFFERS_THRESHOLD_MINUTES'
    | 'INGESTOR_ALERT_RESULTS_THRESHOLD_MINUTES'
    | 'INGESTOR_ALERT_CYCLE_THRESHOLD_MINUTES'
  > & { ALERT_SYSTEM_STALE_MINUTES?: string | undefined },
  options: { productionCadence?: boolean } = {},
): AlertMonitorThresholds {
  const productionCadence =
    options.productionCadence ?? environment.UNIT_TALK_APP_ENV === 'production';
  const offers = parseThreshold(
    environment.UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES ??
      environment.INGESTOR_ALERT_OFFERS_THRESHOLD_MINUTES,
    productionCadence ? 5 : 30,
  );
  const cycle = parseThreshold(
    environment.INGESTOR_ALERT_CYCLE_THRESHOLD_MINUTES,
    productionCadence ? 5 : 30,
  );

  // The workflow is scheduled `*/5`, but GitHub Actions does not honour that
  // under load: measured gaps across eight consecutive runs were
  // 20/29/36/49/18/24/21 minutes, an effective cadence near 28. Clamping the
  // thresholds to 5 would mark a perfectly healthy system CRITICAL on almost
  // every pass once ingestion resumes, and a monitor that cries wolf is how the
  // last outage stayed invisible for 116 days. The floor is set above the
  // observed worst gap with margin; detection latency against a multi-day
  // outage is unaffected.
  const OBSERVED_SCHEDULER_CADENCE_FLOOR_MINUTES = 60;
  return {
    // Math.max(offers, FLOOR), not Math.max(Math.min(offers, 5), FLOOR): the
    // latter is always exactly FLOOR, which silently disabled the env knob.
    offers: productionCadence ? Math.max(offers, OBSERVED_SCHEDULER_CADENCE_FLOOR_MINUTES) : offers,
    results: parseThreshold(environment.INGESTOR_ALERT_RESULTS_THRESHOLD_MINUTES, 60),
    cycle: productionCadence ? Math.max(cycle, OBSERVED_SCHEDULER_CADENCE_FLOOR_MINUTES) : cycle,
    alertSystem: parseThreshold(environment.ALERT_SYSTEM_STALE_MINUTES, 60),
  };
}

/**
 * Member-facing delivery is opt-in (review thread, PR #1439).
 *
 * `resolveChannels` fans an `alert-worthy` detection to `discord:canary` AND
 * `discord:trader-insights`, a live VIP+ member channel. Enabling real delivery
 * on this scheduled pass therefore turned on member-facing alerts implicitly,
 * as a side effect of restoring monitoring. Member delivery is a separate
 * activation decision and is not authorized.
 *
 * `resolveChannels` lives outside this lane's scope, so the gate is enforced at
 * the delivery boundary the script owns: any Discord message POST to a channel
 * that is not the allow-listed canary target is refused. Fail-closed — an
 * unresolvable canary id blocks every channel rather than defaulting open.
 */
export const MEMBER_CHANNELS_ENABLED_ENV = 'ALERT_MEMBER_CHANNELS_ENABLED';
export const CANARY_TARGET = 'discord:canary';

export function buildChannelGuardedFetch(
  inner: typeof fetch,
  environment: NodeJS.ProcessEnv,
  onBlocked?: (channelId: string) => void,
): typeof fetch {
  if (environment[MEMBER_CHANNELS_ENABLED_ENV] === 'true') return inner;
  const canaryId = resolveDiscordChannelId(CANARY_TARGET, environment);
  const allowed = new Set<string>(canaryId ? [canaryId] : []);
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input);
    const match = /discord\.com\/api\/v\d+\/channels\/(\d+)\/messages/u.exec(url);
    if (match) {
      const channelId = match[1] ?? '';
      if (!allowed.has(channelId)) {
        onBlocked?.(channelId);
        // Refused, not silently dropped: surfaces as a delivery failure the
        // notification pass records, so the block is visible rather than
        // looking like a successful send.
        throw new Error(
          `member-facing delivery is not authorized: refused Discord channel ${channelId}. ` +
            `Set ${MEMBER_CHANNELS_ENABLED_ENV}=true only after a separate activation decision.`,
        );
      }
    }
    return inner(input, init);
  }) as typeof fetch;
}

/**
 * Detections persisted but never delivered must be retried (review thread).
 *
 * When every Discord attempt fails in a pass, the detection stays persisted
 * with `notified=false`. Later passes re-detect the same movement, collide with
 * its idempotency key, and count it as a duplicate — so it never appears in
 * `persistedSignals` again and is never retried once Discord recovers. The
 * alert is lost permanently, silently.
 *
 * Undelivered detections inside the lookback are merged back into each pass,
 * de-duplicated by id so a signal already in this pass is not submitted twice.
 * Only `notified === false` records are retried, so successful deliveries are
 * never repeated.
 */
/**
 * Reduces the resolvable Discord target map to canary only, unless member-facing
 * delivery has been explicitly activated.
 *
 * Note the exact behaviour: this is a canary-only allowlist, not a member-only
 * strip. Every non-canary target is removed, including non-member ones such as
 * `discord:best-bets`. That is deliberate for this scheduled alerting pass,
 * which only ever delivers to canary, and it fails closed for any target added
 * to the map later.
 *
 * This is the primary enforcement point. The delivery loop skips any channel
 * that `resolveDiscordChannelId` cannot resolve (`continue`, no attempt, no
 * retry, no audit row), so making the member target unresolvable costs nothing,
 * whereas refusing it at the transport burns the full retry ladder — four
 * attempts and seven seconds of real sleep per detection — against a channel
 * that can never succeed. With `timeout-minutes: 10`, that is roughly 86
 * alert-worthy detections before the job is killed.
 *
 * `buildChannelGuardedFetch` remains as defence in depth for any path that
 * resolves a channel some other way.
 */
export function applyMemberChannelPolicy(environment: NodeJS.ProcessEnv): {
  removedTargets: string[];
} {
  if (environment[MEMBER_CHANNELS_ENABLED_ENV] === 'true') return { removedTargets: [] };
  const raw = environment.UNIT_TALK_DISCORD_TARGET_MAP?.trim();
  if (!raw) return { removedTargets: [] };
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(raw) as Record<string, string>;
  } catch {
    // Unparseable map: resolveDiscordChannelId already resolves nothing, which
    // is fail-closed. Leave it untouched rather than inventing a map.
    return { removedTargets: [] };
  }
  if (parsed === null || typeof parsed !== 'object') return { removedTargets: [] };
  const removedTargets = Object.keys(parsed).filter((key) => key !== CANARY_TARGET);
  if (removedTargets.length === 0) return { removedTargets: [] };
  const canaryOnly: Record<string, string> = {};
  const canaryValue = parsed[CANARY_TARGET];
  if (canaryValue !== undefined) canaryOnly[CANARY_TARGET] = canaryValue;
  environment.UNIT_TALK_DISCORD_TARGET_MAP = JSON.stringify(canaryOnly);
  return { removedTargets };
}

export function mergeUndeliveredDetections(
  fresh: AlertDetectionRecord[],
  recent: AlertDetectionRecord[],
  now: Date,
  lookbackMinutes: number,
): AlertDetectionRecord[] {
  const seen = new Set(fresh.map((entry) => entry.id));
  const cutoff = now.getTime() - lookbackMinutes * 60_000;
  const retries = recent.filter((entry) => {
    if (seen.has(entry.id)) return false;
    if (entry.notified) return false;
    // `created_at` is when the detection row was persisted, which is the age
    // that matters for "how long has this been sitting undelivered". There is
    // deliberately no cast here: `alert_detections` has no `detected_at`
    // column, and an earlier revision of this function read one, which made
    // every candidate fail Date.parse and silently retried nothing.
    const persistedAt = Date.parse(entry.created_at);
    return Number.isFinite(persistedAt) && persistedAt >= cutoff;
  });
  return [...fresh, ...retries];
}

function timestampAgeMinutes(isoTimestamp: string, now: Date): number | null {
  const timestamp = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestamp)) return null;
  return Math.round((now.getTime() - timestamp) / 60_000);
}

export function evaluateAgeFinding(
  check: Extract<IngestorAlertCheck, 'cycle' | 'offers' | 'results'>,
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

  const ageMinutes = timestampAgeMinutes(isoTimestamp, now);
  if (ageMinutes === null || ageMinutes < 0) {
    return {
      level: 'CRITICAL',
      check,
      ageMinutes,
      message: `Invalid ${check} timestamp ${isoTimestamp}; ingestor ${check} freshness cannot be proven.`,
    };
  }

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

function runFailureCount(run: SystemRunRecord): number {
  if (!run.details || typeof run.details !== 'object' || Array.isArray(run.details)) return 0;
  const failed = run.details['failed'];
  return typeof failed === 'number' && Number.isFinite(failed) ? failed : 0;
}

export function evaluateAlertRunFinding(
  runType: 'alert.detection' | 'alert.notification',
  run: SystemRunRecord | null,
  thresholdMinutes: number,
  now = new Date(),
): AlertFinding {
  if (!run) {
    return {
      level: 'CRITICAL',
      check: runType,
      ageMinutes: null,
      message: `No ${runType} run found; alerting silence cannot be distinguished from health.`,
    };
  }

  const ageMinutes = timestampAgeMinutes(run.started_at, now);
  if (ageMinutes === null || ageMinutes < 0) {
    return {
      level: 'CRITICAL',
      check: runType,
      ageMinutes,
      message: `${runType} has an invalid started_at timestamp (${run.started_at}).`,
    };
  }

  if (run.status !== 'succeeded') {
    return {
      level: 'CRITICAL',
      check: runType,
      ageMinutes,
      message: `Latest ${runType} run is ${run.status}, not succeeded (started ${ageMinutes}m ago).`,
    };
  }

  const failed = runFailureCount(run);
  if (failed > 0) {
    return {
      level: 'CRITICAL',
      check: runType,
      ageMinutes,
      message: `Latest ${runType} run recorded ${failed} failed notification attempt(s).`,
    };
  }

  if (ageMinutes > thresholdMinutes) {
    return {
      level: 'CRITICAL',
      check: runType,
      ageMinutes,
      message: `${runType} last succeeded ${ageMinutes}m ago (threshold: ${thresholdMinutes}m).`,
    };
  }

  return {
    level: 'OK',
    check: runType,
    ageMinutes,
    message: `${runType} last succeeded ${ageMinutes}m ago (threshold: ${thresholdMinutes}m).`,
  };
}

export function evaluateMonitoringSnapshot(
  snapshot: AlertMonitoringSnapshot,
  thresholds: AlertMonitorThresholds,
  now = new Date(),
): AlertFinding[] {
  const findings = [
    evaluateAgeFinding('cycle', snapshot.cycleStartedAt, thresholds.cycle, snapshot.cycleStatus, now),
    evaluateAgeFinding('offers', snapshot.mergedCycleUpdatedAt, thresholds.offers, null, now),
    evaluateAgeFinding('results', snapshot.resultCreatedAt, thresholds.results, null, now),
    evaluateAlertRunFinding('alert.detection', snapshot.alertDetectionRun, thresholds.alertSystem, now),
    evaluateAlertRunFinding('alert.notification', snapshot.alertNotificationRun, thresholds.alertSystem, now),
  ];

  if (snapshot.latestCycleFailure) {
    const failure = snapshot.latestCycleFailure;
    const affected = [
      failure.affectedProviderKey ?? failure.providerKey,
      failure.affectedSportKey ?? failure.league,
      failure.affectedMarketKey,
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join('/');
    findings.push({
      level: 'CRITICAL',
      check: 'cycle',
      ageMinutes: failure.updatedAt ? timestampAgeMinutes(failure.updatedAt, now) : null,
      message: `Latest provider cycle failure category=${failure.failureCategory} scope=${failure.failureScope ?? 'cycle'} affected=${affected || 'n/a'} stage=${failure.stageStatus ?? 'unknown'} freshness=${failure.freshnessStatus ?? 'unknown'}. ${failure.lastError ?? ''}`.trim(),
    });
  }

  return findings;
}

export function unknownMonitorFinding(error: unknown): AlertFinding {
  return {
    level: 'CRITICAL',
    check: 'cycle',
    ageMinutes: null,
    message: `Ingestor and alert-system monitor is UNKNOWN: ${error instanceof Error ? error.message : String(error)}`,
  };
}

export async function notifyCriticalFindings(
  findings: readonly AlertFinding[],
  notify: (message: string) => Promise<void>,
): Promise<number> {
  const criticalFindings = findings.filter((finding) => finding.level === 'CRITICAL');
  if (criticalFindings.length === 0) return 0;
  await notify(criticalFindings.map((finding) => `- ${finding.message}`).join('\n'));
  return criticalFindings.length;
}

export async function runScheduledAlertPass(
  repositories: AlertPassRepositories,
  options: ScheduledAlertPassOptions = {},
): Promise<ScheduledAlertPassResult> {
  const environment = options.environment ?? process.env;
  const config = loadAlertAgentConfig(environment);
  if (!config.enabled) {
    throw new Error('ALERT_AGENT_ENABLED=false; scheduled alert detection is disabled.');
  }

  const runners = options.runners ?? {
    detection: runAlertDetectionPass,
    notification: runAlertNotificationPass,
  };
  const now = options.now ?? new Date();
  const detection = await runners.detection(repositories, {
    ...config,
    enabled: true,
    now: now.toISOString(),
  });
  // Retry anything persisted but never delivered, then gate delivery to canary.
  let submittedSignals = detection.persistedSignals;
  let retriedCount = 0;
  try {
    // listRecent orders by current_snapshot_at DESC with no `notified` filter, so
    // the limit truncates BEFORE the age cutoff is applied. Too small a limit
    // would silently drop an undelivered alert behind newer delivered ones --
    // the same failure mode as reading a column that does not exist. Production
    // currently holds 176 undelivered rows, so 200 was uncomfortably close.
    const recent = await repositories.alertDetections.listRecent(2000, undefined);
    const merged = mergeUndeliveredDetections(detection.persistedSignals, recent, now, 240);
    retriedCount = merged.length - detection.persistedSignals.length;
    submittedSignals = merged;
  } catch {
    // A retry-lookup failure must never suppress this pass's own alerts.
    submittedSignals = detection.persistedSignals;
  }
  // Primary enforcement: make member targets unresolvable so the delivery loop
  // skips them for free. resolveDiscordChannelId reads process.env directly, so
  // the policy must be applied there for production to be covered.
  // The mutation is global and must be undone: apps/api and apps/worker read
  // process.env.UNIT_TALK_DISCORD_TARGET_MAP directly, so leaving a canary-only
  // map behind would silently stop their Discord delivery if this ever runs
  // inside a long-lived process rather than this one-shot CI job.
  const originalTargetMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  const originalInjectedMap = environment.UNIT_TALK_DISCORD_TARGET_MAP;
  const memberPolicy = applyMemberChannelPolicy(process.env);
  const restoreTargetMap = (): void => {
    if (originalTargetMap === undefined) delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    else process.env.UNIT_TALK_DISCORD_TARGET_MAP = originalTargetMap;
    if (environment !== process.env) {
      if (originalInjectedMap === undefined) delete environment.UNIT_TALK_DISCORD_TARGET_MAP;
      else environment.UNIT_TALK_DISCORD_TARGET_MAP = originalInjectedMap;
    }
  };
  // Defence in depth. Counts DISTINCT refused channels, not retry attempts, so
  // the recorded number matches what a reader would expect.
  const blockedChannels = new Set<string>();
  const guardedFetch = buildChannelGuardedFetch(
    options.fetchImpl ?? fetch,
    process.env,
    (channelId) => { blockedChannels.add(channelId); },
  );

  // Everything from here down runs inside try/finally: startRun itself is an
  // await that can throw (a Supabase blip on the system_runs insert), and a
  // throw there would otherwise skip the restore and leave a canary-only map
  // behind for the rest of the process.
  try {
  // Inside the try: a caller-injected environment object can be frozen, sealed
  // or proxied, so this write can throw. Before the try it would have leaked the
  // already-mutated process.env map. Unreachable in production -- main() passes
  // no options.environment -- but the restore should not depend on that.
  if (environment !== process.env) applyMemberChannelPolicy(environment);
  const notificationRun = await repositories.runs.startRun({
    runType: 'alert.notification',
    details: {
      signalCount: submittedSignals.length,
      freshCount: detection.persistedSignals.length,
      retriedUndelivered: retriedCount,
    },
  });
  let notification: AlertNotificationPassResult;
  try {
    notification = await runners.notification(
      submittedSignals,
      repositories.alertDetections,
      {
        dryRun: config.dryRun,
        now,
        fetchImpl: guardedFetch,
        sleepImpl: options.sleepImpl,
        audit: repositories.audit,
      },
    );
  } catch (error: unknown) {
    await repositories.runs.completeRun({
      runId: notificationRun.id,
      status: 'failed',
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
  await repositories.runs.completeRun({
    runId: notificationRun.id,
    status: notification.failed > 0 ? 'failed' : 'succeeded',
    // Refused member-facing deliveries are recorded so the policy leaves a
    // durable trace rather than only an audit row per retry attempt.
    details: {
      ...notification,
      // Member targets removed from the resolvable map before delivery.
      memberTargetsWithheld: memberPolicy.removedTargets,
      // Non-zero only if something resolved a member channel another way.
      blockedMemberChannels: blockedChannels.size,
    },
  });

  if (notification.failed > 0) {
    throw new Error(`Alert notification pass recorded ${notification.failed} failed delivery attempt(s).`);
  }

  return { detection, notification };
  } finally {
    restoreTargetMap();
  }
}

function emit(finding: AlertFinding) {
  console.log(
    JSON.stringify({
      level: finding.level,
      service: 'ingestor-alert-monitor',
      check: finding.check,
      ageMinutes: finding.ageMinutes,
      message: finding.message,
      ts: new Date().toISOString(),
    }),
  );
}

async function postOpsAlert(
  message: string,
  environment: Pick<
    AppEnv,
    'UNIT_TALK_OPS_ALERT_WEBHOOK_URL' | 'UNIT_TALK_DISCORD_TARGET_MAP' | 'DISCORD_BOT_TOKEN'
  >,
  fetchImpl: typeof fetch = fetch,
) {
  if (environment.UNIT_TALK_OPS_ALERT_WEBHOOK_URL) {
    const response = await fetchImpl(environment.UNIT_TALK_OPS_ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `Unit Talk monitor alert\n${message}` }),
    });
    if (!response.ok) {
      throw new Error(`Operations webhook returned ${response.status}.`);
    }
    return;
  }

  const channelId = environment.UNIT_TALK_DISCORD_TARGET_MAP
    ? (() => {
        try {
          const map = JSON.parse(environment.UNIT_TALK_DISCORD_TARGET_MAP) as Record<string, string>;
          return map['discord:canary'];
        } catch {
          return undefined;
        }
      })()
    : undefined;

  if (!channelId || !environment.DISCORD_BOT_TOKEN) {
    throw new Error('No operations alert delivery target is configured.');
  }

  const response = await fetchImpl(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${environment.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: `Unit Talk monitor alert\n${message}` }),
  });
  if (!response.ok) {
    throw new Error(`Discord operations alert returned ${response.status}.`);
  }
}

function assertQuerySucceeded(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label} query failed: ${error.message}`);
}

async function collectMonitoringSnapshot(
  environment: AppEnv,
  runs: SystemRunRepository,
): Promise<AlertMonitoringSnapshot> {
  const db = createPrivilegedClient(
    environment.SUPABASE_URL as string,
    environment.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false } },
  );
  const [cycleResponse, mergedCycleResponse, resultResponse, cycleStatusResponse, detectionRuns, notificationRuns] =
    await Promise.all([
      db
        .from('system_runs')
        .select('status, started_at')
        .eq('run_type', 'ingestor.cycle')
        .order('started_at', { ascending: false })
        .limit(1),
      db
        .from('provider_cycle_status')
        .select('updated_at')
        .eq('stage_status', 'merged')
        .order('updated_at', { ascending: false })
        .limit(1),
      db.from('game_results').select('created_at').order('created_at', { ascending: false }).limit(1),
      db
        .from('provider_cycle_status')
        .select(
          'provider_key,league,stage_status,freshness_status,failure_category,failure_scope,affected_provider_key,affected_sport_key,affected_market_key,last_error,updated_at',
        )
        .order('updated_at', { ascending: false })
        .limit(1),
      runs.listByType('alert.detection', 1),
      runs.listByType('alert.notification', 1),
    ]);

  assertQuerySucceeded('system_runs ingestor freshness', cycleResponse.error);
  assertQuerySucceeded('provider_cycle_status merged freshness', mergedCycleResponse.error);
  assertQuerySucceeded('game_results freshness', resultResponse.error);
  assertQuerySucceeded('provider_cycle_status failure state', cycleStatusResponse.error);

  const lastCycle = cycleResponse.data?.[0] ?? null;
  const lastMergedCycle = mergedCycleResponse.data?.[0] ?? null;
  const lastResult = resultResponse.data?.[0] ?? null;
  const latestCycleStatus = cycleStatusResponse.data?.[0] ?? null;

  return {
    cycleStartedAt: lastCycle?.started_at ?? null,
    cycleStatus: lastCycle?.status ?? null,
    mergedCycleUpdatedAt: lastMergedCycle?.updated_at ?? null,
    resultCreatedAt: lastResult?.created_at ?? null,
    latestCycleFailure: latestCycleStatus?.failure_category
      ? {
          providerKey: latestCycleStatus.provider_key ?? null,
          league: latestCycleStatus.league ?? null,
          stageStatus: latestCycleStatus.stage_status ?? null,
          freshnessStatus: latestCycleStatus.freshness_status ?? null,
          failureCategory: latestCycleStatus.failure_category,
          failureScope: latestCycleStatus.failure_scope ?? null,
          affectedProviderKey: latestCycleStatus.affected_provider_key ?? null,
          affectedSportKey: latestCycleStatus.affected_sport_key ?? null,
          affectedMarketKey: latestCycleStatus.affected_market_key ?? null,
          lastError: latestCycleStatus.last_error ?? null,
          updatedAt: latestCycleStatus.updated_at ?? null,
        }
      : null,
    alertDetectionRun: detectionRuns[0] ?? null,
    alertNotificationRun: notificationRuns[0] ?? null,
  };
}

async function runMonitor(environment: AppEnv, repositories: AlertPassRepositories) {
  const snapshot = await collectMonitoringSnapshot(environment, repositories.runs);
  const productionCadence =
    process.argv.includes('--production-cadence') || environment.UNIT_TALK_APP_ENV === 'production';
  const thresholds = resolveIngestorAlertThresholds(
    {
      ...environment,
      ALERT_SYSTEM_STALE_MINUTES: process.env.ALERT_SYSTEM_STALE_MINUTES,
    },
    { productionCadence },
  );
  const findings = evaluateMonitoringSnapshot(snapshot, thresholds);
  for (const finding of findings) emit(finding);
  return notifyCriticalFindings(findings, (message) => postOpsAlert(message, environment));
}

async function main() {
  const environment = loadEnvironment();
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; checks are unreachable.');
  }

  const connection = createServiceRoleDatabaseConnectionConfig(environment);
  const repositories = createDatabaseRepositoryBundle(connection);

  if (process.argv.includes('--run-alerting-pass')) {
    // Pass the LOADED environment, not process.env. loadEnvironment() merges
    // local.env > .env > .env.example; omitting it here made the pass fall back
    // to process.env, so a file-configured ALERT_AGENT_ENABLED=false was ignored
    // and detection still ran and wrote to the database. The documented way to
    // disable the agent must actually disable it.
    const result = await runScheduledAlertPass(repositories, {
      environment: environment as unknown as NodeJS.ProcessEnv,
    });
    console.log(
      JSON.stringify({
        service: 'alert-agent-scheduled-pass',
        status: 'succeeded',
        detection: {
          evaluatedGroups: result.detection.evaluatedGroups,
          detections: result.detection.detections,
          persisted: result.detection.persisted,
          duplicateSignals: result.detection.duplicateSignals,
        },
        notification: result.notification,
      }),
    );
    return 0;
  }

  const criticalCount = await runMonitor(environment, repositories);
  return criticalCount > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(async (error: unknown) => {
      const finding = unknownMonitorFinding(error);
      emit(finding);
      try {
        await postOpsAlert(finding.message, loadEnvironment());
      } catch (deliveryError: unknown) {
        console.error(
          '[ingestor-alert] Failed to deliver UNKNOWN monitor alert:',
          deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
        );
      }
      process.exitCode = 1;
    });
}
