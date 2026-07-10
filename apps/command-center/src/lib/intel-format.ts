/** Display formatters shared by /intel/* pages. Pure — no I/O. */

export function formatAmerican(odds: number | null | undefined): string {
  if (odds === null || odds === undefined) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatProb(prob: number | null | undefined): string {
  if (prob === null || prob === undefined || !Number.isFinite(prob)) return '—';
  return `${(prob * 100).toFixed(1)}%`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatUnits(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}
