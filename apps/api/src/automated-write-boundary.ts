import type { PickLifecycleState, PickSource, SubmissionPayload, WriterRole } from '@unit-talk/contracts';
import { evaluateEdgePriceFreshness } from '@unit-talk/domain';

const AUTOMATED_PRODUCER_SOURCES: ReadonlySet<PickSource> = new Set<PickSource>([
  'board-construction',
  'system-pick-scanner',
]);

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
  source: 'board-construction' | 'system-pick-scanner';
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
  source: 'board-construction' | 'system-pick-scanner';
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
 * A source name alone is not enough to classify a submission as automated.
 * `board-construction` can also be used by an authenticated operator surface,
 * while the board writer and candidate scanner both stamp `systemGenerated`.
 */
export function isAutomatedProducerSubmission(payload: SubmissionPayload): boolean {
  return (
    AUTOMATED_PRODUCER_SOURCES.has(payload.source) &&
    payload.metadata?.['systemGenerated'] === true
  );
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

  const source = payload.source as 'board-construction' | 'system-pick-scanner';
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
    AUTOMATED_PRODUCER_SOURCES.has(observation.source) &&
    observation.metadata?.['systemGenerated'] === true;
  if (!automated || observation.status !== 'validated') {
    return null;
  }

  return {
    code: 'AUTOMATED_DIRECT_TO_VALIDATED',
    source: observation.source as 'board-construction' | 'system-pick-scanner',
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

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
