/**
 * Read the operator-facing message out of a failed API response body.
 *
 * The API answers every error as `{ ok: false, error: { code, message } }`
 * (`apps/api/src/http.ts` `errorResponse`). The message is nested under
 * `error`; a top-level `message` is never set. Reading only the top level
 * turned every refusal — including a settlement conflict the operator must act
 * on — into a bare `API error <status>`.
 */
export function readApiErrorMessage(body: unknown, status: number): string {
  if (body !== null && typeof body === 'object') {
    const nested = (body as { error?: unknown }).error;
    if (nested !== null && typeof nested === 'object') {
      const message = (nested as { message?: unknown }).message;
      if (typeof message === 'string' && message.length > 0) return message;
    }
    const topLevel = (body as { message?: unknown }).message;
    if (typeof topLevel === 'string' && topLevel.length > 0) return topLevel;
  }
  return `API error ${status}`;
}
