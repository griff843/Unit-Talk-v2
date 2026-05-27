// Detect future data leakage: fields whose evidence timestamps post-date the
// decision cutoff. Fail-open — if input cannot be parsed, returns indeterminate
// rather than blocking.

export interface FieldEvidence {
  readonly field: string;
  readonly evidence_at: string; // ISO-8601: when this feature value was computed/observed
}

export interface FutureLeakageInput {
  readonly cutoff: string; // ISO-8601: decision time (pick submission, event start, etc.)
  readonly field_evidence: readonly FieldEvidence[];
}

export type FutureLeakageResult =
  | { status: 'clean'; leaked_fields: readonly string[] }
  | { status: 'leaked'; leaked_fields: readonly string[] }
  | { status: 'indeterminate'; reason: string }; // fail-open: analysis could not complete

export function detectFutureLeakage(input: FutureLeakageInput): FutureLeakageResult {
  const cutoffMs = parseIso(input.cutoff);
  if (cutoffMs === null) {
    return { status: 'indeterminate', reason: `unparseable cutoff: ${input.cutoff}` };
  }

  if (input.field_evidence.length === 0) {
    return { status: 'clean', leaked_fields: [] };
  }

  const leaked: string[] = [];

  for (const fe of input.field_evidence) {
    const evidenceMs = parseIso(fe.evidence_at);
    if (evidenceMs === null) {
      return {
        status: 'indeterminate',
        reason: `unparseable evidence_at for field "${fe.field}": ${fe.evidence_at}`,
      };
    }
    if (evidenceMs > cutoffMs) {
      leaked.push(fe.field);
    }
  }

  if (leaked.length > 0) {
    return { status: 'leaked', leaked_fields: leaked };
  }
  return { status: 'clean', leaked_fields: [] };
}

function parseIso(ts: string): number | null {
  if (typeof ts !== 'string' || ts.trim() === '') return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}
