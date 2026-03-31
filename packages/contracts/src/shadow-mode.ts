/**
 * Shadow Mode Configuration Contract
 *
 * Defines the subsystems that support shadow mode and the configuration
 * shape used to enable/disable shadow execution per subsystem.
 *
 * When shadow mode is active for a subsystem, it runs its logic but
 * writes results to shadow_runs instead of taking real action.
 */

export const shadowableSubsystems = [
  'grading',
  'scoring',
  'routing',
] as const;

export type ShadowableSubsystem = (typeof shadowableSubsystems)[number];

export interface ShadowModeConfig {
  /** Per-subsystem shadow enable flags */
  readonly enabledSubsystems: ReadonlySet<ShadowableSubsystem>;
}
