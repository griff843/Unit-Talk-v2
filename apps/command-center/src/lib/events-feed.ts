export interface EventStreamRecord {
  id: string;
  timestamp: string;
  type: string;
  source: string;
  summary: string;
  payload: Record<string, unknown> | null;
  submissionId: string | null;
}

export interface EventFilterState {
  selectedTypes: ReadonlySet<string>;
  query: string;
}

export interface VirtualWindow {
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
}

export function normalizePayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function summarizePayload(payload: Record<string, unknown> | null, maxLength = 132): string {
  if (!payload) {
    return 'No payload attached.';
  }

  const pairs = Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${stringifyValue(value)}`);

  if (pairs.length === 0) {
    return 'Payload captured with no printable fields.';
  }

  const summary = pairs.join(' · ');
  if (summary.length <= maxLength) {
    return summary;
  }

  return `${summary.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function filterEvents(
  events: readonly EventStreamRecord[],
  filters: EventFilterState,
): EventStreamRecord[] {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return events.filter((event) => {
    if (filters.selectedTypes.size > 0 && !filters.selectedTypes.has(event.type)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const payloadText = event.payload ? JSON.stringify(event.payload).toLowerCase() : '';
    return (
      event.type.toLowerCase().includes(normalizedQuery) ||
      event.source.toLowerCase().includes(normalizedQuery) ||
      event.summary.toLowerCase().includes(normalizedQuery) ||
      payloadText.includes(normalizedQuery)
    );
  });
}

export function mergeEventStreams(
  existing: readonly EventStreamRecord[],
  incoming: readonly EventStreamRecord[],
): EventStreamRecord[] {
  const seen = new Set(existing.map((event) => event.id));
  const merged = [...incoming.filter((event) => !seen.has(event.id)), ...existing];
  merged.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  return merged;
}

export function buildVirtualWindow(params: {
  totalCount: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan?: number;
}): VirtualWindow {
  const { totalCount, scrollTop, viewportHeight, rowHeight } = params;
  const overscan = params.overscan ?? 4;

  if (totalCount <= 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  }

  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const unclampedStart = Math.floor(scrollTop / rowHeight) - overscan;
  const startIndex = Math.max(0, unclampedStart);
  const endIndex = Math.min(totalCount, startIndex + visibleCount + overscan * 2);

  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowHeight,
    paddingBottom: Math.max(0, (totalCount - endIndex) * rowHeight),
  };
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 3).map((entry) => stringifyValue(entry)).join(', ');
  }
  if (value && typeof value === 'object') {
    return '{…}';
  }
  return 'unknown';
}
