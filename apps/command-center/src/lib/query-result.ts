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

/** Never mistake PostgREST's response cap for the end of an aggregate. */
export async function readAllQueryPages<T>(
  label: string,
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  do {
    const result = await query(rows.length, rows.length + 499);
    assertQuerySucceeded(result, label);
    const count = readAuthoritativeCount(result, label);
    if (expected !== null && count !== expected) throw new Error(`${label}: population changed during the read; retry`);
    expected = count;
    const page = result.data ?? [];
    rows.push(...page);
    if (rows.length > count || (page.length === 0 && rows.length < count)) {
      throw new Error(`${label}: incomplete aggregate; retry`);
    }
  } while (rows.length < expected!);
  return rows;
}
