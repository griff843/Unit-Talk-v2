import {
  parseSyndicateMachineMode,
  type SyndicateMachineMode,
} from '@unit-talk/config';

export { parseSyndicateMachineMode, type SyndicateMachineMode } from '@unit-talk/config';

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
  eligible: boolean;
}

export type SchedulerRegistrationStatus =
  | 'started'
  | 'suppressed_by_mode'
  | 'skipped_by_runtime_condition';

export interface SchedulerRegistrationOutcome extends SchedulerRegistrationDecision {
  status: SchedulerRegistrationStatus;
  started: boolean;
  reason: string | null;
}

export type SchedulerStartOutcome =
  | { started: true }
  | { started: false; reason: string };

export interface SchedulerRegistrationPolicy {
  mode: SyndicateMachineMode;
  requestedValue: 'true' | 'false';
  decisions: readonly SchedulerRegistrationDecision[];
  readonly outcomes: readonly SchedulerRegistrationOutcome[];
  register(
    scheduler: ProductionSchedulerId,
    registration: () => SchedulerStartOutcome,
  ): SchedulerRegistrationOutcome;
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
  const { mode, requestedValue } = parseSyndicateMachineMode(rawSyndicateMachineEnabled);
  const decisions = Object.freeze(
    PRODUCTION_SCHEDULER_IDS.map((scheduler) => ({
      scheduler,
      parkedModeClassification: SCHEDULER_CLASSIFICATIONS[scheduler],
      eligible: shouldRegisterProductionScheduler(scheduler, mode),
    })),
  );
  const outcomes: SchedulerRegistrationOutcome[] = [];

  return {
    mode,
    requestedValue,
    decisions,
    get outcomes() {
      return outcomes;
    },
    register(scheduler, registration) {
      const parkedModeClassification = SCHEDULER_CLASSIFICATIONS[scheduler];
      const eligible = shouldRegisterProductionScheduler(scheduler, mode);
      if (!eligible) {
        const outcome: SchedulerRegistrationOutcome = {
          scheduler,
          parkedModeClassification,
          eligible,
          status: 'suppressed_by_mode',
          started: false,
          reason: 'syndicate_machine_parked',
        };
        outcomes.push(outcome);
        return outcome;
      }

      const startOutcome = registration();
      const outcome: SchedulerRegistrationOutcome = {
        scheduler,
        parkedModeClassification,
        eligible,
        status: startOutcome.started ? 'started' : 'skipped_by_runtime_condition',
        started: startOutcome.started,
        reason: startOutcome.started ? null : startOutcome.reason,
      };
      outcomes.push(outcome);
      return outcome;
    },
  };
}
