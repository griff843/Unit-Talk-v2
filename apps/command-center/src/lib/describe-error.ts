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

/**
 * Compact, bounded error text for operator UI. Detailed transport errors stay
 * in server logs; rendered surfaces show the source failure without leaking a
 * stack trace or allowing an error payload to dominate the workflow.
 */
export function describeOperatorFailure(error: unknown, fallback = 'Data source unavailable'): string {
  let description: string;
  if (error !== null && typeof error === 'object' && !(error instanceof Error)) {
    const record = error as Record<string, unknown>;
    const message = typeof record['message'] === 'string' ? record['message'] : null;
    const code = typeof record['code'] === 'string' && record['code'].trim().length > 0 ? record['code'] : null;
    description = message ? `${message}${code ? ` (${code})` : ''}` : describeThrown(error);
  } else {
    description = describeThrown(error);
  }

  const compact = description.replace(/\s+/g, ' ').trim();
  if (!compact) return fallback;
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}
