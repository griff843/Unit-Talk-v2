export type SyndicateMachineMode = 'active' | 'parked';

export type ParkedModeClassification = 'parked-enabled' | 'parked-disabled';

export const SCHEDULER_CLASSIFICATIONS = {
  recap: 'parked-enabled',
  'trial-expiry': 'parked-enabled',
  'participant-enrichment': 'parked-enabled',
  'system-pick-scanner': 'parked-enabled',
  'closing-line-recovery': 'parked-enabled',
  'market-universe-materializer': 'parked-enabled',
  'line-movement-detector': 'parked-enabled',
  'board-scan': 'parked-disabled',
  'candidate-scoring': 'parked-disabled',
  'ranked-selection': 'parked-disabled',
  'board-construction': 'parked-disabled',
  'board-pick-writer': 'parked-disabled',
  'candidate-pick-scanner': 'parked-disabled',
  'model-health-scanner': 'parked-enabled',
} as const satisfies Record<string, ParkedModeClassification>;

export type ProductionSchedulerId = keyof typeof SCHEDULER_CLASSIFICATIONS;

export const PRODUCTION_SCHEDULER_IDS = Object.freeze(
  Object.keys(SCHEDULER_CLASSIFICATIONS) as ProductionSchedulerId[],
);

export interface SchedulerRegistrationDecision {
  scheduler: ProductionSchedulerId;
  parkedModeClassification: ParkedModeClassification;
  registered: boolean;
}

export interface SchedulerRegistrationPolicy {
  mode: SyndicateMachineMode;
  decisions: readonly SchedulerRegistrationDecision[];
  register(scheduler: ProductionSchedulerId, registration: () => void): boolean;
}

export function parseSyndicateMachineMode(rawValue: string | undefined): SyndicateMachineMode {
  if (rawValue === 'true') {
    return 'active';
  }
  if (rawValue === 'false') {
    return 'parked';
  }

  throw new Error(
    'SYNDICATE_MACHINE_ENABLED must be declared as exactly "true" (active) or "false" (parked).',
  );
}

export function shouldRegisterProductionScheduler(
  scheduler: ProductionSchedulerId,
  mode: SyndicateMachineMode,
): boolean {
  return mode === 'active' || SCHEDULER_CLASSIFICATIONS[scheduler] === 'parked-enabled';
}

export function createSchedulerRegistrationPolicy(
  rawSyndicateMachineEnabled: string | undefined,
): SchedulerRegistrationPolicy {
  const mode = parseSyndicateMachineMode(rawSyndicateMachineEnabled);
  const decisions = Object.freeze(
    PRODUCTION_SCHEDULER_IDS.map((scheduler) => ({
      scheduler,
      parkedModeClassification: SCHEDULER_CLASSIFICATIONS[scheduler],
      registered: shouldRegisterProductionScheduler(scheduler, mode),
    })),
  );

  return {
    mode,
    decisions,
    register(scheduler, registration) {
      if (!shouldRegisterProductionScheduler(scheduler, mode)) {
        return false;
      }
      registration();
      return true;
    },
  };
}
