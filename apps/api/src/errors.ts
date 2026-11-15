export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Optional structured data for the client; omitted from the response when undefined. */
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error) {
    return new ApiError(400, 'BAD_REQUEST', error.message);
  }

  return new ApiError(500, 'UNKNOWN_ERROR', 'Unknown API error');
}

