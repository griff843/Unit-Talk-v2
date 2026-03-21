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
): ApiErrorResponse {
  return {
    status,
    body: {
      ok: false,
      error: {
        code,
        message,
      },
    },
  };
}

