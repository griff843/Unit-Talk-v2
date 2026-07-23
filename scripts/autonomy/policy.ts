import {
  type AutonomyCeilings,
  type AutonomyMode,
  type AutonomyPolicy,
  type UsageSnapshot,
} from './contracts.js';

const MODES: ReadonlySet<string> = new Set([
  'halted',
  'shadow',
  't3_live',
  't2t3_live',
]);

export const CONTRACT_MAXIMA = Object.freeze({
  max_cycles: 1,
  max_duration_ms: 20 * 60 * 1_000,
  max_operation_duration_ms: 10 * 60 * 1_000,
  max_dispatches_per_cycle: 2,
  max_merges_per_cycle: 3,
  max_retries_per_operation: 1,
  heartbeat_ttl_seconds: 900,
});

const FAIL_CLOSED_CEILINGS: AutonomyCeilings = Object.freeze({
  max_cycles: 1,
  max_duration_ms: 1,
  max_operation_duration_ms: 1,
  max_dispatches_per_cycle: 0,
  max_merges_per_cycle: 0,
  max_retries_per_operation: 0,
  max_token_budget: 1,
  max_cost_micros: 0,
});

export interface PolicyResolution {
  policy: AutonomyPolicy;
  valid: boolean;
  reason_codes: string[];
}

export function resolvePolicy(input: {
  mode?: string;
  owner_halt?: boolean;
  owner_halt_reason?: string | null;
  heartbeat_ttl_seconds?: number;
  ceilings?: Partial<AutonomyCeilings>;
}): PolicyResolution {
  const reasons: string[] = [];
  if (input.mode === undefined) reasons.push('AUTONOMY_MODE_MISSING');
  else if (!MODES.has(input.mode)) reasons.push('AUTONOMY_MODE_INVALID');
  if (input.owner_halt === undefined) reasons.push('OWNER_HALT_SIGNAL_MISSING');

  const ceilings = resolveCeilings(input.ceilings, reasons);
  const heartbeatTtl =
    input.heartbeat_ttl_seconds ?? CONTRACT_MAXIMA.heartbeat_ttl_seconds;
  if (!Number.isInteger(heartbeatTtl) || heartbeatTtl < 1) {
    reasons.push('HEARTBEAT_TTL_INVALID');
  }

  const ownerHalt = input.owner_halt ?? true;
  const requestedMode = MODES.has(input.mode ?? '')
    ? (input.mode as AutonomyMode)
    : 'halted';
  if (ownerHalt && input.owner_halt !== undefined) {
    reasons.push('OWNER_HALT_ACTIVE');
  }
  const valid = reasons.every((reason) => reason === 'OWNER_HALT_ACTIVE');
  const mode: AutonomyMode = valid && !ownerHalt ? requestedMode : 'halted';

  return {
    policy: {
      schema_version: 1,
      mode,
      owner_halt: ownerHalt,
      owner_halt_reason: input.owner_halt_reason?.trim() || null,
      heartbeat_ttl_seconds:
        Number.isInteger(heartbeatTtl) && heartbeatTtl > 0
          ? heartbeatTtl
          : CONTRACT_MAXIMA.heartbeat_ttl_seconds,
      ceilings,
    },
    valid,
    reason_codes: [...new Set(reasons)].sort(),
  };
}

function resolveCeilings(
  input: Partial<AutonomyCeilings> | undefined,
  reasons: string[],
): AutonomyCeilings {
  if (!input) {
    reasons.push('AUTONOMY_CEILINGS_MISSING');
    return { ...FAIL_CLOSED_CEILINGS };
  }
  const candidate: AutonomyCeilings = {
    max_cycles: input.max_cycles ?? 0,
    max_duration_ms: input.max_duration_ms ?? 0,
    max_operation_duration_ms: input.max_operation_duration_ms ?? 0,
    max_dispatches_per_cycle: input.max_dispatches_per_cycle ?? -1,
    max_merges_per_cycle: input.max_merges_per_cycle ?? -1,
    max_retries_per_operation: input.max_retries_per_operation ?? -1,
    max_token_budget: input.max_token_budget ?? 0,
    max_cost_micros: input.max_cost_micros ?? -1,
  };

  validateBoundedInteger(
    candidate.max_cycles,
    1,
    CONTRACT_MAXIMA.max_cycles,
    'MAX_CYCLES_INVALID',
    reasons,
  );
  validateBoundedInteger(
    candidate.max_duration_ms,
    1,
    CONTRACT_MAXIMA.max_duration_ms,
    'MAX_DURATION_INVALID',
    reasons,
  );
  validateBoundedInteger(
    candidate.max_operation_duration_ms,
    1,
    CONTRACT_MAXIMA.max_operation_duration_ms,
    'MAX_OPERATION_DURATION_INVALID',
    reasons,
  );
  validateBoundedInteger(
    candidate.max_dispatches_per_cycle,
    0,
    CONTRACT_MAXIMA.max_dispatches_per_cycle,
    'MAX_DISPATCHES_INVALID',
    reasons,
  );
  validateBoundedInteger(
    candidate.max_merges_per_cycle,
    0,
    CONTRACT_MAXIMA.max_merges_per_cycle,
    'MAX_MERGES_INVALID',
    reasons,
  );
  validateBoundedInteger(
    candidate.max_retries_per_operation,
    0,
    CONTRACT_MAXIMA.max_retries_per_operation,
    'MAX_RETRIES_INVALID',
    reasons,
  );
  validateBoundedInteger(
    candidate.max_token_budget,
    1,
    Number.MAX_SAFE_INTEGER,
    'MAX_TOKEN_BUDGET_INVALID',
    reasons,
  );
  validateBoundedInteger(
    candidate.max_cost_micros,
    0,
    Number.MAX_SAFE_INTEGER,
    'MAX_COST_INVALID',
    reasons,
  );

  return reasons.some((reason) => reason.endsWith('_INVALID'))
    ? { ...FAIL_CLOSED_CEILINGS }
    : candidate;
}

function validateBoundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  reason: string,
  reasons: string[],
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    reasons.push(reason);
  }
}

export function evaluateCeilings(
  ceilings: AutonomyCeilings,
  usage: UsageSnapshot,
): string[] {
  const exceeded: string[] = [];
  if (usage.cycles >= ceilings.max_cycles) exceeded.push('MAX_CYCLES_REACHED');
  if (usage.elapsed_ms >= ceilings.max_duration_ms) {
    exceeded.push('MAX_DURATION_REACHED');
  }
  if (usage.retries_for_operation > ceilings.max_retries_per_operation) {
    exceeded.push('MAX_RETRIES_EXCEEDED');
  }
  if (usage.tokens_used >= ceilings.max_token_budget) {
    exceeded.push('MAX_TOKEN_BUDGET_REACHED');
  }
  if (usage.cost_micros >= ceilings.max_cost_micros) {
    exceeded.push('MAX_COST_REACHED');
  }
  if (usage.dispatches >= ceilings.max_dispatches_per_cycle) {
    exceeded.push('MAX_DISPATCHES_REACHED');
  }
  if (usage.merges >= ceilings.max_merges_per_cycle) {
    exceeded.push('MAX_MERGES_REACHED');
  }
  return exceeded.sort();
}
