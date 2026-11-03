/**
 * UTV2-1522 — Readable serialization for thrown values.
 *
 * `String(err)` on a PostgREST/fetch error object prints "[object Object]".
 * This helper extracts the human-relevant keys (message/code/status/hint/
 * details) or falls back to compact JSON — never the default Object
 * toString. Use it everywhere a caught error is rendered.
 */
export function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error !== null && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    const parts = ['message', 'code', 'status', 'hint', 'details']
      .filter((k) => typeof o[k] === 'string' || typeof o[k] === 'number')
      .map((k) => `${k}=${String(o[k])}`);
    if (parts.length > 0) return parts.join(' · ');
    try {
      const json = JSON.stringify(error);
      if (json && json !== '{}') return json.slice(0, 200);
    } catch {
      /* fall through */
    }
    return 'unserializable error object';
  }
  return String(error);
}

/** Operator-facing failure text. Raw diagnostics remain available through describeThrown. */
export function describeOperatorFailure(error: unknown, fallback = 'Data source unavailable'): string {
  const record = error !== null && typeof error === 'object'
    ? error as Record<string, unknown>
    : null;
  const code = typeof record?.['code'] === 'string' ? record['code'] : '';
  const status = record?.['status'];
  const diagnostic = describeThrown(error).toLowerCase();
  if (code === '42501' || status === 403) {
    return 'Access to this data was refused. Ask an administrator to check your access.';
  }
  if (status === 401 || code === 'PGRST301') {
    return 'Your session could not be verified. Sign in again, then retry.';
  }
  if (code === '57014' || /timeout|timed out|statement timeout/.test(diagnostic)) {
    return 'This data took too long to load. Retry; if it continues, contact support.';
  }
  if (/fetch failed|failed to fetch|network|econnrefused|enotfound/.test(diagnostic)) {
    return 'The data service could not be reached. Retry; if it continues, contact support.';
  }
  return `${fallback.replace(/[.!?]+$/, '')}. Retry; if it continues, contact support.`;
}
