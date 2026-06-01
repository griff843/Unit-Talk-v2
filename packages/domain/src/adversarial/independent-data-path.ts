export type {
  RawProviderSnapshot,
  IndependentAdversarialRecordInput,
  IndependentAdversarialRecord,
  ReplayableAdversarialFindingInput,
  ReplayableAdversarialFinding,
  ReplayedAdversarialFinding,
  AdversarialReplayResult,
} from './independent-data-path.types.js';

import type {
  IndependentAdversarialRecord,
  IndependentAdversarialRecordInput,
  RawProviderSnapshot,
  ReplayableAdversarialFinding,
  ReplayableAdversarialFindingInput,
} from './independent-data-path.types.js';

export const INDEPENDENT_ADVERSARIAL_PATH_ID = 'independent-adversarial' as const;

export class IndependentDataPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndependentDataPathError';
  }
}

export function createIndependentAdversarialRecord(
  input: IndependentAdversarialRecordInput,
): IndependentAdversarialRecord {
  const capturedAt = input.capturedAt ?? input.rawSnapshot.capturedAt;
  assertNonEmpty(input.rawSnapshot.source, 'rawSnapshot.source');
  assertIsoTimestamp(input.rawSnapshot.capturedAt, 'rawSnapshot.capturedAt');
  assertIsoTimestamp(capturedAt, 'capturedAt');

  const rawSnapshot = freezeRawProviderSnapshot(input.rawSnapshot);
  const payloadHash = stableHash(input.rawSnapshot.payload);
  const replayKey = buildReplayKey(input.rawSnapshot.source, input.rawSnapshot.capturedAt, payloadHash);
  const id = input.id ?? `advrec_${stableHash({ pathId: INDEPENDENT_ADVERSARIAL_PATH_ID, replayKey })}`;
  assertNonEmpty(id, 'id');

  return Object.freeze({
    id,
    rawSnapshot,
    capturedAt,
    pathId: INDEPENDENT_ADVERSARIAL_PATH_ID,
    payloadHash,
    replayKey,
  });
}

export function createReplayableAdversarialFinding(
  input: ReplayableAdversarialFindingInput,
): ReplayableAdversarialFinding {
  assertIsoTimestamp(input.detectedAt, 'detectedAt');
  if (input.record.pathId !== INDEPENDENT_ADVERSARIAL_PATH_ID) {
    throw new IndependentDataPathError('record.pathId must be independent-adversarial');
  }

  const finding = deepFreeze(cloneJsonValue(input.finding));
  const id = input.id ?? `advfind_${stableHash({
    recordId: input.record.id,
    payloadHash: input.record.payloadHash,
    finding,
    detectedAt: input.detectedAt,
  })}`;
  assertNonEmpty(id, 'id');

  return Object.freeze({
    id,
    recordId: input.record.id,
    finding,
    replayableFromPath: INDEPENDENT_ADVERSARIAL_PATH_ID,
    detectedAt: input.detectedAt,
    payloadHash: input.record.payloadHash,
    replayKey: input.record.replayKey,
  });
}

export function verifyFindingAgainstRecord(
  finding: ReplayableAdversarialFinding,
  record: IndependentAdversarialRecord,
): boolean {
  return finding.replayableFromPath === INDEPENDENT_ADVERSARIAL_PATH_ID
    && record.pathId === INDEPENDENT_ADVERSARIAL_PATH_ID
    && finding.recordId === record.id
    && finding.payloadHash === record.payloadHash
    && finding.replayKey === record.replayKey;
}

export function stableHash(value: unknown): string {
  const serialized = stableSerialize(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, '0');
}

export function stableSerialize(value: unknown): string {
  return serializeJsonValue(value, new WeakSet<object>());
}

function freezeRawProviderSnapshot(snapshot: RawProviderSnapshot): RawProviderSnapshot {
  return Object.freeze({
    source: snapshot.source,
    capturedAt: snapshot.capturedAt,
    payload: deepFreeze(cloneJsonValue(snapshot.payload)),
  });
}

function buildReplayKey(source: string, capturedAt: string, payloadHash: string): string {
  return stableHash({ capturedAt, payloadHash, source });
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new IndependentDataPathError(`${field} is required`);
  }
}

function assertIsoTimestamp(value: string, field: string): void {
  assertNonEmpty(value, field);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new IndependentDataPathError(`${field} must be an ISO-8601 UTC timestamp`);
  }
}

function cloneJsonValue(value: unknown): unknown {
  return JSON.parse(stableSerialize(value));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  for (const key of Object.keys(value)) {
    const child = (value as Record<string, unknown>)[key];
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function serializeJsonValue(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null';

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new IndependentDataPathError('payload must not contain non-finite numbers');
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new IndependentDataPathError('payload must not contain circular references');
    }
    seen.add(value);
    const serialized = `[${value.map((entry) => serializeJsonValue(entry, seen)).join(',')}]`;
    seen.delete(value);
    return serialized;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      throw new IndependentDataPathError('payload must not contain circular references');
    }
    seen.add(value);
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${serializeJsonValue(entry, seen)}`);
    seen.delete(value);
    return `{${entries.join(',')}}`;
  }

  throw new IndependentDataPathError('payload must be JSON-serializable');
}
