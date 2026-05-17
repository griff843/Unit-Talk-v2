export type ClvPayloadPath =
  | 'payload.clvRaw'
  | 'payload.clvPercent'
  | 'payload.beatsClosingLine'
  | 'payload.clv.clvRaw'
  | 'payload.clv.clvPercent'
  | 'payload.clv.beatsClosingLine';

export interface SettlementPayloadLike {
  payload?: unknown;
}

export interface ClvCoverageSummary {
  totalRecords: number;
  withClv: number;
  coveragePct: number;
  pathCounts: Record<ClvPayloadPath, number>;
}

const CLV_PAYLOAD_PATHS: ClvPayloadPath[] = [
  'payload.clvRaw',
  'payload.clvPercent',
  'payload.beatsClosingLine',
  'payload.clv.clvRaw',
  'payload.clv.clvPercent',
  'payload.clv.beatsClosingLine',
];

export function getActiveClvPayloadPaths(settlement: SettlementPayloadLike): ClvPayloadPath[] {
  const payload = asRecord(settlement.payload);
  if (!payload) {
    return [];
  }

  const paths: ClvPayloadPath[] = [];
  if (isFiniteNumber(payload['clvRaw'])) {
    paths.push('payload.clvRaw');
  }
  if (isFiniteNumber(payload['clvPercent'])) {
    paths.push('payload.clvPercent');
  }
  if (typeof payload['beatsClosingLine'] === 'boolean') {
    paths.push('payload.beatsClosingLine');
  }

  const nestedClv = asRecord(payload['clv']);
  if (nestedClv) {
    if (isFiniteNumber(nestedClv['clvRaw'])) {
      paths.push('payload.clv.clvRaw');
    }
    if (isFiniteNumber(nestedClv['clvPercent'])) {
      paths.push('payload.clv.clvPercent');
    }
    if (typeof nestedClv['beatsClosingLine'] === 'boolean') {
      paths.push('payload.clv.beatsClosingLine');
    }
  }

  return paths;
}

export function hasClvCoveragePayload(settlement: SettlementPayloadLike): boolean {
  return getActiveClvPayloadPaths(settlement).length > 0;
}

export function summarizeClvCoverage(
  settlements: SettlementPayloadLike[],
): ClvCoverageSummary {
  const pathCounts = Object.fromEntries(
    CLV_PAYLOAD_PATHS.map((path) => [path, 0]),
  ) as Record<ClvPayloadPath, number>;

  let withClv = 0;
  for (const settlement of settlements) {
    const paths = getActiveClvPayloadPaths(settlement);
    if (paths.length > 0) {
      withClv += 1;
    }
    for (const path of paths) {
      pathCounts[path] += 1;
    }
  }

  return {
    totalRecords: settlements.length,
    withClv,
    coveragePct: settlements.length > 0 ? Math.round((withClv / settlements.length) * 100) : 0,
    pathCounts,
  };
}

export function formatClvPayloadPathCounts(pathCounts: Record<ClvPayloadPath, number>): string {
  return CLV_PAYLOAD_PATHS
    .map((path) => `${path}=${pathCounts[path]}`)
    .join(', ');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}
