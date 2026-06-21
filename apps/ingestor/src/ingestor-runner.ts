import type { DatabaseConnectionConfig, EventRow, IngestorRepositoryBundle } from '@unit-talk/db';
import { CircuitBreaker, type CircuitBreakerOptions } from './circuit-breaker.js';
import {
  ingestLeague,
  type IngestLeagueOptions,
  type IngestLeagueSummary,
} from './ingest-league.js';
import { SGO_PLAYER_PROP_ODD_ID_PATTERNS } from './sgo-request-contract.js';
import { ingestOddsApiLeague, type OddsApiIngestSummary } from './ingest-odds-api.js';
import { ProviderQuarantineRegistry } from './provider-quarantine.js';
import type {
  ProviderIngestionDbWritePolicy,
  ProviderPayloadArchivePolicy,
} from './provider-ingestion-policy.js';
import {
  runProviderOfferHistoryRetention,
  type ProviderOfferHistoryRetentionResult,
} from './provider-offer-history-retention.js';
import {
  fetchSGOAccountUsage,
  fetchSGOResultsWithTelemetry,
  type SGOAccountUsage,
  type SGOFetchResult,
} from './sgo-fetcher.js';
import {
  formatSchedulerLog,
  resolveCurrentPollIntervalMs,
  type SchedulerConfig,
} from './scheduler.js';
import type { IngestorLoopProgress } from './heartbeat.js';

export const SUPPORTED_SGO_LEAGUES = ['NBA', 'NFL', 'MLB', 'NHL'] as const;

export interface IngestorRunnerOptions {
  repositories: IngestorRepositoryBundle;
  leagues: string[];
  apiKey?: string;
  oddsApiKey?: string;
  apiUrl?: string;
  /** Bearer token for API service-to-service auth (UNIT_TALK_INGESTOR_API_KEY, role: settler). */
  ingestorApiKey?: string;
  /** undefined = run indefinitely */
  maxCycles?: number;
  /**
   * Hard per-league wall-clock bound (ms). When a single league's ingest exceeds
   * this, the in-flight SGO fetch is aborted and the cycle fails closed and
   * proceeds to the next league instead of hanging the whole run. A value <= 0
   * disables the bound (tests / explicit opt-out). Defaults to 240_000 (4 min),
   * comfortably under the 300s default poll. (UTV2-1280)
   */
  leagueTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Fixed poll interval (ms). Ignored when schedulerConfig.enabled=true. */
  pollIntervalMs?: number;
  /** Adaptive on-peak/off-peak scheduling. Takes precedence over pollIntervalMs when enabled. */
  schedulerConfig?: SchedulerConfig;
  /** When true and scheduling is enabled, passes bookmakerID=pinnacle during peak-window cycles only. */
  pinnacleOnlyPeak?: boolean;
  fetchImpl?: typeof fetch;
  skipResults?: boolean;
  resultsLookbackHours?: number;
  /** Max total time for the results pagination loop (ms). Defaults to 300_000 in sgo-fetcher. */
  resultsMaxFetchMs?: number;
  logger?: Pick<Console, 'warn' | 'info'>;
  /** Production runtime forces failClosed=true when constructing provider breakers. */
  circuitBreaker?: CircuitBreakerOptions;
  providerDbWritePolicy?: ProviderIngestionDbWritePolicy;
  providerPayloadArchivePolicy?: ProviderPayloadArchivePolicy;
  triggerGradingRun?: typeof triggerGradingRun;
  /** Called with the staleness message when cycle gap > CYCLE_GAP_WARN_MS. Wire to Discord in production. */
  onStalenessAlert?: (message: string) => Promise<void>;
  /**
   * When provided, the retention job runs once after all ingestor cycles
   * complete. Summarises and drops provider_offer_history partitions older
   * than retentionDays (default 7).
   */
  retentionConnection?: DatabaseConnectionConfig;
  /** Retention window in days. Defaults to 7. Only used when retentionConnection is set. */
  retentionDays?: number;
  /**
   * Loop-progress hook (UTV2-1284, refined UTV2-1286). Called at EVERY phase
   * boundary — poll start, each league start/end, finalized-repoll start/end — not
   * just once per cycle, so a long-but-progressing cycle keeps advancing the signal
   * and the in-process watchdog only force-exits on a true no-progress wedge.
   * Production wires it to a heartbeat file read by the watchdog and the container
   * healthcheck. Best-effort: a throw here is swallowed and must never break the loop.
   */
  recordHeartbeat?: (progress: IngestorLoopProgress) => void;
  /**
   * Bounded singleton re-admission (UTV2-1284). A league whose prior cycle timed
   * out holds its per-league singleton until the orphaned work settles; if that
   * work never settles the league would be skipped forever (MLB dropped out of
   * rotation). After this many ms held, the singleton is force-released and the
   * league re-admitted on the next cycle with telemetry. <= 0 disables.
   * Defaults to 2 × leagueTimeoutMs.
   */
  leagueReadmitMs?: number;
  /** Injectable clock (ms) for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

export interface IngestorGradingTriggerSummary {
  attempted: boolean;
  status: 'triggered' | 'skipped' | 'failed';
  reason?: string;
}

export interface IngestorCycleSummary {
  cycle: number;
  results: IngestLeagueSummary[];
  finalizedRepolls: IngestLeagueSummary[];
  oddsApiResults: OddsApiIngestSummary[];
  gradingTrigger: IngestorGradingTriggerSummary;
  sgoUsage: SGOAccountUsage | null;
  /** Present on the final cycle when retentionConnection is configured. */
  retentionResult?: ProviderOfferHistoryRetentionResult | null;
}

/** Warn when a cycle gap exceeds this threshold (10 minutes). */
const CYCLE_GAP_WARN_MS = 10 * 60 * 1000;
const DEFAULT_RESULTS_LOOKBACK_HOURS = 48;
const FINALIZED_REPOLL_BATCH_SIZE = 25;
/** Default hard per-league ingest bound — under the 300s default poll. (UTV2-1280) */
const DEFAULT_LEAGUE_TIMEOUT_MS = 240_000;

/**
 * Raised when a single league's ingest exceeds the per-league wall-clock bound.
 * The runner catches this, fails the league closed, and proceeds — a single
 * league can never hang the entire cycle indefinitely. (UTV2-1280)
 */
export class LeagueIngestTimeoutError extends Error {
  readonly league: string;
  readonly timeoutMs: number;
  constructor(league: string, timeoutMs: number) {
    super(
      `per-league ingest timeout: ${league} exceeded ${timeoutMs}ms — failing closed (UTV2-1280)`,
    );
    this.name = 'LeagueIngestTimeoutError';
    this.league = league;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Run ingestLeague under a hard per-league wall-clock bound. On timeout the
 * in-flight SGO fetch is aborted (graceful path: ingestLeague's own catch records
 * a fail-closed cycle status) and the bound rejects with LeagueIngestTimeoutError
 * so the runner advances even if an unabortable downstream call is stuck. A
 * non-positive bound disables the timeout. (UTV2-1280)
 */
export async function ingestLeagueWithTimeout(
  league: string,
  apiKey: string | undefined,
  repositories: IngestorRepositoryBundle,
  options: IngestLeagueOptions,
  timeoutMs: number,
  hooks?: {
    /**
     * Fires when the UNDERLYING ingest work truly settles (success, error, or
     * after a timeout when the orphaned work finally finishes) — NOT when the
     * timeout race settles. The runner uses this to release the per-league
     * singleton so a timed-out league's still-running work can never overlap a
     * new cycle. (UTV2-1282)
     */
    onWorkSettled?: () => void;
  },
): Promise<IngestLeagueSummary> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    const work = ingestLeague(league, apiKey, repositories, options);
    work.then(
      () => hooks?.onWorkSettled?.(),
      () => hooks?.onWorkSettled?.(),
    );
    return work;
  }

  const controller = new AbortController();
  const work = ingestLeague(league, apiKey, repositories, {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal,
  });
  // The race below may settle before `work` does (e.g. an unabortable downstream
  // call). Signal when the underlying work truly settles (this also swallows the
  // orphaned rejection so it is never unhandled). (UTV2-1282)
  work.then(
    () => hooks?.onWorkSettled?.(),
    () => hooks?.onWorkSettled?.(),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new LeagueIngestTimeoutError(league, timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

type SgoResultsFetchResult = Awaited<
  ReturnType<typeof fetchSGOResultsWithTelemetry>
>;

interface SgoCircuitBreakers {
  odds: CircuitBreaker<SGOFetchResult>;
  results: CircuitBreaker<SgoResultsFetchResult>;
}

export async function runIngestorCycles(
  options: IngestorRunnerOptions,
): Promise<IngestorCycleSummary[]> {
  validateLeagues(options.leagues);

  const maxCycles = options.maxCycles ?? 1;
  const fixedPollIntervalMs = options.pollIntervalMs ?? 300_000;
  const leagueTimeoutMs =
    options.leagueTimeoutMs ?? DEFAULT_LEAGUE_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());
  // Bounded singleton re-admission (UTV2-1284): a league held in-flight longer
  // than this is force-released so a never-settling orphan can't drop it from the
  // rotation forever. Defaults to 2× the per-league bound; <= 0 disables.
  const leagueReadmitMs =
    options.leagueReadmitMs ?? (leagueTimeoutMs > 0 ? leagueTimeoutMs * 2 : 0);
  const summaries: IngestorCycleSummary[] = [];
  let lastCycleEndMs: number | null = null;
  const quarantineRegistry = new ProviderQuarantineRegistry({
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const sgoCircuitBreakers = createSgoCircuitBreakers(options.circuitBreaker);
  // Per-league singleton (UTV2-1282): records the epoch ms a league's ingest work
  // went in-flight, or absent when idle. A league that times out leaves its work
  // running in the background; the entry stays set (released only when that work
  // truly settles) so the next cycle skips the league instead of overlapping it.
  // UTV2-1284 adds a bounded force-release (leagueReadmitMs) so a never-settling
  // orphan can't exclude the league (e.g. MLB) from the rotation permanently.
  const leagueInFlight = new Map<string, number>();
  // Loop-progress emitter (UTV2-1286). Stamps a heartbeat at every phase boundary
  // (poll start, league start/end, finalized-repoll start/end) so the watchdog can
  // distinguish a slow-but-advancing cycle from a true no-progress wedge. Best-effort:
  // a throw in the hook is swallowed and must never break the loop.
  const recordProgress = (cycle: number, phase: string, league?: string | null) => {
    try {
      options.recordHeartbeat?.({
        cycle,
        phase,
        ...(league !== undefined ? { league } : {}),
      });
    } catch {
      // best-effort — a heartbeat write failure must never break the loop
    }
  };

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    // Progress at the top of every iteration proves the loop advanced even when
    // the previous cycle's work failed. Read by the in-process watchdog and the
    // container healthcheck. (UTV2-1284 / UTV2-1286)
    recordProgress(cycle, 'cycle-start');

    // FIX #1 (UTV2-1284): wrap the per-cycle body so a transient failure in
    // cycle-level work (e.g. events.listStartedBySnapshot throwing during a
    // provider/DB outage — the proven 2026-06-20 root cause) fails the iteration
    // closed and continues to the next poll, instead of escaping the loop and
    // leaving the daemon dead while the process lingers "healthy".
    try {
    if (lastCycleEndMs !== null) {
      const gapMs = now() - lastCycleEndMs;
      if (gapMs > CYCLE_GAP_WARN_MS) {
        const stalenessMsg = `[ingestor] cycle=${cycle} STALENESS WARNING: ${Math.round(gapMs / 60000)}m since last cycle — offers may be stale`;
        options.logger?.warn?.(stalenessMsg);
        if (options.onStalenessAlert) {
          void options.onStalenessAlert(stalenessMsg).catch(() => {/* fire-and-forget */});
        }
      }
    }

    const results: IngestLeagueSummary[] = [];
    const cycleSnapshotAt = new Date().toISOString();
    const cycleResolution = resolveCurrentPollIntervalMs(
      options.schedulerConfig ?? { enabled: false, peakPollMs: 0, offPeakPollMs: 0, peakStartHourEt: 0, peakEndHourEt: 0 },
      fixedPollIntervalMs,
    );
    const usePinnacleOnly = options.pinnacleOnlyPeak === true && cycleResolution.mode === 'peak';

    for (const league of options.leagues) {
      // Singleton guard (UTV2-1282): never start a new cycle for a league whose
      // prior cycle's work is still in flight (e.g. it timed out and the orphaned
      // work has not settled). Skip with clear telemetry rather than overlap.
      // FIX #3 (UTV2-1284): bounded re-admission — once the singleton has been
      // held longer than leagueReadmitMs, force-release and re-admit so a
      // never-settling orphan can't drop the league (e.g. MLB) from the rotation
      // permanently. A league skipped is always logged with the reason.
      const inFlightSince = leagueInFlight.get(league);
      if (inFlightSince !== undefined) {
        const heldMs = now() - inFlightSince;
        if (leagueReadmitMs <= 0 || heldMs < leagueReadmitMs) {
          options.logger?.warn?.(
            `[ingestor] cycle=${cycle} league=${league} SKIP — prior cycle still in-flight ${Math.round(heldMs / 1000)}s; refusing overlapping cycle (singleton guard, UTV2-1282)`,
          );
          // A skip is still loop progress — keep the watchdog signal fresh so a
          // run of skipped leagues never reads as a wedge. (UTV2-1286)
          recordProgress(cycle, 'league-skip', league);
          continue;
        }
        const readmitMsg = `[ingestor] cycle=${cycle} league=${league} RE-ADMIT — singleton held ${Math.round(heldMs / 1000)}s > ${Math.round(leagueReadmitMs / 1000)}s bound; forcing release and re-admitting to rotation (UTV2-1284)`;
        options.logger?.warn?.(readmitMsg);
        if (options.onStalenessAlert) {
          void options.onStalenessAlert(readmitMsg).catch(() => {/* fire-and-forget */});
        }
      }
      const playerPropPatterns = leaguePlayerPropPatterns(league);
      const markedAt = now();
      leagueInFlight.set(league, markedAt);
      // Progress before the league's (potentially minutes-long) ingest begins, so
      // the watchdog signal advances as the loop enters each league. (UTV2-1286)
      recordProgress(cycle, 'league-start', league);
      try {
        results.push(
          await ingestLeagueWithTimeout(league, options.apiKey, options.repositories, {
            snapshotAt: cycleSnapshotAt,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            ...(options.skipResults !== undefined ? { skipResults: options.skipResults } : {}),
            ...(options.resultsLookbackHours !== undefined
              ? { resultsLookbackHours: options.resultsLookbackHours }
              : {}),
            ...(options.resultsMaxFetchMs !== undefined
              ? { resultsMaxFetchMs: options.resultsMaxFetchMs }
              : {}),
            ...(options.sleep ? { sleep: options.sleep } : {}),
            ...(options.logger ? { logger: options.logger } : {}),
            ...(options.providerDbWritePolicy
              ? { providerDbWritePolicy: options.providerDbWritePolicy }
              : {}),
            ...(options.providerPayloadArchivePolicy
              ? { providerPayloadArchivePolicy: options.providerPayloadArchivePolicy }
              : {}),
            ...(usePinnacleOnly ? { pinnacleOnly: true } : {}),
            // Dedicated player-prop fetch runs every cycle regardless of peak
            // Pinnacle-only game-line polling (UTV2-1275 Wave 1), so player props
            // are ingested fresh and are not filtered out by Pinnacle.
            ...(playerPropPatterns
              ? { playerPropOddIdPatterns: playerPropPatterns }
              : {}),
            circuitBreaker: {
              ...options.circuitBreaker,
              failClosed: true,
            },
            circuitBreakers: sgoCircuitBreakers,
            quarantineRegistry,
          }, leagueTimeoutMs, {
            // Release the singleton only when the underlying work truly settles —
            // and only if it still owns the slot (a bounded re-admission may have
            // replaced it). (UTV2-1282 / UTV2-1284)
            onWorkSettled: () => {
              if (leagueInFlight.get(league) === markedAt) leagueInFlight.delete(league);
            },
          }),
        );
        // Success: work settled. Clear immediately (belt-and-suspenders alongside
        // onWorkSettled) so the next league/cycle is never blocked by a stale flag.
        if (leagueInFlight.get(league) === markedAt) leagueInFlight.delete(league);
      } catch (leagueError: unknown) {
        if (leagueError instanceof LeagueIngestTimeoutError) {
          // Fail closed and proceed: a single league can never hang the cycle.
          // Do NOT clear leagueInFlight here — the underlying work is still running;
          // onWorkSettled releases the singleton when it finally settles, so the next
          // cycle skips this league instead of overlapping it. (UTV2-1280 / UTV2-1282)
          const timeoutMsg = `[ingestor] cycle=${cycle} league=${league} TIMEOUT after ${leagueError.timeoutMs}ms — failing closed, holding singleton until orphaned work settles (UTV2-1280/1282)`;
          options.logger?.warn?.(timeoutMsg);
          if (options.onStalenessAlert) {
            void options.onStalenessAlert(timeoutMsg).catch(() => {/* fire-and-forget */});
          }
        } else {
          // Non-timeout error: the underlying work threw, so it has settled — release.
          if (leagueInFlight.get(league) === markedAt) leagueInFlight.delete(league);
          options.logger?.warn?.(
            `[ingestor] league=${league} failed, skipping to next: ${leagueError instanceof Error ? leagueError.message : String(leagueError)}`,
          );
        }
      }
      // Progress after each league settles (success, timeout, or error) so the
      // watchdog signal advances per league rather than once per whole cycle. This
      // is the core of the UTV2-1286 fix: bounding the inter-progress gap by a
      // single league's wall-clock (<= leagueTimeoutMs) instead of a multi-league
      // cycle that can exceed the watchdog threshold.
      recordProgress(cycle, 'league-end', league);
    }

    recordProgress(cycle, 'finalized-repoll-start');
    const finalizedRepolls = await runFinalizedRepollsForCycle(
      cycleSnapshotAt,
      options,
      {
        cycle,
        recordProgress,
        circuitBreakers: sgoCircuitBreakers,
        quarantineRegistry,
        leagueTimeoutMs,
      },
    );
    recordProgress(cycle, 'finalized-repoll-end');

    // Odds API ingest (Pinnacle + multi-book consensus) — runs alongside SGO
    const oddsApiResults: OddsApiIngestSummary[] = [];
    if (options.oddsApiKey) {
      for (const league of options.leagues) {
        recordProgress(cycle, 'odds-api', league);
        oddsApiResults.push(
          await ingestOddsApiLeague({
            apiKey: options.oddsApiKey,
            league,
            repositories: options.repositories,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            ...(options.logger ? { logger: options.logger } : {}),
            ...(options.providerDbWritePolicy
              ? { providerDbWritePolicy: options.providerDbWritePolicy }
              : {}),
            ...(options.providerPayloadArchivePolicy
              ? { providerPayloadArchivePolicy: options.providerPayloadArchivePolicy }
              : {}),
          }),
        );
      }
    }

    recordProgress(cycle, 'grading');
    const gradingTrigger = await triggerGradingForCycle(results, options);

    let sgoUsage: SGOAccountUsage | null = null;
    if (options.apiKey && !options.fetchImpl) {
      try {
        sgoUsage = await fetchWithTimeout(
          fetchSGOAccountUsage(
            options.apiKey,
            options.fetchImpl ?? fetch,
          ),
          5_000,
          'SGO account usage fetch timed out',
        );
      } catch (error) {
        options.logger?.warn?.(
          `Failed to fetch SGO account usage: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    summaries.push({
      cycle,
      results,
      finalizedRepolls,
      oddsApiResults,
      gradingTrigger,
      sgoUsage,
    });
    recordProgress(cycle, 'cycle-end');
    } catch (cycleError: unknown) {
      // FIX #1 (UTV2-1284): a transient cycle-level failure must not kill the
      // daemon loop. Fail the iteration closed, emit telemetry, and fall through
      // to the next poll. The per-league loop already isolates league errors;
      // this guards the cycle-level work that runs after it (finalized repolls,
      // grading trigger, account-usage, summary push).
      const failMsg = `[ingestor] cycle=${cycle} POLL ITERATION FAILED — daemon continuing to next poll (fail-closed, UTV2-1284): ${cycleError instanceof Error ? cycleError.message : String(cycleError)}`;
      options.logger?.warn?.(failMsg);
      if (options.onStalenessAlert) {
        void options.onStalenessAlert(failMsg).catch(() => {/* fire-and-forget */});
      }
    } finally {
      lastCycleEndMs = now();
    }

    // The inter-cycle sleep is OUTSIDE the try/catch so the loop always advances
    // to the next poll, even after a failed iteration. (UTV2-1284)
    const isLastCycle = cycle >= maxCycles;
    if (!isLastCycle) {
      const resolution = resolveCurrentPollIntervalMs(
        options.schedulerConfig ?? { enabled: false, peakPollMs: 0, offPeakPollMs: 0, peakStartHourEt: 0, peakEndHourEt: 0 },
        fixedPollIntervalMs,
      );
      options.logger?.info?.(`[ingestor] cycle=${cycle} next-sleep ${formatSchedulerLog(resolution)}`);
      await sleep(resolution.intervalMs);
    }
  }

  // Run retention job once after all cycles complete (non-fatal).
  if (options.retentionConnection && summaries.length > 0) {
    let retentionResult: ProviderOfferHistoryRetentionResult | null = null;
    try {
      retentionResult = await runProviderOfferHistoryRetention({
        connection: options.retentionConnection,
        ...(options.retentionDays !== undefined ? { retentionDays: options.retentionDays } : {}),
        ...(options.logger !== undefined ? { logger: options.logger } : {}),
      });
      options.logger?.info?.(
        `[ingestor] retention complete: partitions_summarized=${retentionResult.partitions_summarized} partitions_dropped=${retentionResult.partitions_dropped} cutoff_date=${retentionResult.cutoff_date}`,
      );
    } catch (error) {
      options.logger?.warn?.(
        `[ingestor] retention job failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // Attach to the last cycle summary so callers can inspect / log it.
    const last = summaries[summaries.length - 1];
    if (last !== undefined) {
      last.retentionResult = retentionResult;
    }
  }

  return summaries;
}

async function runFinalizedRepollsForCycle(
  snapshotAt: string,
  options: IngestorRunnerOptions,
  runtime: {
    /** Cycle number, for progress telemetry. (UTV2-1286) */
    cycle: number;
    /** Loop-progress emitter, called per repoll batch so this cycle-level phase keeps the watchdog signal fresh. (UTV2-1286) */
    recordProgress: (cycle: number, phase: string, league?: string | null) => void;
    circuitBreakers: SgoCircuitBreakers;
    quarantineRegistry: ProviderQuarantineRegistry;
    leagueTimeoutMs: number;
  },
): Promise<IngestLeagueSummary[]> {
  if (!options.apiKey || options.skipResults) {
    return [];
  }

  const lookbackHours =
    options.resultsLookbackHours ?? DEFAULT_RESULTS_LOOKBACK_HOURS;
  const resultsStartsAfter = new Date(
    Date.parse(snapshotAt) - lookbackHours * 60 * 60 * 1000,
  ).toISOString();
  const startedEvents = await options.repositories.events.listStartedBySnapshot(
    snapshotAt,
  );
  const candidateIdsByLeague = new Map<string, string[]>();

  for (const event of startedEvents) {
    if (
      (event.status !== 'scheduled' && event.status !== 'in_progress') ||
      !event.external_id ||
      !options.leagues.includes(event.sport_id)
    ) {
      continue;
    }

    const startsAt = readEventStartsAt(event);
    if (!startsAt || startsAt > snapshotAt || startsAt < resultsStartsAfter) {
      continue;
    }

    const ids = candidateIdsByLeague.get(event.sport_id) ?? [];
    ids.push(event.external_id);
    candidateIdsByLeague.set(event.sport_id, ids);
  }

  const repolls: IngestLeagueSummary[] = [];
  for (const league of options.leagues) {
    const providerEventIds = candidateIdsByLeague.get(league) ?? [];
    for (const batch of chunk(providerEventIds, FINALIZED_REPOLL_BATCH_SIZE)) {
      if (batch.length === 0) {
        continue;
      }

      options.logger?.info?.(
        `[ingestor] finalized-repoll league=${league} candidates=${batch.length}`,
      );
      // Each repoll batch can itself run up to the per-league bound; emit progress
      // per batch so this cycle-level phase keeps the watchdog signal fresh. (UTV2-1286)
      runtime.recordProgress(runtime.cycle, 'finalized-repoll-batch', league);
      try {
        repolls.push(
          await ingestLeagueWithTimeout(league, options.apiKey, options.repositories, {
            snapshotAt,
            resultsOnly: true,
            providerEventIds: batch,
            resultsStartsAfter,
            resultsStartsBefore: snapshotAt,
            resultsLookbackHours: lookbackHours,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            ...(options.sleep ? { sleep: options.sleep } : {}),
            ...(options.logger ? { logger: options.logger } : {}),
            ...(options.providerDbWritePolicy
              ? { providerDbWritePolicy: options.providerDbWritePolicy }
              : {}),
            ...(options.providerPayloadArchivePolicy
              ? { providerPayloadArchivePolicy: options.providerPayloadArchivePolicy }
              : {}),
            circuitBreaker: {
              ...options.circuitBreaker,
              failClosed: true,
            },
            circuitBreakers: runtime.circuitBreakers,
            quarantineRegistry: runtime.quarantineRegistry,
          }, runtime.leagueTimeoutMs),
        );
      } catch (repollError: unknown) {
        // A hung/failed finalized-repoll batch must not block the remaining
        // batches or the cycle. Fail closed and continue. (UTV2-1280)
        options.logger?.warn?.(
          `[ingestor] finalized-repoll league=${league} batch failed/timed out, skipping: ${repollError instanceof Error ? repollError.message : String(repollError)}`,
        );
      }
    }
  }

  return repolls;
}

/**
 * PLAYER_ID-wildcard oddID patterns for a league's dedicated player-prop fetch,
 * or undefined when none are defined (UTV2-1275 Wave 1).
 */
function leaguePlayerPropPatterns(league: string): string[] | undefined {
  const patterns =
    SGO_PLAYER_PROP_ODD_ID_PATTERNS[
      league as keyof typeof SGO_PLAYER_PROP_ODD_ID_PATTERNS
    ];
  return patterns ? [...patterns] : undefined;
}

function createSgoCircuitBreakers(
  options: CircuitBreakerOptions = {},
): SgoCircuitBreakers {
  const breakerOptions = {
    ...options,
    failClosed: true,
  };
  return {
    odds: new CircuitBreaker(
      async () => createEmptySgoFetchResult(),
      createEmptySgoFetchResult(),
      breakerOptions,
    ),
    results: new CircuitBreaker(
      async () => createEmptySgoResultsFetchResult(),
      createEmptySgoResultsFetchResult(),
      breakerOptions,
    ),
  };
}

function createEmptySgoFetchResult(): SGOFetchResult {
  return {
    eventsCount: 0,
    events: [],
    pairedProps: [],
    rawPayloads: [],
    rawBodies: [],
    requestTelemetry: createEmptySgoRequestTelemetry('odds'),
  };
}

function createEmptySgoResultsFetchResult(): SgoResultsFetchResult {
  return {
    results: [],
    rawPayloads: [],
    rawBodies: [],
    requestTelemetry: createEmptySgoRequestTelemetry('results'),
  };
}

function createEmptySgoRequestTelemetry(endpoint: 'odds' | 'results') {
  return {
    provider: 'sgo' as const,
    endpoint,
    requestCount: 0,
    successfulRequests: 0,
    creditsUsed: 0,
    limit: null,
    remaining: null,
    resetAt: null,
    lastStatus: null,
    rateLimitHitCount: 0,
    backoffCount: 0,
    backoffMs: 0,
    retryAfterMs: null,
    throttled: false,
    headersSeen: false,
  };
}

function readEventStartsAt(event: EventRow) {
  const metadataStartsAt = event.metadata?.starts_at;
  if (typeof metadataStartsAt === 'string' && metadataStartsAt.length > 0) {
    return metadataStartsAt;
  }
  return `${event.event_date}T00:00:00.000Z`;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function triggerGradingForCycle(
  results: IngestLeagueSummary[],
  options: IngestorRunnerOptions,
): Promise<IngestorGradingTriggerSummary> {
  if (options.skipResults) {
    return {
      attempted: false,
      status: 'skipped',
      reason: 'results_ingest_disabled',
    };
  }

  if (!options.apiUrl) {
    return {
      attempted: false,
      status: 'skipped',
      reason: 'api_url_not_configured',
    };
  }

  const trigger = options.triggerGradingRun ?? triggerGradingRun;

  if (options.apiUrl && !options.ingestorApiKey) {
    options.logger?.warn?.('settler:ingestor.auth_missing — UNIT_TALK_INGESTOR_API_KEY not set; grading trigger will be rejected by API in fail_closed mode');
  }

  try {
    await trigger(options.apiUrl, options.ingestorApiKey);
    options.logger?.info?.(
      `Triggered grading after ingest cycle for ${results
        .map((summary) => summary.league)
        .join(', ')}`,
    );

    return {
      attempted: true,
      status: 'triggered',
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'unknown grading trigger error';
    options.logger?.warn?.(`Failed to trigger grading after ingest cycle: ${reason}`);

    return {
      attempted: true,
      status: 'failed',
      reason,
    };
  }
}

export async function triggerGradingRun(
  apiUrl: string,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch,
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetchImpl(new URL('/api/grading/run', apiUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: 'ingestor.cycle',
    }),
  });

  if (!response.ok) {
    throw new Error(`grading trigger returned ${response.status}`);
  }
}

export function parseConfiguredLeagues(value: string | undefined) {
  const source = value ?? SUPPORTED_SGO_LEAGUES.join(',');
  return source
    .split(',')
    .map((league) => league.trim().toUpperCase())
    .filter((league) => league.length > 0);
}

function validateLeagues(leagues: string[]) {
  for (const league of leagues) {
    if (!SUPPORTED_SGO_LEAGUES.includes(league as (typeof SUPPORTED_SGO_LEAGUES)[number])) {
      throw new Error(`Unsupported SGO league: ${league}`);
    }
  }
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fetchWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
