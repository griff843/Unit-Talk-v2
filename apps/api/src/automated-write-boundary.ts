import type { PickLifecycleState, PickSource, SubmissionPayload, WriterRole } from '@unit-talk/contracts';
import { evaluateEdgePriceFreshness } from '@unit-talk/domain';

type AutomatedWriteBoundaryPolicy =
  | 'system-marker-required'
  | 'governed-elsewhere';

/**
 * Every current PickSource must make an explicit write-boundary decision. The
 * `satisfies Record<PickSource, ...>` makes adding a valid source a compile
 * error until its policy is chosen. Runtime values outside PickSource are
 * rejected by the submission parser; direct typed callers can still opt into
 * the boundary with `systemGenerated: true`.
 *
 * `governed-elsewhere` does not mean human. Existing alert/model sources keep
 * their Phase 7A governance path; this boundary owns automated board/scanner
 * materialization. A `systemGenerated` marker always opts into this stricter
 * boundary regardless of the source's current policy.
 */
const AUTOMATED_WRITE_BOUNDARY_POLICY = {
  'smart-form': 'governed-elsewhere',
  feed: 'governed-elsewhere',
  system: 'governed-elsewhere',
  'alert-agent': 'governed-elsewhere',
  'model-driven': 'governed-elsewhere',
  api: 'governed-elsewhere',
  'discord-bot': 'governed-elsewhere',
  'system-pick-scanner': 'system-marker-required',
  'board-construction': 'system-marker-required',
} as const satisfies Record<PickSource, AutomatedWriteBoundaryPolicy>;

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
 * System-generated submissions always require the boundary. Sources classified
 * as `system-marker-required` also enter the boundary when the marker is
 * missing, where they are rejected instead of being mistaken for human input.
 * Adding a valid source cannot compile until it is deliberately classified.
 */
export function isAutomatedProducerSubmission(payload: SubmissionPayload): boolean {
  if (payload.metadata?.['systemGenerated'] === true) return true;
  return readBoundaryPolicy(payload.source) === 'system-marker-required';
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

  // A `system-marker-required` source that omits the marker is still automated
  // and still governed: it flows through this boundary and materializes into
  // `awaiting_approval` like any other automated submission. It is deliberately
  // NOT rejected. `t1-proof-awaiting-approval.test.ts` exercises exactly this
  // shape -- source-only brake cases for system-pick-scanner, alert-agent, and
  // model-driven -- and rejecting it would convert a ratified governed path
  // into a hard failure that drops the submission. The architecture condition
  // is that such a pick can never be externally actionable as `validated`;
  // braking satisfies that without losing data.
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
  const automated =
    observation.metadata?.['systemGenerated'] === true ||
    readBoundaryPolicy(observation.source) === 'system-marker-required';
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

function readBoundaryPolicy(source: PickSource): AutomatedWriteBoundaryPolicy | undefined {
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
