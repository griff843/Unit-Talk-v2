/**
 * Shadow Mode — pure computation helpers
 *
 * Parses the UNIT_TALK_SHADOW_MODE env var into a ShadowModeConfig,
 * checks whether a given subsystem is shadow-enabled, and defines the
 * ShadowRunResult type that subsystems will emit when running in shadow mode.
 */

import {
  shadowableSubsystems,
  type ShadowableSubsystem,
  type ShadowModeConfig,
} from '@unit-talk/contracts';

/**
 * Parse a comma-separated env value (e.g. "grading,scoring") into a
 * validated ShadowModeConfig.  Unknown subsystem names are silently
 * ignored so that a typo does not crash the process.
 */
export function parseShadowModeEnv(raw: string | undefined): ShadowModeConfig {
  if (!raw || raw.trim() === '') {
    return { enabledSubsystems: new Set<ShadowableSubsystem>() };
  }

  const validSet = new Set<string>(shadowableSubsystems as readonly string[]);
  const enabled = new Set<ShadowableSubsystem>();

  for (const token of raw.split(',')) {
    const trimmed = token.trim().toLowerCase();
    if (validSet.has(trimmed)) {
      enabled.add(trimmed as ShadowableSubsystem);
    }
  }

  return { enabledSubsystems: enabled };
}

/**
 * Check whether a subsystem is running in shadow mode.
 */
export function isShadowEnabled(
  config: ShadowModeConfig,
  subsystem: ShadowableSubsystem,
): boolean {
  return config.enabledSubsystems.has(subsystem);
}

/**
 * Result emitted by a subsystem executing in shadow mode.
 * The subsystem runs its full logic but the result is captured here
 * rather than taking real action (e.g. writing to production tables,
 * posting to Discord, etc.).
 */
export interface ShadowRunResult {
  /** Which subsystem produced this shadow run */
  subsystem: ShadowableSubsystem;
  /** ISO-8601 timestamp of when the shadow run executed */
  executedAt: string;
  /** The input that was fed to the subsystem */
  input: Record<string, unknown>;
  /** The output the subsystem would have produced in production */
  output: Record<string, unknown>;
  /** Duration of the shadow execution in milliseconds */
  durationMs: number;
  /** Optional notes or warnings from the shadow run */
  notes?: string[];
}

/**
 * Build a ShadowRunResult. Pure helper — no I/O.
 */
export function buildShadowRunResult(params: {
  subsystem: ShadowableSubsystem;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  durationMs: number;
  notes?: string[];
}): ShadowRunResult {
  const result: ShadowRunResult = {
    subsystem: params.subsystem,
    executedAt: new Date().toISOString(),
    input: params.input,
    output: params.output,
    durationMs: params.durationMs,
  };
  if (params.notes !== undefined) {
    result.notes = params.notes;
  }
  return result;
}
