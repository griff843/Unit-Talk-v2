type QueryResultLike = {
  error?: unknown;
  count?: number | null;
};

function describeQueryError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (error !== null && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record['message'] === 'string' && record['message'].trim().length > 0) return record['message'];
    if (typeof record['code'] === 'string' && record['code'].trim().length > 0) return `database error ${record['code']}`;
  }
  return 'unknown database error';
}

export function assertQuerySucceeded(result: QueryResultLike, label: string): void {
  if (result.error) {
    throw new Error(`${label}: ${describeQueryError(result.error)}`);
  }
}

export function readAuthoritativeCount(result: QueryResultLike, label: string): number {
  assertQuerySucceeded(result, label);
  if (typeof result.count !== 'number' || !Number.isFinite(result.count)) {
    throw new Error(`${label}: authoritative count unavailable`);
  }
  return result.count;
}
