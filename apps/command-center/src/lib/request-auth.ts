import { headers } from 'next/headers';
import { authenticateCommandCenterRequest } from './server-api';

export interface ReadonlyHeaderBag {
  get(name: string): string | null | undefined;
}

export type RequestAuthResult =
  | {
      ok: true;
      actor: string;
      role: string;
      method: 'bearer' | 'basic' | 'dev_bypass';
    }
  | { ok: false; status: number; code: string; message: string };

export class PrivilegedAccessDeniedError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(refusal: Extract<RequestAuthResult, { ok: false }>) {
    super(refusal.message);
    this.name = 'PrivilegedAccessDeniedError';
    this.status = refusal.status;
    this.code = refusal.code;
  }
}

/** Authenticate credentials carried by this request, never derived identity headers. */
export function authenticateHeaderBag(headerBag: ReadonlyHeaderBag): RequestAuthResult {
  const result = authenticateCommandCenterRequest({
    headers: { get: (name) => headerBag.get(name) ?? null },
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      code: result.code,
      message: result.message,
    };
  }

  return {
    ok: true,
    actor: result.auth.actor,
    role: result.auth.role,
    method: result.auth.method,
  };
}

/** Authenticate the current Next request and fail closed outside request scope. */
export async function authenticateCurrentRequest(): Promise<RequestAuthResult> {
  try {
    return authenticateHeaderBag(await headers());
  } catch {
    return {
      ok: false,
      status: 401,
      code: 'COMMAND_CENTER_REQUEST_CONTEXT_UNAVAILABLE',
      message: 'Command Center request context is unavailable.',
    };
  }
}

export async function assertPrivilegedRequestAuthenticated(): Promise<
  Extract<RequestAuthResult, { ok: true }>
> {
  const result = await authenticateCurrentRequest();
  if (!result.ok) {
    throw new PrivilegedAccessDeniedError(result);
  }
  return result;
}
