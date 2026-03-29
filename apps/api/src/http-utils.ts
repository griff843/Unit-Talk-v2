import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

export function setCorsHeaders(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Correlation-Id, X-Request-Id');
}

export function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  setCorsHeaders(response);
  response.end(JSON.stringify(body));
}

export async function readJsonBody(
  request: IncomingMessage,
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
) {
  const declaredContentLength = Number.parseInt(request.headers['content-length'] ?? '', 10);
  if (Number.isFinite(declaredContentLength) && declaredContentLength > bodyLimitBytes) {
    throw new ApiRequestError(
      413,
      'REQUEST_BODY_TOO_LARGE',
      `Request body exceeds ${bodyLimitBytes} bytes.`,
    );
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.byteLength;

    if (size > bodyLimitBytes) {
      throw new ApiRequestError(
        413,
        'REQUEST_BODY_TOO_LARGE',
        `Request body exceeds ${bodyLimitBytes} bytes.`,
      );
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new ApiRequestError(400, 'INVALID_JSON_BODY', 'Request body must be valid JSON.');
  }
}

export function readOptionalInteger(rawValue: string | null) {
  if (!rawValue) {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function toApiFailure(error: unknown) {
  if (error instanceof ApiRequestError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
      },
    },
  };
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}
