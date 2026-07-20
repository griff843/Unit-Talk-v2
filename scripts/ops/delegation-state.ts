/**
 * Delegation kill switch (UTV2-1546): shared, strict reader for
 * docs/05_operations/DELEGATION_STATE.json, consulted fail-closed by every
 * autonomous dispatch/execution entry point (preflight.ts, lane-start.ts,
 * codex-exec.ts, claude-exec.ts).
 *
 * Scope / non-goals -- read this before wiring a new call site:
 *
 * This switch protects against RUNAWAY AUTOMATION: an operator can set
 * `delegation: "suspended"` to stop new lane starts and new executor process
 * spawns without touching git, GitHub, or Linear state, and without needing to
 * kill any in-flight process. It is explicitly NOT a security boundary and must
 * never be described as one -- it is not a defense against a malicious actor who
 * already holds a valid repo token or shell access, since that actor could
 * simply edit this same file back to "active" (or invoke the underlying tools
 * directly, bypassing every one of the four call sites entirely). Treat it as a
 * brake pedal for trusted automation, not a lock against an untrusted party.
 *
 * Fail-closed by construction: a missing file, a file that fails to parse as
 * JSON, a file whose shape doesn't include a `delegation` field, or a
 * `delegation` value that is anything other than the literal strings "active"
 * or "suspended" -- all of these resolve to the same blocked result. There is
 * no default-open code path anywhere in readDelegationState. Only an exact
 * `delegation: "active"` value unblocks a caller.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';

export type DelegationValue = 'active' | 'suspended';

export interface DelegationState {
  schema_version: 1;
  delegation: DelegationValue;
  updated_at: string;
  updated_by: string;
  reason: string;
}

export type DelegationCheckCode =
  | 'DELEGATION_ACTIVE'
  | 'DELEGATION_SUSPENDED'
  | 'DELEGATION_STATE_MISSING'
  | 'DELEGATION_STATE_MALFORMED';

export interface DelegationCheckResult {
  ok: boolean;
  code: DelegationCheckCode;
  message: string;
  state?: DelegationState;
}

export const DELEGATION_STATE_PATH = path.join(
  ROOT,
  'docs',
  '05_operations',
  'DELEGATION_STATE.json',
);

/**
 * Strictly parse and validate docs/05_operations/DELEGATION_STATE.json (or an
 * explicitly injected path, for tests). Never throws -- every failure mode
 * (missing file, unreadable file, invalid JSON, wrong shape, invalid
 * `delegation` value) is captured in the returned result's `ok: false` /
 * `code`, matching this repo's MachineResult-style convention (see
 * `MachineResult<T>` in shared.ts) so every call site can branch on `.ok`
 * without a try/catch of its own.
 */
export function readDelegationState(
  filePath: string = DELEGATION_STATE_PATH,
): DelegationCheckResult {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      code: 'DELEGATION_STATE_MISSING',
      message: `Delegation state file not found at ${filePath}; treating delegation as suspended (fail closed).`,
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      code: 'DELEGATION_STATE_MALFORMED',
      message: `Failed to read delegation state file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      code: 'DELEGATION_STATE_MALFORMED',
      message: `Delegation state file at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      code: 'DELEGATION_STATE_MALFORMED',
      message: `Delegation state file at ${filePath} must be a JSON object.`,
    };
  }

  const candidate = parsed as Partial<DelegationState>;
  if (candidate.delegation !== 'active' && candidate.delegation !== 'suspended') {
    return {
      ok: false,
      code: 'DELEGATION_STATE_MALFORMED',
      message: `Delegation state file at ${filePath} has an invalid "delegation" value ${JSON.stringify(candidate.delegation ?? null)}; must be exactly "active" or "suspended".`,
    };
  }

  const state = candidate as DelegationState;

  if (state.delegation === 'suspended') {
    return {
      ok: false,
      code: 'DELEGATION_SUSPENDED',
      message: `Delegation is suspended (${filePath}). New lane starts and new executor process spawns are blocked until a human sets "delegation" to "active".`,
      state,
    };
  }

  return {
    ok: true,
    code: 'DELEGATION_ACTIVE',
    message: `Delegation is active (${filePath}).`,
    state,
  };
}

/**
 * Call-site wrapper around readDelegationState: prefixes the message with a
 * `context` label (e.g. "preflight", "lane-start", "codex-exec",
 * "claude-exec") for diagnostics. Deliberately does NOT call process.exit or
 * throw -- the four call sites each have their own, already-established
 * exit-code/emission conventions (preflight.ts's checks-array + verdict model,
 * lane-start.ts's emitJson + process.exit(1), codex-exec.ts/claude-exec.ts's
 * emitJson + process.exit(2) for PRECONDITION_FAILED). Keeping this function
 * side-effect-free keeps it trivially unit-testable and reusable across all
 * four call sites without forcing one exit-code convention onto the others.
 */
export function requireDelegationActive(
  context: string,
  filePath: string = DELEGATION_STATE_PATH,
): DelegationCheckResult {
  const result = readDelegationState(filePath);
  if (result.ok) {
    return result;
  }
  return {
    ...result,
    message: `[${context}] ${result.message}`,
  };
}
