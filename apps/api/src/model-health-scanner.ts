/**
 * Model Health Scanner
 *
 * Scheduled service that evaluates champion model health against stored metrics,
 * writes snapshots to model_health_snapshots, and fires alerts on state transitions.
 *
 * Runs on a 4-hour cadence (model health doesn't need 5-min granularity).
 *
 * State machine: green → watch → warning → critical (via evaluateModelHealthState).
 * Operator decision required if a model stays critical beyond criticalWindowHours.
 */

import { evaluateModelHealthState } from '@unit-talk/domain';
import type { ModelHealthState, SystemHealthReport } from '@unit-talk/domain';
import type {
  ModelRegistryRepository,
  ModelHealthSnapshotRepository,
  ModelHealthSnapshotRecord,
  AlertLevel,
} from '@unit-talk/db';

export interface ModelHealthScannerDeps {
  modelRegistry: ModelRegistryRepository;
  modelHealthSnapshots: ModelHealthSnapshotRepository;
}

export interface ModelSlice {
  sport: string;
  marketFamily: string;
}

export interface ModelHealthScanOptions {
  slices?: ModelSlice[];
  criticalWindowHours?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  onAlert?: (alert: ModelHealthAlert) => Promise<void>;
}

export interface ModelHealthAlert {
  modelId: string;
  sport: string;
  marketFamily: string;
  alertLevel: AlertLevel;
  newState: ModelHealthState;
  previousState: ModelHealthState | null;
  reason: string;
  requiresOperatorDecision: boolean;
  snapshotAt: string;
}

export interface ModelHealthScanResult {
  scanned: number;
  alerts: number;
  requiresOperatorDecision: number;
  errors: number;
  durationMs: number;
}

// Default sports to scan when no explicit slices are provided.
const DEFAULT_SPORTS = ['NBA', 'NFL', 'MLB', 'NHL'] as const;

export async function runModelHealthScan(
  deps: ModelHealthScannerDeps,
  options: ModelHealthScanOptions = {},
): Promise<ModelHealthScanResult> {
  const {
    slices,
    criticalWindowHours = 24,
    logger = console,
    onAlert,
  } = options;

  const started = Date.now();
  let scanned = 0;
  let alerts = 0;
  let requiresOperatorDecision = 0;
  let errors = 0;

  const championsToScan = await resolveChampions(deps.modelRegistry, slices);

  for (const champion of championsToScan) {
    try {
      const latestSnapshot = await deps.modelHealthSnapshots.findLatestByModel(champion.id);
      const currentState = snapshotToHealthState(latestSnapshot);
      // Use the stored transitionAt (when state last changed), not snapshot_at (when last scanned).
      // This is what drives the criticalWindowHours enforcement correctly.
      const lastTransitionAt = readTransitionAt(latestSnapshot);

      const proxyReport = buildProxyReport(latestSnapshot);
      const { newState, trigger } = evaluateModelHealthState(
        proxyReport,
        currentState,
        criticalWindowHours,
        lastTransitionAt,
      );

      const alertLevel = healthStateToAlertLevel(newState);
      const now = new Date().toISOString();

      // When a real transition occurs, record the transition timestamp.
      // When state is unchanged, carry forward the previous transitionAt so the
      // criticalWindowHours clock keeps ticking from the original entry point.
      const nextTransitionAt = trigger !== null && newState !== currentState
        ? now
        : (lastTransitionAt ?? now);

      const snapshotInput: Parameters<typeof deps.modelHealthSnapshots.create>[0] = {
        modelId: champion.id,
        sport: champion.sport,
        marketFamily: champion.market_family,
        sampleSize: latestSnapshot?.sample_size ?? 0,
        alertLevel,
        transitionAt: nextTransitionAt,
        metadata: {
          previousState: currentState,
          newState,
          trigger: trigger ?? null,
          scannedAt: now,
        },
      };
      if (latestSnapshot?.roi != null) snapshotInput.roi = latestSnapshot.roi;
      if (latestSnapshot?.win_rate != null) snapshotInput.winRate = latestSnapshot.win_rate;
      if (latestSnapshot?.drift_score != null) snapshotInput.driftScore = latestSnapshot.drift_score;
      if (latestSnapshot?.calibration_score != null) snapshotInput.calibrationScore = latestSnapshot.calibration_score;
      await deps.modelHealthSnapshots.create(snapshotInput);

      scanned += 1;

      const isAlerted = alertLevel === 'warning' || alertLevel === 'critical';
      const stateWorsened = trigger !== null && isWorsening(currentState, newState);

      if (isAlerted || stateWorsened) {
        const requiresDecision = trigger?.requiresOperatorDecision ?? false;
        if (requiresDecision) requiresOperatorDecision += 1;

        alerts += 1;

        if (onAlert) {
          const alert: ModelHealthAlert = {
            modelId: champion.id,
            sport: champion.sport,
            marketFamily: champion.market_family,
            alertLevel,
            newState,
            previousState: currentState,
            reason: trigger?.reason ?? `State: ${newState}`,
            requiresOperatorDecision: requiresDecision,
            snapshotAt: now,
          };
          await onAlert(alert).catch((err: unknown) => {
            logger.error(
              JSON.stringify({ event: 'model_health_alert_dispatch_failed', modelId: champion.id, err: String(err) }),
            );
          });
        }
      }

      logger.info(
        JSON.stringify({
          event: 'model_health_scanned',
          modelId: champion.id,
          sport: champion.sport,
          marketFamily: champion.market_family,
          previousState: currentState,
          newState,
          alertLevel,
          transitioned: trigger !== null,
        }),
      );
    } catch (err: unknown) {
      errors += 1;
      logger.error(
        JSON.stringify({
          event: 'model_health_scan_error',
          modelId: champion.id,
          sport: champion.sport,
          marketFamily: champion.market_family,
          err: String(err),
        }),
      );
    }
  }

  return {
    scanned,
    alerts,
    requiresOperatorDecision,
    errors,
    durationMs: Date.now() - started,
  };
}

async function resolveChampions(
  modelRegistry: ModelRegistryRepository,
  slices?: ModelSlice[],
): Promise<Array<{ id: string; sport: string; market_family: string }>> {
  if (slices && slices.length > 0) {
    const resolved: Array<{ id: string; sport: string; market_family: string }> = [];
    for (const slice of slices) {
      const champion = await modelRegistry.findChampion(slice.sport, slice.marketFamily);
      if (champion) resolved.push(champion);
    }
    return resolved;
  }

  // Discover champions by scanning known sports
  const champions: Array<{ id: string; sport: string; market_family: string }> = [];
  for (const sport of DEFAULT_SPORTS) {
    const models = await modelRegistry.listBySport(sport);
    for (const model of models) {
      if (model.status === 'champion') {
        champions.push(model);
      }
    }
  }
  return champions;
}

/**
 * Read the timestamp of the last real state transition from snapshot metadata.
 * Falls back to null when no transition has been recorded (new model, first scan).
 */
function readTransitionAt(snapshot: ModelHealthSnapshotRecord | null): string | undefined {
  if (!snapshot) return undefined;
  const meta = snapshot.metadata as Record<string, unknown> | null;
  if (meta && typeof meta['transitionAt'] === 'string') return meta['transitionAt'];
  return undefined;
}

function snapshotToHealthState(snapshot: ModelHealthSnapshotRecord | null): ModelHealthState {
  if (!snapshot) return 'green';
  const meta = snapshot.metadata as Record<string, unknown> | null;
  if (meta && typeof meta['newState'] === 'string') {
    const s = meta['newState'] as string;
    if (s === 'green' || s === 'watch' || s === 'warning' || s === 'critical') return s;
  }
  // Fall back from alert_level
  if (snapshot.alert_level === 'critical') return 'critical';
  if (snapshot.alert_level === 'warning') return 'warning';
  return 'green';
}

/**
 * Build a minimal proxy SystemHealthReport from stored snapshot metrics.
 *
 * Maps: roi → roiByBand[A+], calibration_score → brier_score,
 * drift_score → drift_warnings (threshold 0.5 = watch, 0.8 = warning).
 *
 * This is a proxy, not a full pick-history-derived report. It lets us
 * reuse the canonical evaluateModelHealthState() state machine without
 * requiring resolved pick records in the API layer.
 */
function buildProxyReport(snapshot: ModelHealthSnapshotRecord | null): SystemHealthReport {
  const roi = snapshot?.roi ?? 0;
  const calibrationScore = snapshot?.calibration_score ?? 0.2; // below warning threshold = healthy
  const driftScore = snapshot?.drift_score ?? 0;
  const sampleSize = snapshot?.sample_size ?? 0;

  const driftWarnings = driftScore >= 0.8 ? 5 : driftScore >= 0.5 ? 3 : 0;

  return {
    report_version: 'system-health-v1.0',
    generated_at: new Date().toISOString(),
    total_records: sampleSize,
    clvByBand: [
      {
        band: 'A+',
        avg_clv_pct: null,
        positive_clv_rate: 0,
        negative_clv_rate: 0,
        sample_size: sampleSize,
      },
    ],
    roiByBand: [
      { band: 'A+', roi_pct: roi, sample_size: sampleSize },
    ],
    calibrationMetrics: {
      brier_score: calibrationScore,
      log_loss: 0,
      ece: 0,
      reliability_buckets: [],
      sample_size: sampleSize,
    },
    bandDistribution: {
      distribution: [],
      total_picks: sampleSize,
      suppression_rate_pct: 0,
      downgrade_rate_pct: 0,
      collapsed_warning: false,
    },
    downgradeEffectiveness: {
      loss_prevention_rate: 0,
      estimated_savings: 0,
      downgrade_reason_counts: [],
      downgrade_effective: true,
    },
    suppressionEffectiveness: {
      suppressed_hypothetical_roi_pct: 0,
      suppressed_hypothetical_clv_pct: null,
      suppression_effective: true,
      suppressed_count: 0,
    },
    driftStatus: {
      drift_warnings: driftWarnings,
      drift_critical_flags: driftWarnings >= 5 ? 1 : 0,
      regime_stability: driftWarnings >= 5 ? 'critical' : driftWarnings >= 3 ? 'warning' : 'stable',
      flags: [],
    },
    calibrationImpact: {
      pre_calibration: {
        brierScore: calibrationScore,
        logLoss: 0,
        ece: 0,
        reliabilityCurve: [],
        sampleSize,
      },
      post_calibration: {
        brierScore: calibrationScore,
        logLoss: 0,
        ece: 0,
        reliabilityCurve: [],
        sampleSize,
      },
      brier_improvement: 0,
      log_loss_delta: 0,
      monotonicity_preserved: true,
      calibration_helped: false,
    },
  };
}

function healthStateToAlertLevel(state: ModelHealthState): AlertLevel {
  if (state === 'critical') return 'critical';
  if (state === 'warning') return 'warning';
  return 'none';
}

const STATE_SEVERITY: Record<ModelHealthState, number> = {
  green: 0,
  watch: 1,
  warning: 2,
  critical: 3,
};

function isWorsening(from: ModelHealthState, to: ModelHealthState): boolean {
  return STATE_SEVERITY[to] > STATE_SEVERITY[from];
}
