import type { QueueHealthEvaluation } from './index.js';

export type SloStatus = 'ok' | 'at_risk' | 'breached';
export type DeployRisk = 'low' | 'medium' | 'high';

export interface SloObjectiveDefinition {
  id: string;
  name: string;
  targetPercent: number;
}

export interface SloObjectiveEvaluation {
  objective: SloObjectiveDefinition;
  compliant: boolean;
  status: SloStatus;
  /** 0–100: portion of the error budget consumed at this observation */
  errorBudgetConsumedPercent: number;
  currentValueMs?: number;
  thresholdMs?: number;
  currentCount?: number;
  note: string;
}

export interface SloReport {
  observedAt: string;
  evaluations: SloObjectiveEvaluation[];
  overallStatus: SloStatus;
  deployRisk: DeployRisk;
  violatedObjectives: string[];
  atRiskObjectives: string[];
}

export interface SloThresholds {
  deliveryFreshnessWarnMs: number;
  deliveryFreshnessCriticalMs: number;
  queueAgeWarnMs: number;
  queueAgeCriticalMs: number;
}

export const defaultSloThresholds: SloThresholds = {
  deliveryFreshnessWarnMs: 30 * 60 * 1000,
  deliveryFreshnessCriticalMs: 60 * 60 * 1000,
  queueAgeWarnMs: 30 * 60 * 1000,
  queueAgeCriticalMs: 120 * 60 * 1000,
};

export const SLO_OBJECTIVES: Record<string, SloObjectiveDefinition> = {
  delivery_freshness: {
    id: 'delivery_freshness',
    name: 'Delivery Freshness',
    targetPercent: 99.5,
  },
  queue_age: {
    id: 'queue_age',
    name: 'Queue Age',
    targetPercent: 99.0,
  },
  delivery_success: {
    id: 'delivery_success',
    name: 'Delivery Success (no dead-letter)',
    targetPercent: 99.9,
  },
  queue_availability: {
    id: 'queue_availability',
    name: 'Queue Availability',
    targetPercent: 99.0,
  },
};

function evaluateDeliveryFreshness(
  evaluation: QueueHealthEvaluation,
  thresholds: SloThresholds,
): SloObjectiveEvaluation {
  const objective = SLO_OBJECTIVES['delivery_freshness']!;
  const ageMs = evaluation.lastSuccessfulDeliveryAgeMs;

  if (ageMs === null) {
    // No delivery yet — treat as ok if no pending work, breached if there is
    const hasPending = evaluation.pendingCount > 0;
    return {
      objective,
      compliant: !hasPending,
      status: hasPending ? 'breached' : 'ok',
      errorBudgetConsumedPercent: hasPending ? 100 : 0,
      note: hasPending
        ? 'No successful delivery recorded but pending work exists'
        : 'No pending work; no delivery freshness concern',
    };
  }

  if (ageMs >= thresholds.deliveryFreshnessCriticalMs) {
    return {
      objective,
      compliant: false,
      status: 'breached',
      errorBudgetConsumedPercent: 100,
      currentValueMs: ageMs,
      thresholdMs: thresholds.deliveryFreshnessCriticalMs,
      note: `Last delivery ${Math.round(ageMs / 60000)}m ago — exceeds critical threshold`,
    };
  }

  if (ageMs >= thresholds.deliveryFreshnessWarnMs) {
    return {
      objective,
      compliant: true,
      status: 'at_risk',
      errorBudgetConsumedPercent: 50,
      currentValueMs: ageMs,
      thresholdMs: thresholds.deliveryFreshnessWarnMs,
      note: `Last delivery ${Math.round(ageMs / 60000)}m ago — approaching threshold`,
    };
  }

  return {
    objective,
    compliant: true,
    status: 'ok',
    errorBudgetConsumedPercent: 0,
    currentValueMs: ageMs,
    thresholdMs: thresholds.deliveryFreshnessCriticalMs,
    note: `Last delivery ${Math.round(ageMs / 60000)}m ago — within SLO`,
  };
}

function evaluateQueueAge(
  evaluation: QueueHealthEvaluation,
  thresholds: SloThresholds,
): SloObjectiveEvaluation {
  const objective = SLO_OBJECTIVES['queue_age']!;
  const ageMs = evaluation.oldestPendingAgeMs;

  if (ageMs === null || evaluation.pendingCount === 0) {
    return {
      objective,
      compliant: true,
      status: 'ok',
      errorBudgetConsumedPercent: 0,
      note: 'No pending rows; queue age SLO not applicable',
    };
  }

  if (ageMs >= thresholds.queueAgeCriticalMs) {
    return {
      objective,
      compliant: false,
      status: 'breached',
      errorBudgetConsumedPercent: 100,
      currentValueMs: ageMs,
      thresholdMs: thresholds.queueAgeCriticalMs,
      note: `Oldest pending row is ${Math.round(ageMs / 60000)}m old — exceeds critical threshold`,
    };
  }

  if (ageMs >= thresholds.queueAgeWarnMs) {
    return {
      objective,
      compliant: true,
      status: 'at_risk',
      errorBudgetConsumedPercent: 50,
      currentValueMs: ageMs,
      thresholdMs: thresholds.queueAgeWarnMs,
      note: `Oldest pending row is ${Math.round(ageMs / 60000)}m old — approaching threshold`,
    };
  }

  return {
    objective,
    compliant: true,
    status: 'ok',
    errorBudgetConsumedPercent: 0,
    currentValueMs: ageMs,
    thresholdMs: thresholds.queueAgeCriticalMs,
    note: `Oldest pending row is ${Math.round(ageMs / 60000)}m old — within SLO`,
  };
}

function evaluateDeliverySuccess(evaluation: QueueHealthEvaluation): SloObjectiveEvaluation {
  const objective = SLO_OBJECTIVES['delivery_success']!;

  if (evaluation.deadLetterCount > 0) {
    return {
      objective,
      compliant: false,
      status: 'breached',
      errorBudgetConsumedPercent: 100,
      currentCount: evaluation.deadLetterCount,
      note: `${evaluation.deadLetterCount} dead-letter row(s) require operator review`,
    };
  }

  if (evaluation.failedCount > 0) {
    return {
      objective,
      compliant: true,
      status: 'at_risk',
      errorBudgetConsumedPercent: 50,
      currentCount: evaluation.failedCount,
      note: `${evaluation.failedCount} failed row(s) pending retry — monitoring for dead-letter promotion`,
    };
  }

  return {
    objective,
    compliant: true,
    status: 'ok',
    errorBudgetConsumedPercent: 0,
    currentCount: 0,
    note: 'No dead-letter or failed rows',
  };
}

function evaluateQueueAvailability(evaluation: QueueHealthEvaluation): SloObjectiveEvaluation {
  const objective = SLO_OBJECTIVES['queue_availability']!;

  if (evaluation.status === 'down') {
    return {
      objective,
      compliant: false,
      status: 'breached',
      errorBudgetConsumedPercent: 100,
      note: `Queue status is DOWN — ${evaluation.alerts.filter((a) => a.level === 'critical').length} critical alert(s)`,
    };
  }

  if (evaluation.status === 'degraded') {
    return {
      objective,
      compliant: true,
      status: 'at_risk',
      errorBudgetConsumedPercent: 50,
      note: `Queue status is DEGRADED — ${evaluation.alerts.length} active alert(s)`,
    };
  }

  return {
    objective,
    compliant: true,
    status: 'ok',
    errorBudgetConsumedPercent: 0,
    note: 'Queue is healthy',
  };
}

function aggregateStatus(evaluations: SloObjectiveEvaluation[]): SloStatus {
  if (evaluations.some((e) => e.status === 'breached')) return 'breached';
  if (evaluations.some((e) => e.status === 'at_risk')) return 'at_risk';
  return 'ok';
}

function toDeployRisk(status: SloStatus): DeployRisk {
  if (status === 'breached') return 'high';
  if (status === 'at_risk') return 'medium';
  return 'low';
}

export function evaluateSlo(
  queueHealth: QueueHealthEvaluation,
  thresholds?: Partial<SloThresholds>,
): SloReport {
  const merged: SloThresholds = { ...defaultSloThresholds, ...thresholds };

  const evaluations: SloObjectiveEvaluation[] = [
    evaluateDeliveryFreshness(queueHealth, merged),
    evaluateQueueAge(queueHealth, merged),
    evaluateDeliverySuccess(queueHealth),
    evaluateQueueAvailability(queueHealth),
  ];

  const overallStatus = aggregateStatus(evaluations);

  return {
    observedAt: queueHealth.observedAt,
    evaluations,
    overallStatus,
    deployRisk: toDeployRisk(overallStatus),
    violatedObjectives: evaluations
      .filter((e) => e.status === 'breached')
      .map((e) => e.objective.id),
    atRiskObjectives: evaluations
      .filter((e) => e.status === 'at_risk')
      .map((e) => e.objective.id),
  };
}

export function sloReportLogFields(report: SloReport) {
  return {
    sloOverallStatus: report.overallStatus,
    sloDeployRisk: report.deployRisk,
    sloViolatedObjectives: report.violatedObjectives,
    sloAtRiskObjectives: report.atRiskObjectives,
    sloEvaluations: report.evaluations.map((e) => ({
      id: e.objective.id,
      status: e.status,
      compliant: e.compliant,
      errorBudgetConsumedPercent: e.errorBudgetConsumedPercent,
      note: e.note,
    })),
  };
}
