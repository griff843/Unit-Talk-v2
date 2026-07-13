/**
 * Pure model for the operator alert log: rank by severity (critical first),
 * collapse duplicate alerts into one entry with a count. No I/O, no React.
 */

export type AlertLogSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AlertLogInput {
  id: string;
  title: string;
  detail: string;
  severity: AlertLogSeverity;
}

export interface AlertLogEntry {
  /** Stable id — the first contributing alert's id. */
  id: string;
  title: string;
  detail: string;
  severity: AlertLogSeverity;
  /** How many identical alerts were collapsed into this entry. */
  count: number;
  /** All contributing alert ids (for mark-read bookkeeping). */
  memberIds: string[];
}

const SEVERITY_RANK: Record<AlertLogSeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

export function severityRank(severity: AlertLogSeverity): number {
  return SEVERITY_RANK[severity];
}

/**
 * Collapse identical (title + detail + severity) alerts and sort the result
 * critical-first, then by collapsed count (bigger clusters next), then title.
 */
export function buildAlertLog(inputs: AlertLogInput[]): AlertLogEntry[] {
  const groups = new Map<string, AlertLogEntry>();
  for (const input of inputs) {
    const key = `${input.severity}::${input.title}::${input.detail}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.memberIds.push(input.id);
    } else {
      groups.set(key, {
        id: input.id,
        title: input.title,
        detail: input.detail,
        severity: input.severity,
        count: 1,
        memberIds: [input.id],
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.count - a.count ||
      a.title.localeCompare(b.title),
  );
}
