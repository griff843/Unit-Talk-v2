import type { PickLifecycleState, PickSource, SubmissionPayload, WriterRole } from '@unit-talk/contracts';
import { evaluateEdgePriceFreshness } from '@unit-talk/domain';
import { GOVERNANCE_BRAKE_SOURCES } from './distribution-service.js';

/**
 * How a source is admitted to the automated write boundary.
 *
 *  - `boundary-required`   the source has NO direct-to-validated release
 *                          class. EVERY submission enters the boundary,
 *                          marker or not. A missing producer identity or
 *                          missing market evidence fails closed (throws)
 *                          rather than degrading to `validated`.
 *  - `boundary-when-marked` the source has a ratified source-only governed
 *                          path (the Phase 7A brake). A `systemGenerated`
 *                          marker opts a full production into this stricter
 *                          boundary; without it the source brake governs.
 *  - `human-ingress`       human or externally-relayed submission. The normal
 *                          `validated` path applies.
 */
type AutomatedWriteBoundaryPolicy =
  | 'boundary-required'
  | 'boundary-when-marked'
  | 'human-ingress';

/**
 * Every current PickSource must make an explicit write-boundary decision. The
 * `satisfies Record<PickSource, ...>` makes adding a valid source a compile
 * error until its policy is chosen. Runtime values outside PickSource are
 * rejected by the submission parser; direct typed callers can still opt into
 * the boundary with `systemGenerated: true`.
 *
 * UTV2-1611: `board-construction` is `boundary-required`, not
 * `boundary-when-marked`. The previous marker-only admission meant a board
 * submission that simply omitted `metadata.systemGenerated` was treated as a
 * human write and persisted as `validated` — governance that depended on every
 * producer remembering to stamp a field. Admission is now decided by the
 * SOURCE, which the producer cannot forget to set.
 */
const AUTOMATED_WRITE_BOUNDARY_POLICY = {
  'smart-form': 'human-ingress',
  feed: 'human-ingress',
  system: 'human-ingress',
  api: 'human-ingress',
  'discord-bot': 'human-ingress',
  'alert-agent': 'boundary-when-marked',
  'model-driven': 'boundary-when-marked',
  'system-pick-scanner': 'boundary-when-marked',
  'board-construction': 'boundary-required',
} as const satisfies Record<PickSource, AutomatedWriteBoundaryPolicy>;

/**
 * Structural invariant, checked once at module load: a source may only be
 * classified as automated here if it is ALSO a member of
 * `GOVERNANCE_BRAKE_SOURCES`. That set is keyed on source alone and needs no
 * marker, so it is the fallback brake that catches anything which bypasses
 * this boundary. Without the invariant the two mechanisms can drift and a
 * source can end up with no brake at all — exactly the state
 * `board-construction` was in before UTV2-1611.
 *
 * This is deliberately a hard throw at import time rather than a lint rule: a
 * misclassified source must take the process down, not ship.
 */
export function assertEveryAutomatedSourceIsBraked(
  policyBySource: Readonly<Record<string, AutomatedWriteBoundaryPolicy>>,
  brakeSources: ReadonlySet<string>,
): void {
  for (const [source, policy] of Object.entries(policyBySource)) {
    if (policy === 'human-ingress') continue;
    if (!brakeSources.has(source)) {
      throw new Error(
        `Automated write boundary misconfiguration: source "${source}" is classified ` +
          `"${policy}" but is absent from GOVERNANCE_BRAKE_SOURCES, so it has no ` +
          'source-keyed fallback brake. Add it to GOVERNANCE_BRAKE_SOURCES in ' +
          'distribution-service.ts or classify it as "human-ingress".',
      );
    }
  }
}

assertEveryAutomatedSourceIsBraked(
  AUTOMATED_WRITE_BOUNDARY_POLICY,
  GOVERNANCE_BRAKE_SOURCES as ReadonlySet<string>,
);

export type AutomatedWriteBoundaryFailureCode =
  | 'MISSING_AUTOMATED_PRODUCER'
  | 'MISSING_MARKET_UNIVERSE_ID'
  | 'MISSING_PROVIDER_MARKET_KEY'
  | 'MISSING_PRICE_SNAPSHOT_AT'
  | 'MISSING_PRICE_PROVIDER_KEY'
  | 'STALE_PRICE_SNAPSHOT'
  | 'AUTOMATED_DIRECT_TO_VALIDATED';

export interface AutomatedWriteBoundaryMetadata {
  schemaVersion: 1;
  producer: string;
  source: string;
  sourceSnapshotAt: string;
  sourceSnapshotAgeMs: number;
  transitionActor: string;
  transitionReason: string;
  requiredState: 'awaiting_approval';
}

export interface AutomatedWriteBoundaryDecision {
  automated: boolean;
  payload: SubmissionPayload;
  initialLifecycleState?: 'awaiting_approval';
  lifecycleWriterRole?: WriterRole;
  lifecycleReason?: string;
}

export interface AutomatedPickWriteObservation {
  source: PickSource;
  status: PickLifecycleState | string;
  metadata: Record<string, unknown> | null | undefined;
}

export interface AutomatedWriteBoundaryViolation {
  code: 'AUTOMATED_DIRECT_TO_VALIDATED';
  source: string;
  status: string;
}

export class AutomatedWriteBoundaryError extends Error {
  public readonly code: AutomatedWriteBoundaryFailureCode;

  constructor(code: AutomatedWriteBoundaryFailureCode, detail: string) {
    super(`Automated write boundary rejected submission: ${code} (${detail})`);
    this.name = 'AutomatedWriteBoundaryError';
    this.code = code;
  }
}

/**
 * Admission to the automated write boundary. Two independent routes:
 *
 *  1. SOURCE. A `boundary-required` source is admitted unconditionally. This is
 *     the route that closes UTV2-1611: `board-construction` has no
 *     direct-to-validated release class, so a board submission enters the
 *     boundary whether or not the producer stamped `systemGenerated`. Keying
 *     admission on the marker alone made governance a function of producer
 *     discipline — one forgotten field released an ungoverned pick.
 *  2. MARKER. `metadata.systemGenerated === true` opts any submission into the
 *     boundary, including sources typed `boundary-when-marked` and runtime
 *     source values outside `PickSource`.
 *
 * `boundary-when-marked` sources (system-pick-scanner, alert-agent,
 * model-driven) are NOT admitted by source. They have a ratified source-only
 * governed path: the Phase 7A brake in `distribution-service.ts`, keyed on
 * source and needing no marker, which `t1-proof-awaiting-approval.test.ts`
 * exercises with minimal fixtures carrying no producer identity and no market
 * evidence. Admitting those by source would fail them closed and convert a
 * ratified governed path into dropped submissions. They are still braked —
 * the module-load invariant above proves every automated source is in
 * GOVERNANCE_BRAKE_SOURCES.
 *
 * Adding a valid source cannot compile until it is deliberately classified in
 * AUTOMATED_WRITE_BOUNDARY_POLICY above.
 */
export function isAutomatedProducerSubmission(payload: SubmissionPayload): boolean {
  if (payload.metadata?.['systemGenerated'] === true) {
    return true;
  }
  return readBoundaryPolicy(payload.source) === 'boundary-required';
}

/**
 * Enforces the final write boundary shared by every automated board/scanner
 * producer. The returned initial state is persisted in the same atomic write as
 * the pick and its birth lifecycle event; there is no transient `validated`
 * state for a scheduler or distribution path to observe.
 */
export function prepareAutomatedSubmission(
  payload: SubmissionPayload,
  nowMs = Date.now(),
): AutomatedWriteBoundaryDecision {
  if (!isAutomatedProducerSubmission(payload)) {
    return { automated: false, payload };
  }

  // Everything past this point FAILS CLOSED. An admitted submission that cannot
  // produce a complete, attributable, fresh write-boundary record is rejected
  // before persistence: it is never silently downgraded to a non-automated
  // write and never defaults to `validated`. For a `boundary-required` source
  // this is the whole point — a board production with no producer identity or
  // no market evidence is not releasable in any state, so it must not be
  // written at all.
  const metadata = payload.metadata ?? {};

  const producer = readNonEmptyString(payload.submittedBy);
  if (producer === null) {
    throw new AutomatedWriteBoundaryError(
      'MISSING_AUTOMATED_PRODUCER',
      'submittedBy must identify the automated producer',
    );
  }

  if (readNonEmptyString(metadata['marketUniverseId']) === null) {
    throw new AutomatedWriteBoundaryError(
      'MISSING_MARKET_UNIVERSE_ID',
      'metadata.marketUniverseId is required',
    );
  }

  if (readNonEmptyString(metadata['providerMarketKey']) === null) {
    throw new AutomatedWriteBoundaryError(
      'MISSING_PROVIDER_MARKET_KEY',
      'metadata.providerMarketKey is required',
    );
  }

  const freshness = evaluateEdgePriceFreshness({
    priceSnapshotAt: readNonEmptyString(metadata['snapshot_at']),
    priceProviderKey: readNonEmptyString(metadata['providerKey']),
    eventStartsAt:
      readNonEmptyString(metadata['eventStartTime']) ??
      readNonEmptyString(metadata['eventTime']),
    sportKey:
      readNonEmptyString(metadata['sportKey']) ?? readNonEmptyString(metadata['sport']),
    marketKey: payload.market,
    nowMs,
  });

  if (!freshness.ok) {
    const code = freshness.reason === 'missing_price_snapshot_at'
      ? 'MISSING_PRICE_SNAPSHOT_AT'
      : freshness.reason === 'missing_price_provider_key'
        ? 'MISSING_PRICE_PROVIDER_KEY'
        : 'STALE_PRICE_SNAPSHOT';
    throw new AutomatedWriteBoundaryError(code, freshness.reason);
  }

  const source = String(payload.source);
  const transitionReason =
    `automated write boundary: ${source} produced by ${producer} requires operator approval`;
  const boundaryMetadata: AutomatedWriteBoundaryMetadata = {
    schemaVersion: 1,
    producer,
    source,
    sourceSnapshotAt: freshness.priceSnapshotAt,
    sourceSnapshotAgeMs: freshness.snapshotAgeMs,
    transitionActor: producer,
    transitionReason,
    requiredState: 'awaiting_approval',
  };

  return {
    automated: true,
    payload: {
      ...payload,
      metadata: {
        ...metadata,
        snapshot_at: freshness.priceSnapshotAt,
        snapshot_age_ms: freshness.snapshotAgeMs,
        proximity_tier: freshness.proximityTier,
        freshness_threshold_ms: freshness.freshnessThresholdMs,
        data_freshness: 'fresh',
        automatedWriteBoundary: boundaryMetadata,
      },
    },
    initialLifecycleState: 'awaiting_approval',
    lifecycleWriterRole: 'promoter',
    lifecycleReason: transitionReason,
  };
}

/** Readiness/reporting helper for mechanically identifying the forbidden state. */
export function detectAutomatedDirectToValidatedWrite(
  observation: AutomatedPickWriteObservation,
): AutomatedWriteBoundaryViolation | null {
  // `validated` is forbidden as a RESTING state, not merely as a state.
  //
  // For a `boundary-required` source it is never legal at all: the pick is born
  // in `awaiting_approval`, so a `validated` row is by definition an ungoverned
  // direct write. The marker says the same thing for any source, including
  // runtime values outside PickSource.
  //
  // A `boundary-when-marked` source with NO marker is deliberately NOT flagged
  // by source alone: its ratified governed path is the Phase 7A brake, which
  // moves it validated -> awaiting_approval, so `validated` is a legal
  // transient there. Flagging it would turn a lawful in-flight state into a
  // hard failure on the idempotent re-submission path.
  const policy = readBoundaryPolicy(observation.source);
  const automated =
    observation.metadata?.['systemGenerated'] === true || policy === 'boundary-required';
  if (!automated || observation.status !== 'validated') {
    return null;
  }

  return {
    code: 'AUTOMATED_DIRECT_TO_VALIDATED',
    source: String(observation.source),
    status: observation.status,
  };
}

export function assertNoAutomatedDirectToValidatedWrite(
  observation: AutomatedPickWriteObservation,
): void {
  const violation = detectAutomatedDirectToValidatedWrite(observation);
  if (violation) {
    throw new AutomatedWriteBoundaryError(
      violation.code,
      `${violation.source} pick was observed in ${violation.status}`,
    );
  }
}

function readBoundaryPolicy(source: PickSource | string): AutomatedWriteBoundaryPolicy | undefined {
  const policyByRuntimeSource = AUTOMATED_WRITE_BOUNDARY_POLICY as Readonly<
    Partial<Record<string, AutomatedWriteBoundaryPolicy>>
  >;
  return policyByRuntimeSource[source];
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
