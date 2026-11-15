export interface ApiSuccessResponse<TBody> {
  status: number;
  body: {
    ok: true;
    data: TBody;
  };
}

export interface ApiErrorResponse {
  status: number;
  body: {
    ok: false;
    error: {
      code: string;
      message: string;
      details?: Readonly<Record<string, unknown>>;
    };
  };
}

export type ApiResponse<TBody> = ApiSuccessResponse<TBody> | ApiErrorResponse;

export function successResponse<TBody>(
  status: number,
  data: TBody,
): ApiSuccessResponse<TBody> {
  return {
    status,
    body: {
      ok: true,
      data,
    },
  };
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): ApiErrorResponse {
  // Without details the body is exactly `{ ok, error: { code, message } }`, as before: the key
  // is added only when there is something to carry.
  return {
    status,
    body: {
      ok: false,
      error: details === undefined ? { code, message } : { code, message, details },
    },
  };
}

