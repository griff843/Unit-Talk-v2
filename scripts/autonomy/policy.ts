import {
  type AutonomyCeilings,
  type AutonomyMode,
  type AutonomyPolicy,
  type UsageSnapshot,
} from './contracts.js';

const MODES: ReadonlySet<string> = new Set([
  'halted',
  'shadow',
  't3-live',
  't2-t3-live',
]);

export interface PolicyResolution {
  policy: AutonomyPolicy;
  valid: boolean;
  reason_codes: string[];
}

const FAIL_CLOSED_CEILINGS: AutonomyCeilings = {
  max_cycles: 1,
  max_duration_ms: 1,
  max_retries_per_candidate: 0,
  max_token_budget: 1,
  max_cost_micros: 0,
};

export function resolvePolicy(input: {
  mode?: string;
  owner_halt?: boolean;
  owner_halt_reason?: string | null;
  ceilings?: Partial<AutonomyCeilings>;
}): PolicyResolution {
  const reasons: string[] = [];
  if (input.mode === undefined) reasons.push('AUTONOMY_MODE_MISSING');
  else if (!MODES.has(input.mode)) reasons.push('AUTONOMY_MODE_INVALID');
  if (input.owner_halt === undefined) reasons.push('OWNER_HALT_SIGNAL_MISSING');

  const ceilings = resolveCeilings(input.ceilings, reasons);
  const valid = reasons.length === 0;
  const ownerHalt = input.owner_halt ?? true;
  const requestedMode = MODES.has(input.mode ?? '')
    ? (input.mode as AutonomyMode)
    : 'halted';
  const mode: AutonomyMode = valid && !ownerHalt ? requestedMode : 'halted';

  if (ownerHalt && input.owner_halt !== undefined)
    reasons.push('OWNER_HALT_ACTIVE');

  return {
    policy: {
      schema_version: 1,
      mode,
      owner_halt: ownerHalt,
      owner_halt_reason: input.owner_halt_reason?.trim() || null,
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
    max_retries_per_candidate: input.max_retries_per_candidate ?? -1,
    max_token_budget: input.max_token_budget ?? 0,
    max_cost_micros: input.max_cost_micros ?? -1,
  };
  if (!Number.isInteger(candidate.max_cycles) || candidate.max_cycles < 1) {
    reasons.push('MAX_CYCLES_INVALID');
  }
  if (
    !Number.isInteger(candidate.max_duration_ms) ||
    candidate.max_duration_ms < 1
  ) {
    reasons.push('MAX_DURATION_INVALID');
  }
  if (
    !Number.isInteger(candidate.max_retries_per_candidate) ||
    candidate.max_retries_per_candidate < 0
  ) {
    reasons.push('MAX_RETRIES_INVALID');
  }
  if (
    !Number.isInteger(candidate.max_token_budget) ||
    candidate.max_token_budget < 1
  ) {
    reasons.push('MAX_TOKEN_BUDGET_INVALID');
  }
  if (
    !Number.isInteger(candidate.max_cost_micros) ||
    candidate.max_cost_micros < 0
  ) {
    reasons.push('MAX_COST_INVALID');
  }
  return reasons.some((reason) => reason.endsWith('_INVALID'))
    ? { ...FAIL_CLOSED_CEILINGS }
    : candidate;
}

export function evaluateCeilings(
  ceilings: AutonomyCeilings,
  usage: UsageSnapshot,
): string[] {
  const exceeded: string[] = [];
  if (usage.cycles >= ceilings.max_cycles) exceeded.push('MAX_CYCLES_REACHED');
  if (usage.elapsed_ms >= ceilings.max_duration_ms)
    exceeded.push('MAX_DURATION_REACHED');
  if (usage.retries_for_candidate > ceilings.max_retries_per_candidate) {
    exceeded.push('MAX_RETRIES_EXCEEDED');
  }
  if (usage.tokens_used >= ceilings.max_token_budget)
    exceeded.push('MAX_TOKEN_BUDGET_REACHED');
  if (usage.cost_micros >= ceilings.max_cost_micros)
    exceeded.push('MAX_COST_REACHED');
  return exceeded.sort();
}
