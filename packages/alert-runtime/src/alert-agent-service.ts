import { createHash } from 'node:crypto';
import type {
  AlertDetectionCreateInput,
  AlertDetectionMarketType,
  AlertDetectionRecord,
  AlertDetectionRepository,
  AlertDetectionTier,
  EventRepository,
  ProviderOfferRecord,
  ProviderOfferRepository,
  SystemRunRepository,
} from '@unit-talk/db';

const DEFAULT_LOOKBACK_MINUTES = 60;
const IDENTITY_BUCKET_MS = 5 * 60 * 1000;
export const ACTIVE_ALERT_SPORTS = ['NBA', 'NHL', 'MLB'] as const;
export const SYSTEM_PICK_ELIGIBLE_MARKET_TYPES = ['moneyline', 'spread', 'total'] as const;
export const SYSTEM_PICK_BLOCKED_MARKET_TYPES = ['player_prop'] as const;
const ACTIVE_ALERT_SPORT_SET: ReadonlySet<string> = new Set(ACTIVE_ALERT_SPORTS);
const DEFAULT_ALERT_VELOCITY_WINDOW_MINUTES = 15;
const DEFAULT_ALERT_STEAM_MIN_BOOKS = 3;
const DEFAULT_ALERT_STEAM_WINDOW_MINUTES = 10;

const tierRank: Record<AlertDetectionTier, number> = {
  watch: 1,
  notable: 2,
  'alert-worthy': 3,
};

export interface AlertMarketThresholds {
  watch: number;
  notable: number;
  alertWorthy: number;
  velocityElevate: number;
}

export interface AlertThresholdConfig {
  markets: Record<AlertDetectionMarketType, AlertMarketThresholds>;
  velocityWindowMinutes: number;
  steamMinBooks: number;
  steamWindowMinutes: number;
}

const DEFAULT_ALERT_THRESHOLDS: Record<
  AlertDetectionMarketType,
  AlertMarketThresholds
> = {
  spread: { watch: 0.5, notable: 2.0, alertWorthy: 3.5, velocityElevate: 0.5 },
  total: { watch: 0.5, notable: 1.5, alertWorthy: 3.0, velocityElevate: 0.5 },
  moneyline: { watch: 5, notable: 10, alertWorthy: 20, velocityElevate: 10 },
  player_prop: { watch: 0.25, notable: 0.5, alertWorthy: 1.5, velocityElevate: 0.25 },
};

export interface LineMovementDetection {
  providerEventId: string;
  participantId: string | null;
  marketKey: string;
  bookmakerKey: string;
  marketType: AlertDetectionMarketType;
  baselineSnapshotAt: string;
  currentSnapshotAt: string;
  oldLine: number;
  newLine: number;
  lineChange: number;
  lineChangeAbs: number;
  velocity: number | null;
  timeElapsedMinutes: number;
  direction: 'up' | 'down';
  metadata: Record<string, unknown>;
}

export interface AlertSignal extends LineMovementDetection {
  tier: AlertDetectionTier;
}

export interface AlertAgentConfig {
  enabled: boolean;
  lookbackMinutes: number;
  dryRun: boolean;
  minTier: AlertDetectionTier;
  thresholds: AlertThresholdConfig;
  now?: string;
}

export interface RunAlertDetectionPassResult {
  evaluatedGroups: number;
  detections: number;
  persisted: number;
  duplicateSignals: number;
  belowMinTier: number;
  unresolvedEvents: number;
  shouldNotifyCount: number;
  persistedSignals: AlertDetectionRecord[];
  disabledSportCount: number;
}

export function loadAlertAgentConfig(env: NodeJS.ProcessEnv = process.env): AlertAgentConfig {
  return {
    enabled: env.ALERT_AGENT_ENABLED !== 'false',
    lookbackMinutes: normalizePositiveInteger(
      env.ALERT_LOOKBACK_MINUTES,
      DEFAULT_LOOKBACK_MINUTES,
    ),
    dryRun: env.ALERT_DRY_RUN !== 'false',
    minTier: normalizeTier(env.ALERT_MIN_TIER),
    thresholds: loadAlertThresholds(env),
  };
}

export function loadAlertThresholds(
  env: NodeJS.ProcessEnv = process.env,
): AlertThresholdConfig {
  return {
    markets: {
      spread: {
        watch: normalizePositiveNumber(env.ALERT_THRESHOLD_SPREAD_WATCH, DEFAULT_ALERT_THRESHOLDS.spread.watch, 'ALERT_THRESHOLD_SPREAD_WATCH'),
        notable: normalizePositiveNumber(env.ALERT_THRESHOLD_SPREAD_NOTABLE, DEFAULT_ALERT_THRESHOLDS.spread.notable, 'ALERT_THRESHOLD_SPREAD_NOTABLE'),
        alertWorthy: normalizePositiveNumber(env.ALERT_THRESHOLD_SPREAD_ALERT_WORTHY, DEFAULT_ALERT_THRESHOLDS.spread.alertWorthy, 'ALERT_THRESHOLD_SPREAD_ALERT_WORTHY'),
        velocityElevate: normalizePositiveNumber(env.ALERT_THRESHOLD_SPREAD_VELOCITY, DEFAULT_ALERT_THRESHOLDS.spread.velocityElevate, 'ALERT_THRESHOLD_SPREAD_VELOCITY'),
      },
      total: {
        watch: normalizePositiveNumber(env.ALERT_THRESHOLD_TOTAL_WATCH, DEFAULT_ALERT_THRESHOLDS.total.watch, 'ALERT_THRESHOLD_TOTAL_WATCH'),
        notable: normalizePositiveNumber(env.ALERT_THRESHOLD_TOTAL_NOTABLE, DEFAULT_ALERT_THRESHOLDS.total.notable, 'ALERT_THRESHOLD_TOTAL_NOTABLE'),
        alertWorthy: normalizePositiveNumber(env.ALERT_THRESHOLD_TOTAL_ALERT_WORTHY, DEFAULT_ALERT_THRESHOLDS.total.alertWorthy, 'ALERT_THRESHOLD_TOTAL_ALERT_WORTHY'),
        velocityElevate: normalizePositiveNumber(env.ALERT_THRESHOLD_TOTAL_VELOCITY, DEFAULT_ALERT_THRESHOLDS.total.velocityElevate, 'ALERT_THRESHOLD_TOTAL_VELOCITY'),
      },
      moneyline: {
        watch: normalizePositiveNumber(env.ALERT_THRESHOLD_ML_WATCH, DEFAULT_ALERT_THRESHOLDS.moneyline.watch, 'ALERT_THRESHOLD_ML_WATCH'),
        notable: normalizePositiveNumber(env.ALERT_THRESHOLD_ML_NOTABLE, DEFAULT_ALERT_THRESHOLDS.moneyline.notable, 'ALERT_THRESHOLD_ML_NOTABLE'),
        alertWorthy: normalizePositiveNumber(env.ALERT_THRESHOLD_ML_ALERT_WORTHY, DEFAULT_ALERT_THRESHOLDS.moneyline.alertWorthy, 'ALERT_THRESHOLD_ML_ALERT_WORTHY'),
        velocityElevate: normalizePositiveNumber(env.ALERT_THRESHOLD_ML_VELOCITY, DEFAULT_ALERT_THRESHOLDS.moneyline.velocityElevate, 'ALERT_THRESHOLD_ML_VELOCITY'),
      },
      player_prop: {
        watch: normalizePositiveNumber(env.ALERT_THRESHOLD_PROP_WATCH, DEFAULT_ALERT_THRESHOLDS.player_prop.watch, 'ALERT_THRESHOLD_PROP_WATCH'),
        notable: normalizePositiveNumber(env.ALERT_THRESHOLD_PROP_NOTABLE, DEFAULT_ALERT_THRESHOLDS.player_prop.notable, 'ALERT_THRESHOLD_PROP_NOTABLE'),
        alertWorthy: normalizePositiveNumber(env.ALERT_THRESHOLD_PROP_ALERT_WORTHY, DEFAULT_ALERT_THRESHOLDS.player_prop.alertWorthy, 'ALERT_THRESHOLD_PROP_ALERT_WORTHY'),
        velocityElevate: normalizePositiveNumber(env.ALERT_THRESHOLD_PROP_VELOCITY, DEFAULT_ALERT_THRESHOLDS.player_prop.velocityElevate, 'ALERT_THRESHOLD_PROP_VELOCITY'),
      },
    },
    velocityWindowMinutes: normalizePositiveNumber(
      env.ALERT_VELOCITY_WINDOW_MINUTES,
      DEFAULT_ALERT_VELOCITY_WINDOW_MINUTES,
      'ALERT_VELOCITY_WINDOW_MINUTES',
    ),
    steamMinBooks: normalizePositiveInteger(
      env.ALERT_STEAM_MIN_BOOKS,
      DEFAULT_ALERT_STEAM_MIN_BOOKS,
    ),
    steamWindowMinutes: normalizePositiveInteger(
      env.ALERT_STEAM_WINDOW_MINUTES,
      DEFAULT_ALERT_STEAM_WINDOW_MINUTES,
    ),
  };
}

export function detectLineMovement(
  currentOffer: ProviderOfferRecord,
  baselineOffer: ProviderOfferRecord,
): LineMovementDetection | null {
  if (
    currentOffer.provider_event_id !== baselineOffer.provider_event_id ||
    currentOffer.provider_market_key !== baselineOffer.provider_market_key ||
    currentOffer.provider_key !== baselineOffer.provider_key ||
    (currentOffer.provider_participant_id ?? null) !==
      (baselineOffer.provider_participant_id ?? null)
  ) {
    return null;
  }

  const marketType = classifyMarketType(currentOffer.provider_market_key);
  const timeElapsedMinutes = computeTimeElapsedMinutes(
    baselineOffer.snapshot_at,
    currentOffer.snapshot_at,
  );

  if (marketType === 'moneyline') {
    const dominantSide = pickDominantMoneylineSide(currentOffer, baselineOffer);
    if (!dominantSide) {
      return null;
    }

    const lineChange = dominantSide.current - dominantSide.baseline;
    const lineChangeAbs = Math.abs(lineChange);
    return {
      providerEventId: currentOffer.provider_event_id,
      participantId: currentOffer.provider_participant_id,
      marketKey: currentOffer.provider_market_key,
      bookmakerKey: currentOffer.provider_key,
      marketType,
      baselineSnapshotAt: baselineOffer.snapshot_at,
      currentSnapshotAt: currentOffer.snapshot_at,
      oldLine: dominantSide.baseline,
      newLine: dominantSide.current,
      lineChange,
      lineChangeAbs,
      velocity:
        timeElapsedMinutes > 0 ? roundTo(lineChangeAbs / Math.max(timeElapsedMinutes, 1), 4) : null,
      timeElapsedMinutes,
      direction: lineChange >= 0 ? 'up' : 'down',
      metadata: {
        dominantSide: dominantSide.side,
        participantId: currentOffer.provider_participant_id,
        sport: currentOffer.sport_key,
      },
    };
  }

  if (!Number.isFinite(currentOffer.line) || !Number.isFinite(baselineOffer.line)) {
    return null;
  }

  const oldLine = baselineOffer.line as number;
  const newLine = currentOffer.line as number;
  const lineChange = roundTo(newLine - oldLine, 4);
  const lineChangeAbs = Math.abs(lineChange);

  return {
    providerEventId: currentOffer.provider_event_id,
    participantId: currentOffer.provider_participant_id,
    marketKey: currentOffer.provider_market_key,
    bookmakerKey: currentOffer.provider_key,
    marketType,
    baselineSnapshotAt: baselineOffer.snapshot_at,
    currentSnapshotAt: currentOffer.snapshot_at,
    oldLine,
    newLine,
    lineChange,
    lineChangeAbs,
    velocity:
      timeElapsedMinutes > 0 ? roundTo(lineChangeAbs / Math.max(timeElapsedMinutes, 1), 4) : null,
    timeElapsedMinutes,
    direction: lineChange >= 0 ? 'up' : 'down',
    metadata: {
      participantId: currentOffer.provider_participant_id,
      sport: currentOffer.sport_key,
    },
  };
}

export function classifyMovement(
  detection: LineMovementDetection,
  thresholdsConfig: AlertThresholdConfig = {
    markets: DEFAULT_ALERT_THRESHOLDS,
    velocityWindowMinutes: DEFAULT_ALERT_VELOCITY_WINDOW_MINUTES,
    steamMinBooks: DEFAULT_ALERT_STEAM_MIN_BOOKS,
    steamWindowMinutes: DEFAULT_ALERT_STEAM_WINDOW_MINUTES,
  },
): AlertSignal | null {
  const thresholds = thresholdsConfig.markets[detection.marketType];
  let tier: AlertDetectionTier | null = null;

  if (detection.lineChangeAbs >= thresholds.alertWorthy) {
    tier = 'alert-worthy';
  } else if (detection.lineChangeAbs >= thresholds.notable) {
    tier = 'notable';
  } else if (detection.lineChangeAbs >= thresholds.watch) {
    tier = 'watch';
  }

  if (!tier) {
    return null;
  }

  const velocityElevated =
    tier === 'notable' &&
    detection.timeElapsedMinutes <= thresholdsConfig.velocityWindowMinutes &&
    detection.lineChangeAbs >= thresholds.velocityElevate;

  return {
    ...detection,
    tier: velocityElevated ? 'alert-worthy' : tier,
    metadata: {
      ...detection.metadata,
      velocityElevated,
    },
  };
}

export async function shouldNotify(
  signal: AlertSignal,
  repository: AlertDetectionRepository,
  options: { eventId: string; now?: string } = { eventId: '' },
): Promise<boolean> {
  if (signal.tier === 'watch') {
    return false;
  }

  const eventId = options.eventId;
  if (!eventId) {
    throw new Error('eventId is required to evaluate alert cooldowns');
  }

  const now = options.now ?? new Date().toISOString();
  const activeCooldown = await repository.findActiveCooldown({
    eventId,
    marketKey: signal.marketKey,
    bookmakerKey: signal.bookmakerKey,
    participantId: signal.participantId,
    tier: signal.tier,
    now,
  });

  return activeCooldown === null;
}

export async function runAlertDetectionPass(
  repositories: Pick<
    {
      providerOffers: ProviderOfferRepository;
      alertDetections: AlertDetectionRepository;
      events: EventRepository;
      runs: SystemRunRepository;
    },
    'alertDetections' | 'events' | 'providerOffers' | 'runs'
  >,
  config: Partial<AlertAgentConfig> = {},
): Promise<RunAlertDetectionPassResult> {
  const resolved = {
    ...loadAlertAgentConfig(),
    ...config,
  };

  if (!resolved.enabled) {
    return {
      evaluatedGroups: 0,
      detections: 0,
      persisted: 0,
      duplicateSignals: 0,
      belowMinTier: 0,
      unresolvedEvents: 0,
      shouldNotifyCount: 0,
      persistedSignals: [],
      disabledSportCount: 0,
    };
  }

  const run = await repositories.runs.startRun({
    runType: 'alert.detection',
    details: {},
  });

  const nowIso = resolved.now ?? new Date().toISOString();
  const firstMoverWindowStartIso = new Date(
    Date.parse(nowIso) - resolved.lookbackMinutes * 60 * 1000,
  ).toISOString();
  // Use 2x lookback so baseline offers (within lookbackMinutes of the current
  // offer, not of now) are included. This is still bounded and far better than
  // a full-table scan.
  const fetchWindowMs = resolved.lookbackMinutes * 2 * 60 * 1000;
  const sinceIso = new Date(Date.parse(nowIso) - fetchWindowMs).toISOString();
  const offers = await repositories.providerOffers.listRecentOffers(sinceIso);
  const offerGroups = groupOffersByTuple(offers);
  const persistedSignals: AlertDetectionRecord[] = [];
  let detections = 0;
  let persisted = 0;
  let duplicateSignals = 0;
  let belowMinTier = 0;
  let unresolvedEvents = 0;
  let shouldNotifyCount = 0;
  let disabledSportCount = 0;

  for (const group of offerGroups.values()) {
    const currentOffer = selectCurrentOffer(group, nowIso);
    if (!currentOffer) {
      continue;
    }

    const baselineOffer = selectBaselineOffer(group, currentOffer, resolved.lookbackMinutes);
    if (!baselineOffer) {
      continue;
    }

    const detection = detectLineMovement(currentOffer, baselineOffer);
    if (!detection) {
      continue;
    }

    const signal = classifyMovement(detection, resolved.thresholds);
    if (!signal) {
      continue;
    }

    detections += 1;

    if (tierRank[signal.tier] < tierRank[resolved.minTier]) {
      belowMinTier += 1;
      continue;
    }

    const event = await repositories.events.findByExternalId(signal.providerEventId);
    if (!event) {
      unresolvedEvents += 1;
      continue;
    }

    if (!isAlertSportActive(event.sport_id)) {
      disabledSportCount += 1;
      continue;
    }

    const idempotencyKey = buildIdempotencyKey(event.id, signal);
    const firstMoverBook =
      (await repositories.alertDetections.findFirstMoverBook(
        event.id,
        signal.marketKey,
        firstMoverWindowStartIso,
      )) ?? signal.bookmakerKey;
    const created = await repositories.alertDetections.saveDetection(
      buildAlertDetectionCreateInput(event.id, signal, idempotencyKey, firstMoverBook),
    );
    if (!created) {
      duplicateSignals += 1;
      continue;
    }

    const steamUpdated = await markSteamIfNeeded(
      repositories.alertDetections,
      created,
      resolved.thresholds.steamWindowMinutes,
      resolved.thresholds.steamMinBooks,
    );
    const persistedSignal = steamUpdated.get(created.id) ?? created;

    persisted += 1;
    persistedSignals.push(persistedSignal);
    if (await shouldNotify(signal, repositories.alertDetections, { eventId: event.id, now: nowIso })) {
      shouldNotifyCount += 1;
    }
  }

  const alertWorthy = persistedSignals.filter((s) => s.tier === 'alert-worthy').length;
  const notable = persistedSignals.filter((s) => s.tier === 'notable').length;
  const watch = persistedSignals.filter((s) => s.tier === 'watch').length;

  await repositories.runs.completeRun({
    runId: run.id,
    status: 'succeeded',
    details: {
      signalsFound: detections,
      alertWorthy,
      notable,
      watch,
      disabledSportCount,
    },
  });

  return {
    evaluatedGroups: offerGroups.size,
    detections,
    persisted,
    duplicateSignals,
    belowMinTier,
    unresolvedEvents,
    shouldNotifyCount,
    persistedSignals,
    disabledSportCount,
  };
}

export function isAlertSportActive(sport: string | null | undefined) {
  return typeof sport === 'string' && ACTIVE_ALERT_SPORT_SET.has(sport.trim().toUpperCase());
}

function buildAlertDetectionCreateInput(
  eventId: string,
  signal: AlertSignal,
  idempotencyKey: string,
  firstMoverBook: string,
): AlertDetectionCreateInput {
  return {
    idempotencyKey,
    eventId,
    participantId: signal.participantId,
    marketKey: signal.marketKey,
    bookmakerKey: signal.bookmakerKey,
    firstMoverBook,
    baselineSnapshotAt: signal.baselineSnapshotAt,
    currentSnapshotAt: signal.currentSnapshotAt,
    oldLine: signal.oldLine,
    newLine: signal.newLine,
    lineChange: signal.lineChange,
    lineChangeAbs: signal.lineChangeAbs,
    velocity: signal.velocity,
    timeElapsedMinutes: signal.timeElapsedMinutes,
    direction: signal.direction,
    marketType: signal.marketType,
    tier: signal.tier,
    metadata: signal.metadata,
  };
}

async function markSteamIfNeeded(
  repository: AlertDetectionRepository,
  created: AlertDetectionRecord,
  steamWindowMinutes: number,
  steamMinBooks: number,
) {
  const since = new Date(
    Date.parse(created.current_snapshot_at) - steamWindowMinutes * 60 * 1000,
  ).toISOString();
  const candidates = await repository.findRecentByEventMarketDirection(
    created.event_id,
    created.market_key,
    created.direction as 'up' | 'down',
    since,
  );

  const uniqueBooks = new Set(candidates.map((candidate) => candidate.bookmaker_key));
  if (uniqueBooks.size < steamMinBooks) {
    return new Map<string, AlertDetectionRecord>();
  }

  return repository.markSteamDetected(
    candidates.map((candidate) => candidate.id),
    uniqueBooks.size,
    steamWindowMinutes,
  );
}

function buildIdempotencyKey(eventId: string, signal: AlertSignal) {
  const bucket = Math.floor(new Date(signal.currentSnapshotAt).getTime() / IDENTITY_BUCKET_MS);
  return createHash('sha256')
    .update(
      [
        eventId,
        signal.participantId ?? 'all',
        signal.marketKey,
        signal.bookmakerKey,
        signal.tier,
        String(bucket),
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 32);
}

function groupOffersByTuple(offers: ProviderOfferRecord[]) {
  const groups = new Map<string, ProviderOfferRecord[]>();

  for (const offer of offers) {
    const key = [
      offer.provider_event_id,
      offer.provider_market_key,
      offer.provider_key,
      offer.provider_participant_id ?? 'all',
    ].join(':');
    const group = groups.get(key) ?? [];
    group.push(offer);
    groups.set(key, group);
  }

  return groups;
}

function selectCurrentOffer(offers: ProviderOfferRecord[], nowIso: string) {
  return [...offers]
    .filter((offer) => offer.snapshot_at <= nowIso)
    .sort((left, right) => right.snapshot_at.localeCompare(left.snapshot_at))[0] ?? null;
}

function selectBaselineOffer(
  offers: ProviderOfferRecord[],
  currentOffer: ProviderOfferRecord,
  lookbackMinutes: number,
) {
  const lowerBound = new Date(
    new Date(currentOffer.snapshot_at).getTime() - lookbackMinutes * 60 * 1000,
  ).toISOString();

  return (
    [...offers]
      .filter(
        (offer) =>
          offer.snapshot_at >= lowerBound && offer.snapshot_at < currentOffer.snapshot_at,
      )
      .sort((left, right) => left.snapshot_at.localeCompare(right.snapshot_at))[0] ?? null
  );
}

function classifyMarketType(marketKey: string): AlertDetectionMarketType {
  const normalized = marketKey.trim().toLowerCase();
  if (
    normalized.includes('spread') ||
    normalized.includes('run_line') ||
    normalized.includes('puck_line') ||
    normalized.includes('handicap')
  ) {
    return 'spread';
  }

  if (
    normalized === 'total' ||
    normalized.includes('totals') ||
    normalized.includes('over_under') ||
    normalized.includes('game_ou') ||
    normalized.startsWith('total-') ||
    normalized.includes('team-total')
  ) {
    return 'total';
  }

  if (
    normalized.includes('moneyline') ||
    normalized === 'h2h' ||
    normalized.includes('1x2')
  ) {
    return 'moneyline';
  }

  if (normalized.startsWith('player_')) {
    return 'player_prop';
  }

  return 'player_prop';
}

function pickDominantMoneylineSide(
  currentOffer: ProviderOfferRecord,
  baselineOffer: ProviderOfferRecord,
) {
  const candidates = [
    {
      side: 'over',
      baseline: baselineOffer.over_odds,
      current: currentOffer.over_odds,
    },
    {
      side: 'under',
      baseline: baselineOffer.under_odds,
      current: currentOffer.under_odds,
    },
  ]
    .filter(
      (candidate): candidate is { side: 'over' | 'under'; baseline: number; current: number } =>
        Number.isFinite(candidate.baseline) && Number.isFinite(candidate.current),
    )
    .map((candidate) => ({
      ...candidate,
      changeAbs: Math.abs(candidate.current - candidate.baseline),
    }))
    .sort((left, right) => right.changeAbs - left.changeAbs);

  return candidates[0] ?? null;
}

function computeTimeElapsedMinutes(startIso: string, endIso: string) {
  const elapsedMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  return elapsedMs <= 0 ? 0 : roundTo(elapsedMs / 60_000, 4);
}

function normalizePositiveInteger(rawValue: string | number | undefined, fallback: number) {
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) && rawValue > 0 ? Math.trunc(rawValue) : fallback;
  }

  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePositiveNumber(
  rawValue: string | number | undefined,
  fallback: number,
  envName: string,
) {
  if (typeof rawValue === 'number') {
    if (Number.isFinite(rawValue) && rawValue > 0) {
      return rawValue;
    }
    throw new Error(`${envName} must be a positive number`);
  }

  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive number`);
  }

  return parsed;
}

function normalizeTier(rawValue: string | undefined): AlertDetectionTier {
  return rawValue === 'notable' || rawValue === 'alert-worthy' || rawValue === 'watch'
    ? rawValue
    : 'watch';
}

function roundTo(value: number, decimals: number) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
