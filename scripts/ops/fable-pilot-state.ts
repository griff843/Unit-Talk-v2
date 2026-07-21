/**
 * Fable 5 pilot state (UTV2-1569): strict, fail-closed reader for
 * docs/05_operations/FABLE_PILOT_STATE.json, plus pure cap-evaluation and
 * state-transition helpers.
 *
 * This is the mechanical enforcement UTV2-1569 exists to build. The pilot this issue
 * followed (the pilot-evaluation issue's PILOT LONGER / lean YES / narrow scope
 * conclusion) recommended a bounded Fable 5 evaluation, but a prior attempt to land it
 * was doc-only: the 8-task/30-day/usage-budget limits were "tracked manually" and could
 * not mechanically fail closed. This module is the fix -- every cap here is computed,
 * never narrated.
 *
 * Fail-closed by construction, mirroring delegation-state.ts's contract: a missing
 * file, malformed JSON, wrong shape, or an invalid `status` value all resolve to a
 * blocked ("not eligible") result. `status: "pending"` -- the shipped default, since
 * this pilot has deliberately NOT been activated -- is itself a blocked result, same as
 * "suspended", "expired", or "rolled_back". Only an exact `status: "active"` value,
 * AND passing the mechanical cap check (see evaluatePilotCaps), makes Fable eligible.
 *
 * Independent kill switch: this file's own `status` field is one of two independent
 * levers that gate Fable eligibility (the other is
 * docs/05_operations/policies/fable-pilot-policy.json's `pilot_enabled` flag, checked
 * separately by scripts/ops/planning-model-routing.ts). Either one being off blocks
 * routing -- this is deliberate defense in depth, not redundancy to prune. Setting
 * `status: "suspended"` here is a pure operational brake (cost, behavior, or policy
 * concern) and is not itself a verdict on Fable's quality -- that is what "independent
 * of the model being evaluated" means in the issue's required outcome.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';

export type FablePilotStatus = 'pending' | 'active' | 'suspended' | 'expired' | 'rolled_back';

export interface FableQualifyingTaskRecord {
  task_id: string;
  trigger_class: string;
  recorded_at: string;
  usage_usd: number;
}

export interface FablePilotState {
  schema_version: 1;
  status: FablePilotStatus;
  activated_at: string | null;
  expires_at: string | null;
  max_tasks: number;
  max_days: number;
  usage_ceiling_usd: number;
  task_count: number;
  usage_used_usd: number;
  qualifying_tasks: FableQualifyingTaskRecord[];
  updated_at: string;
  updated_by: string;
  reason: string;
}

export type FablePilotCheckCode =
  | 'PILOT_ACTIVE_WITHIN_CAPS'
  | 'PILOT_PENDING'
  | 'PILOT_SUSPENDED'
  | 'PILOT_EXPIRED'
  | 'PILOT_ROLLED_BACK'
  | 'PILOT_CAPS_EXCEEDED'
  | 'PILOT_STATE_MISSING'
  | 'PILOT_STATE_MALFORMED';

export interface FablePilotCheckResult {
  ok: boolean;
  code: FablePilotCheckCode;
  message: string;
  state?: FablePilotState;
  capsExceededReasons?: string[];
}

export const FABLE_PILOT_STATE_PATH = path.join(
  ROOT,
  'docs',
  '05_operations',
  'FABLE_PILOT_STATE.json',
);

const VALID_STATUSES: readonly FablePilotStatus[] = [
  'pending',
  'active',
  'suspended',
  'expired',
  'rolled_back',
];

/**
 * Strictly parse and validate the pilot state file. Never throws -- every failure mode
 * (missing file, unreadable file, invalid JSON, wrong shape, invalid `status`) is
 * captured in the returned result's `ok: false` / `code`, matching this repo's
 * MachineResult-style convention (see delegation-state.ts) so every call site can
 * branch on `.ok` without its own try/catch.
 */
export function readFablePilotState(
  filePath: string = FABLE_PILOT_STATE_PATH,
): FablePilotCheckResult {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      code: 'PILOT_STATE_MISSING',
      message: `Fable pilot state file not found at ${filePath}; treating Fable as ineligible (fail closed).`,
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      code: 'PILOT_STATE_MALFORMED',
      message: `Failed to read Fable pilot state file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      code: 'PILOT_STATE_MALFORMED',
      message: `Fable pilot state file at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      code: 'PILOT_STATE_MALFORMED',
      message: `Fable pilot state file at ${filePath} must be a JSON object.`,
    };
  }

  const candidate = parsed as Partial<FablePilotState>;
  if (!VALID_STATUSES.includes(candidate.status as FablePilotStatus)) {
    return {
      ok: false,
      code: 'PILOT_STATE_MALFORMED',
      message: `Fable pilot state file at ${filePath} has an invalid "status" value ${JSON.stringify(candidate.status ?? null)}; must be one of ${VALID_STATUSES.join(', ')}.`,
    };
  }
  if (
    typeof candidate.max_tasks !== 'number' ||
    typeof candidate.max_days !== 'number' ||
    typeof candidate.usage_ceiling_usd !== 'number' ||
    typeof candidate.task_count !== 'number' ||
    typeof candidate.usage_used_usd !== 'number'
  ) {
    return {
      ok: false,
      code: 'PILOT_STATE_MALFORMED',
      message: `Fable pilot state file at ${filePath} is missing one or more required numeric fields (max_tasks, max_days, usage_ceiling_usd, task_count, usage_used_usd).`,
    };
  }

  const state = candidate as FablePilotState;

  if (state.status === 'pending') {
    return {
      ok: false,
      code: 'PILOT_PENDING',
      message: `Fable pilot has not been activated (status: "pending"). Fable is not eligible until a human explicitly activates the pilot.`,
      state,
    };
  }
  if (state.status === 'suspended') {
    return {
      ok: false,
      code: 'PILOT_SUSPENDED',
      message: `Fable pilot is suspended (${filePath}). Fable routing is blocked until a human sets status back to "active".`,
      state,
    };
  }
  if (state.status === 'rolled_back') {
    return {
      ok: false,
      code: 'PILOT_ROLLED_BACK',
      message: `Fable pilot has been rolled back (terminal state). Fable is never eligible again without a fresh governance change.`,
      state,
    };
  }
  if (state.status === 'expired') {
    return {
      ok: false,
      code: 'PILOT_EXPIRED',
      message: `Fable pilot has expired (task/day/usage cap reached). Fable routing reverts to Sonnet-only until a fresh governance decision.`,
      state,
    };
  }

  // status === 'active' -- still subject to the mechanical cap check.
  const caps = evaluatePilotCaps(state);
  if (!caps.withinCaps) {
    return {
      ok: false,
      code: 'PILOT_CAPS_EXCEEDED',
      message: `Fable pilot cap(s) exceeded: ${caps.reasons.join('; ')}. Routing to Fable is blocked (fail closed) even though status still reads "active" -- the state file was not yet mechanically flipped to "expired".`,
      state,
      capsExceededReasons: caps.reasons,
    };
  }

  return {
    ok: true,
    code: 'PILOT_ACTIVE_WITHIN_CAPS',
    message: `Fable pilot is active and within all caps (${filePath}).`,
    state,
  };
}

export interface PilotCapEvaluation {
  withinCaps: boolean;
  reasons: string[];
  tasksRemaining: number;
  daysRemaining: number | null;
  usageRemainingUsd: number;
}

/**
 * Pure cap-evaluation function: given a pilot state and a reference time, determine
 * whether the pilot is still within its 8-task / 30-day / usage-budget bounds. Never
 * mutates the input. Used both by readFablePilotState (to fail closed even if the
 * status field lags reality) and by recordQualifyingTask (to compute the next status).
 */
export function evaluatePilotCaps(
  state: FablePilotState,
  now: Date = new Date(),
): PilotCapEvaluation {
  const reasons: string[] = [];

  const tasksRemaining = state.max_tasks - state.task_count;
  if (tasksRemaining <= 0) {
    reasons.push(
      `task cap reached (${state.task_count}/${state.max_tasks} qualifying tasks)`,
    );
  }

  let daysRemaining: number | null = null;
  if (state.activated_at) {
    const activatedAt = new Date(state.activated_at);
    const expiresAt = state.expires_at
      ? new Date(state.expires_at)
      : new Date(activatedAt.getTime() + state.max_days * 24 * 60 * 60 * 1000);
    const msRemaining = expiresAt.getTime() - now.getTime();
    daysRemaining = msRemaining / (24 * 60 * 60 * 1000);
    if (msRemaining <= 0) {
      reasons.push(
        `day cap reached (activated ${state.activated_at}, ${state.max_days}-day window elapsed)`,
      );
    }
  }

  const usageRemainingUsd = state.usage_ceiling_usd - state.usage_used_usd;
  if (usageRemainingUsd <= 0) {
    reasons.push(
      `usage ceiling reached ($${state.usage_used_usd.toFixed(2)}/$${state.usage_ceiling_usd.toFixed(2)})`,
    );
  }

  return {
    withinCaps: reasons.length === 0,
    reasons,
    tasksRemaining: Math.max(tasksRemaining, 0),
    daysRemaining,
    usageRemainingUsd: Math.max(usageRemainingUsd, 0),
  };
}

/**
 * Pure state-transition function: given the current state, a new qualifying task, and
 * a reference time, return the NEXT state -- task_count incremented, usage accrued,
 * the task appended to the ledger, and status mechanically recomputed. If the new
 * totals breach any cap, status flips to "expired" in the SAME transition -- there is
 * no intermediate state where caps are exceeded but status still reads "active".  This
 * is the fail-closed guarantee the issue's required outcome asks for ("do not permit
 * silent continued routing after expiry or budget exhaustion").
 *
 * Never mutates the input `state`; never writes to disk. Callers persist the returned
 * object themselves (keeps this fully unit-testable without a filesystem).
 */
export function recordQualifyingTask(
  state: FablePilotState,
  task: { taskId: string; triggerClass: string; usageDeltaUsd: number },
  now: Date = new Date(),
): FablePilotState {
  if (state.status !== 'active') {
    throw new Error(
      `Cannot record a qualifying task against a pilot whose status is "${state.status}" (must be "active"). This would silently resurrect an inactive pilot.`,
    );
  }
  const nextState: FablePilotState = {
    ...state,
    task_count: state.task_count + 1,
    usage_used_usd: Number((state.usage_used_usd + task.usageDeltaUsd).toFixed(2)),
    qualifying_tasks: [
      ...state.qualifying_tasks,
      {
        task_id: task.taskId,
        trigger_class: task.triggerClass,
        recorded_at: now.toISOString(),
        usage_usd: task.usageDeltaUsd,
      },
    ],
    updated_at: now.toISOString(),
  };
  const caps = evaluatePilotCaps(nextState, now);
  if (!caps.withinCaps) {
    nextState.status = 'expired';
    nextState.reason = `Auto-expired by recordQualifyingTask: ${caps.reasons.join('; ')}.`;
  }
  return nextState;
}

/**
 * Pure transition: mark the pilot suspended. Independent of task/day/usage caps and
 * independent of any judgment about Fable's output quality -- this is a pure
 * operational brake (UTV2-1569 required outcome: "a suspension/kill path independent
 * of the model being evaluated"). Valid from any non-terminal status.
 */
export function suspendPilot(
  state: FablePilotState,
  reason: string,
  updatedBy: string,
  now: Date = new Date(),
): FablePilotState {
  if (state.status === 'rolled_back') {
    throw new Error('Cannot suspend a pilot that has been rolled back (terminal state).');
  }
  return {
    ...state,
    status: 'suspended',
    updated_at: now.toISOString(),
    updated_by: updatedBy,
    reason,
  };
}

/**
 * Pure transition: activate the pilot (start the clock). NOT called anywhere in
 * UTV2-1569's own implementation or tests as a real state mutation of the shipped
 * FABLE_PILOT_STATE.json -- this function exists so the mechanism is complete and
 * testable, but actually invoking it against the real file is a real operational
 * decision reserved for a human (Griff), never an agent. Only valid from "pending".
 */
export function activatePilot(
  state: FablePilotState,
  updatedBy: string,
  now: Date = new Date(),
): FablePilotState {
  if (state.status !== 'pending') {
    throw new Error(
      `Cannot activate a pilot whose status is "${state.status}" (must be "pending"). Re-activating an expired/suspended/rolled-back pilot requires a fresh governance decision, not this function.`,
    );
  }
  const activatedAt = now;
  const expiresAt = new Date(activatedAt.getTime() + state.max_days * 24 * 60 * 60 * 1000);
  return {
    ...state,
    status: 'active',
    activated_at: activatedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    updated_at: now.toISOString(),
    updated_by: updatedBy,
    reason: `Pilot activated by ${updatedBy} at ${activatedAt.toISOString()}.`,
  };
}

/**
 * Pure transition: terminal rollback. Once rolled_back, no function in this module
 * (activatePilot included) will ever transition the state back to pending/active --
 * activatePilot's guard only accepts "pending" as a starting point, and this function
 * is the only writer of "rolled_back". See scripts/ops/fable-pilot-rollback.ts, which
 * calls this alongside disabling the policy's pilot_enabled flag.
 */
export function rollbackPilot(
  state: FablePilotState,
  reason: string,
  updatedBy: string,
  now: Date = new Date(),
): FablePilotState {
  return {
    ...state,
    status: 'rolled_back',
    updated_at: now.toISOString(),
    updated_by: updatedBy,
    reason,
  };
}

/** Persist a state object to disk. Thin wrapper so tests can inject a temp path. */
export function writeFablePilotState(
  state: FablePilotState,
  filePath: string = FABLE_PILOT_STATE_PATH,
): void {
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// --- CLI ---------------------------------------------------------------------------
// Minimal operator CLI for status/suspend/activate/record-task. Mirrors the existing
// scripts/ops/*.ts CLI convention (parse argv, emit JSON, exit non-zero on failure).
// `activate` is real and functional (the mechanism must exist), but is never invoked
// by any script, test, or lane in this issue's own diff against the real state file --
// see the module doc comment above and docs/05_operations/FABLE_PILOT_ROLLBACK.md.
function isMainModule(): boolean {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
  const thisFile = path.resolve(new URL(import.meta.url).pathname);
  return invoked === thisFile;
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  const state = readFablePilotState();

  if (command === 'status' || !command) {
    const caps = state.state ? evaluatePilotCaps(state.state) : null;
    console.log(JSON.stringify({ ...state, caps }, null, 2));
    process.exit(state.ok ? 0 : 1);
  }

  if (!state.state) {
    console.log(JSON.stringify({ ok: false, message: 'Cannot mutate: state file missing or malformed.' }, null, 2));
    process.exit(1);
  }

  if (command === 'suspend') {
    const reasonIdx = process.argv.indexOf('--reason');
    const reason = reasonIdx >= 0 ? process.argv[reasonIdx + 1] : 'manual suspension via CLI';
    const byIdx = process.argv.indexOf('--by');
    const by = byIdx >= 0 ? process.argv[byIdx + 1] : 'unknown';
    const next = suspendPilot(state.state, reason ?? 'manual suspension via CLI', by ?? 'unknown');
    writeFablePilotState(next);
    console.log(JSON.stringify({ ok: true, code: 'PILOT_SUSPENDED', state: next }, null, 2));
    process.exit(0);
  }

  if (command === 'activate') {
    const byIdx = process.argv.indexOf('--by');
    const by = byIdx >= 0 ? process.argv[byIdx + 1] : 'unknown';
    const next = activatePilot(state.state, by ?? 'unknown');
    writeFablePilotState(next);
    console.log(JSON.stringify({ ok: true, code: 'PILOT_ACTIVATED', state: next }, null, 2));
    process.exit(0);
  }

  console.log(JSON.stringify({ ok: false, message: `Unknown command "${command}". Use: status | suspend | activate` }, null, 2));
  process.exit(1);
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
