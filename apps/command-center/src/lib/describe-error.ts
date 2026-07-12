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
