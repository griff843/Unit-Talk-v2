/**
 * VERIFICATION & SIMULATION CONTROL PLANE — RunController
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R1
 *
 * Orchestration shell for controlled execution runs.
 *
 * R1 scope:
 *   - Mode parsing and validation
 *   - Dependency wiring and manifest validation
 *   - Invalid mode+adapter combination rejection
 *   - Explicit mode and adapter manifest emission
 *
 * NOT in R1 scope:
 *   - Full replay sequencing (R2)
 *   - Shadow comparator (R3)
 *   - Fault injection orchestration (R4)
 *   - Execution / strategy simulation (R5)
 */

import { assertManifestConsistency, isProductionMode } from './adapters.js';

import type { AdapterManifest, ExecutionMode } from './adapters.js';
import type { ClockProvider, MutableClockProvider } from './clock.js';

// ─────────────────────────────────────────────────────────────
// RUN CONFIGURATION
// ─────────────────────────────────────────────────────────────

export interface RunConfig {
  /** Unique identifier for this run. Caller is responsible for uniqueness. */
  runId: string;

  /** Execution mode. Immutable after RunController construction. */
  mode: ExecutionMode;

  /** Clock source. Must match mode expectations. */
  clock: ClockProvider;

  /** Complete adapter manifest. All adapters must agree on mode. */
  adapters: AdapterManifest;
}

// ─────────────────────────────────────────────────────────────
// RUN MANIFEST — emitted at init for proof/audit
// ─────────────────────────────────────────────────────────────

/** Describes the wiring of a RunController instance. Emitted at init. */
export interface RunManifest {
  runId: string;
  mode: ExecutionMode;
  clockMode: 'real' | 'virtual';
  adapters: {
    publish: string; // adapter class name
    notification: string;
    feed: string;
    settlement: string;
    recap: string;
  };
  initialisedAt: string;
}

// ─────────────────────────────────────────────────────────────
// VALIDATION RULES
// ─────────────────────────────────────────────────────────────

/**
 * Validates that the clock mode is compatible with the execution mode.
 *
 * production → real clock required
 * replay / fault / simulation → virtual clock required
 * shadow → real clock required (runs in real time alongside production)
 */
function assertClockModeCompatibility(mode: ExecutionMode, clock: ClockProvider): void {
  if (mode === 'production' && clock.mode !== 'real') {
    throw new Error(`RunController: production mode requires a real clock, got '${clock.mode}'.`);
  }
  if (['replay', 'fault', 'simulation'].includes(mode) && clock.mode !== 'virtual') {
    throw new Error(
      `RunController: ${mode} mode requires a virtual clock, got '${clock.mode}'. ` +
        `Use VirtualEventClock.`
    );
  }
  // shadow accepts either (may use real clock to stay aligned with production)
}

/**
 * Validates that the adapter manifest is safe for the given mode.
 * In particular: production adapters must not appear in non-production runs.
 */
function assertAdapterSafety(mode: ExecutionMode, adapters: AdapterManifest): void {
  // All adapters must agree on mode (checked by assertManifestConsistency)
  assertManifestConsistency(adapters);

  if (isProductionMode(mode) && adapters.publish.mode !== 'production') {
    throw new Error(
      `RunController: production mode requires a production publish adapter, ` +
        `got '${adapters.publish.mode}'.`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// RunController
// ─────────────────────────────────────────────────────────────

/**
 * Orchestration shell for a single controlled execution run.
 *
 * Responsibilities (R1):
 *   - Validate mode, clock, and adapter compatibility on construction
 *   - Expose the validated manifest for downstream consumption
 *   - Emit a RunManifest describing the wiring (for proof bundles)
 *   - Provide a typed accessor for the virtual clock (when in virtual mode)
 *
 * In R2+, RunController will gain:
 *   - Full event sequencing for replay
 *   - Shadow comparison integration
 *   - Fault scenario injection
 */
export class RunController {
  private readonly config: Readonly<RunConfig>;
  private readonly manifest: RunManifest;

  constructor(config: RunConfig) {
    // --- Structural validation ---
    if (!config.runId || config.runId.trim() === '') {
      throw new Error('RunController: runId must be a non-empty string.');
    }

    assertClockModeCompatibility(config.mode, config.clock);
    assertAdapterSafety(config.mode, config.adapters);

    this.config = Object.freeze({ ...config });

    this.manifest = {
      runId: config.runId,
      mode: config.mode,
      clockMode: config.clock.mode,
      adapters: {
        publish: config.adapters.publish.constructor.name,
        notification: config.adapters.notification.constructor.name,
        feed: config.adapters.feed.constructor.name,
        settlement: config.adapters.settlement.constructor.name,
        recap: config.adapters.recap.constructor.name,
      },
      initialisedAt: new Date().toISOString(), // WALL-CLOCK-ALLOWED: manifest init timestamp, non-lifecycle
    };
  }

  // ─────────────────────────────────────────────────────────────
  // ACCESSORS
  // ─────────────────────────────────────────────────────────────

  get runId(): string {
    return this.config.runId;
  }

  get mode(): ExecutionMode {
    return this.config.mode;
  }

  get clock(): ClockProvider {
    return this.config.clock;
  }

  get adapters(): AdapterManifest {
    return this.config.adapters;
  }

  /**
   * Returns the RunManifest describing the wiring of this controller.
   * Include this in proof bundles to document adapter and clock selection.
   */
  getManifest(): Readonly<RunManifest> {
    return this.manifest;
  }

  /**
   * Returns the clock cast as MutableClockProvider for virtual modes.
   * Throws if the clock is not a virtual (mutable) clock.
   *
   * Use this in replay/fault/simulation controllers to advance time.
   */
  getMutableClock(): MutableClockProvider {
    const clock = this.config.clock;
    if (clock.mode !== 'virtual') {
      throw new Error(
        `RunController.getMutableClock(): clock is not virtual (mode='${clock.mode}'). ` +
          `Only virtual clocks support time advancement.`
      );
    }
    return clock as MutableClockProvider;
  }
}

// ─────────────────────────────────────────────────────────────
// FACTORY — mode parsing
// ─────────────────────────────────────────────────────────────

/** All valid execution mode strings. */
export const VALID_EXECUTION_MODES: ReadonlyArray<ExecutionMode> = [
  'production',
  'replay',
  'shadow',
  'fault',
  'simulation',
];

/**
 * Parse and validate an execution mode from a raw string.
 * Throws if the string is not a valid ExecutionMode.
 *
 * Use when reading mode from environment variables or CLI arguments.
 */
export function parseExecutionMode(raw: string): ExecutionMode {
  const normalised = raw.trim().toLowerCase() as ExecutionMode;
  if (!VALID_EXECUTION_MODES.includes(normalised)) {
    throw new Error(
      `parseExecutionMode: '${raw}' is not a valid execution mode. ` +
        `Valid modes: ${VALID_EXECUTION_MODES.join(', ')}.`
    );
  }
  return normalised;
}
