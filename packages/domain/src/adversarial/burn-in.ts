import {
  createIndependentAdversarialRecord,
  stableHash,
} from './independent-data-path.js';
import { detectManipulation } from './manipulation-detector.js';
import { detectProviderAnomalies } from './provider-anomaly.js';
import { replayAdversarialFindings } from './replay.js';
import { buildAdversarialEscalationBatch } from './escalation.js';
import type {
  BurnInResult,
  BurnInRun,
  BurnInScenario,
  BurnInScenarioResult,
  BurnInStatus,
  RunBurnInInput,
} from './burn-in.types.js';

export type {
  BurnInStatus,
  BurnInScenario,
  BurnInRun,
  RunBurnInInput,
  BurnInScenarioResult,
  BurnInResult,
} from './burn-in.types.js';

export class BurnInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BurnInError';
  }
}

export function runBurnIn(input: RunBurnInInput): BurnInResult {
  validateRunInput(input);

  const clockResets = input.clockResetCount ?? 0;
  const run: BurnInRun = Object.freeze({
    id: input.id ?? `burnin_${stableHash({
      completedAt: input.completedAt,
      scenarioIds: input.scenarios.map((scenario) => scenario.id),
      startedAt: input.startedAt,
    })}`,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    clockResetCount: clockResets,
    scenarios: Object.freeze([...input.scenarios]),
  });

  const scenarios = input.scenarios.map((scenario) => runBurnInScenario({
    scenario,
    detectedAt: input.detectedAt,
    replayedAt: input.replayedAt,
    escalatedAt: input.escalatedAt,
    clockResets,
    maxClockResetCount: input.maxClockResetCount ?? 3,
  }));

  const violations = scenarios.flatMap((scenario) => scenario.violations);
  const replayStable = scenarios.every((scenario) => scenario.replayStable);
  const status = summarizeStatus({
    clockResets,
    maxClockResetCount: input.maxClockResetCount ?? 3,
    replayStable,
    violations,
  });

  return Object.freeze({
    runId: run.id,
    status,
    escalations: scenarios.reduce((sum, scenario) => sum + scenario.escalations, 0),
    nonEscalations: scenarios.reduce((sum, scenario) => sum + scenario.nonEscalations, 0),
    clockResets,
    violations: Object.freeze(violations),
    replayStable,
    scenarios: Object.freeze(scenarios),
    completedAt: input.completedAt,
  });
}

interface ScenarioRunInput {
  readonly scenario: BurnInScenario;
  readonly detectedAt: string;
  readonly replayedAt: string;
  readonly escalatedAt: string;
  readonly clockResets: number;
  readonly maxClockResetCount: number;
}

function runBurnInScenario(input: ScenarioRunInput): BurnInScenarioResult {
  validateScenario(input.scenario);

  const records = input.scenario.snapshots.map((snapshot, index) => createIndependentAdversarialRecord({
    id: `${input.scenario.id}-record-${index + 1}`,
    rawSnapshot: snapshot,
  }));
  const manipulationFindings = records.map((record) => detectManipulation({
    record,
    detectedAt: input.detectedAt,
    ...(input.scenario.manipulationThresholds !== undefined
      ? { thresholds: input.scenario.manipulationThresholds }
      : {}),
  }));
  const providerFindings = detectProviderAnomalies({
    records,
    detectedAt: input.detectedAt,
    ...(input.scenario.providerThresholds !== undefined
      ? { thresholds: input.scenario.providerThresholds }
      : {}),
  });
  const findings = Object.freeze([...manipulationFindings, ...providerFindings]);
  const replay = replayAdversarialFindings({
    records,
    findings,
    replayedAt: input.replayedAt,
  });
  const escalationResults = buildAdversarialEscalationBatch({
    findings,
    escalatedAt: input.escalatedAt,
  });

  const escalations = escalationResults.filter((result) => result.escalationEvent !== null).length;
  const nonEscalations = escalationResults.length - escalations;
  const replayStable = replay.rejected.length === 0 && replay.verified.length === findings.length;
  const violations = buildScenarioViolations({
    scenario: input.scenario,
    escalations,
    nonEscalations,
    replayStable,
    clockResets: input.clockResets,
    maxClockResetCount: input.maxClockResetCount,
  });

  return Object.freeze({
    scenarioId: input.scenario.id,
    status: summarizeStatus({
      clockResets: input.clockResets,
      maxClockResetCount: input.maxClockResetCount,
      replayStable,
      violations,
    }),
    escalations,
    nonEscalations,
    clockResets: input.clockResets,
    violations: Object.freeze(violations),
    replayStable,
    findings,
    escalationResults,
  });
}

interface ScenarioViolationInput {
  readonly scenario: BurnInScenario;
  readonly escalations: number;
  readonly nonEscalations: number;
  readonly replayStable: boolean;
  readonly clockResets: number;
  readonly maxClockResetCount: number;
}

function buildScenarioViolations(input: ScenarioViolationInput): readonly string[] {
  const violations: string[] = [];
  if (input.scenario.expectedEscalations !== input.escalations) {
    violations.push(
      `${input.scenario.id}: expected ${input.scenario.expectedEscalations} escalations, observed ${input.escalations}`,
    );
  }
  if (input.scenario.expectedNonEscalations !== input.nonEscalations) {
    violations.push(
      `${input.scenario.id}: expected ${input.scenario.expectedNonEscalations} non-escalations, observed ${input.nonEscalations}`,
    );
  }
  if (!input.replayStable) {
    violations.push(`${input.scenario.id}: replay rejected one or more findings`);
  }
  if (input.clockResets > input.maxClockResetCount) {
    violations.push(
      `${input.scenario.id}: clock reset count ${input.clockResets} exceeded max ${input.maxClockResetCount}`,
    );
  }

  return violations;
}

interface StatusInput {
  readonly clockResets: number;
  readonly maxClockResetCount: number;
  readonly replayStable: boolean;
  readonly violations: readonly string[];
}

function summarizeStatus(input: StatusInput): BurnInStatus {
  if (input.clockResets > input.maxClockResetCount) {
    return 'fail';
  }
  if (!input.replayStable) {
    return 'divergence_reset';
  }
  if (input.violations.length > 0) {
    return 'violation_paused';
  }
  return 'pass';
}

function validateRunInput(input: RunBurnInInput): void {
  assertIsoTimestamp(input.startedAt, 'startedAt');
  assertIsoTimestamp(input.detectedAt, 'detectedAt');
  assertIsoTimestamp(input.replayedAt, 'replayedAt');
  assertIsoTimestamp(input.escalatedAt, 'escalatedAt');
  assertIsoTimestamp(input.completedAt, 'completedAt');
  if (input.scenarios.length === 0) {
    throw new BurnInError('at least one burn-in scenario is required');
  }
  if ((input.clockResetCount ?? 0) < 0) {
    throw new BurnInError('clockResetCount must be non-negative');
  }
  if ((input.maxClockResetCount ?? 3) < 0) {
    throw new BurnInError('maxClockResetCount must be non-negative');
  }
}

function validateScenario(scenario: BurnInScenario): void {
  assertNonEmpty(scenario.id, 'scenario.id');
  assertNonEmpty(scenario.name, 'scenario.name');
  if (scenario.snapshots.length === 0) {
    throw new BurnInError(`${scenario.id}: at least one snapshot is required`);
  }
  if (scenario.expectedEscalations < 0 || scenario.expectedNonEscalations < 0) {
    throw new BurnInError(`${scenario.id}: expected counts must be non-negative`);
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new BurnInError(`${field} is required`);
  }
}

function assertIsoTimestamp(value: string, field: string): void {
  assertNonEmpty(value, field);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new BurnInError(`${field} must be an ISO-8601 UTC timestamp`);
  }
}
