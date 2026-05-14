import type { RuntimeTruthReport } from '@unit-talk/observability';

type EnvReader = Record<string, string | undefined>;

export type CommandCenterAuthRole = 'operator';
export type CommandCenterAuthMethod = 'basic' | 'bearer' | 'dev_bypass';

export interface CommandCenterAccessConfig {
  required: boolean;
  enabled: boolean;
  token?: string | undefined;
  basicUsername?: string | undefined;
  basicPassword?: string | undefined;
  operatorIdentity: string;
}

export interface CommandCenterAuthContext {
  role: CommandCenterAuthRole;
  actor: string;
  method: CommandCenterAuthMethod;
}

export type CommandCenterAuthResult =
  | { ok: true; auth: CommandCenterAuthContext }
  | {
      ok: false;
      status: 401 | 503;
      code: string;
      message: string;
      challenge?: string | undefined;
    };

type HeaderReader =
  | Headers
  | {
      get(name: string): string | null;
    }
  | Record<string, string | string[] | undefined>;

const COMMAND_CENTER_AUTH_REALM = 'Unit Talk Command Center';

export function resolveApiBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const configured =
    env['API_BASE_URL']?.trim() || env['UNIT_TALK_API_URL']?.trim();

  if (configured) {
    return configured;
  }

  return 'http://localhost:4000';
}

export function resolveCommandCenterApiHeaders(
  env: NodeJS.ProcessEnv = process.env,
) {
  assertCommandCenterApiKeyConfig(env);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Operator-Identity': resolveOperatorIdentity(env),
  };

  const apiKey = env['UNIT_TALK_CC_API_KEY']?.trim();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

export function resolveOperatorIdentity(env: NodeJS.ProcessEnv = process.env) {
  return (
    env['COMMAND_CENTER_OPERATOR_IDENTITY']?.trim() ||
    env['OPERATOR_IDENTITY']?.trim() ||
    'command-center'
  );
}

export async function fetchRuntimeTruth(input: {
  env?: NodeJS.ProcessEnv | undefined;
  fetchImpl?: typeof fetch | undefined;
} = {}): Promise<RuntimeTruthReport> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${resolveApiBaseUrl(env)}/api/runtime/truth`, {
    method: 'GET',
    headers: resolveCommandCenterApiHeaders(env),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Runtime truth request failed: ${response.status}`);
  }

  return (await response.json()) as RuntimeTruthReport;
}

export function resolveCommandCenterAccessConfig(
  env: EnvReader = process.env,
): CommandCenterAccessConfig {
  const token =
    readEnv(env, 'UNIT_TALK_COMMAND_CENTER_AUTH_TOKEN') ||
    readEnv(env, 'COMMAND_CENTER_AUTH_TOKEN');
  const basicUsername =
    readEnv(env, 'UNIT_TALK_COMMAND_CENTER_AUTH_USERNAME') ||
    readEnv(env, 'COMMAND_CENTER_AUTH_USERNAME');
  const basicPassword =
    readEnv(env, 'UNIT_TALK_COMMAND_CENTER_AUTH_PASSWORD') ||
    readEnv(env, 'COMMAND_CENTER_AUTH_PASSWORD');
  const required = isCommandCenterAuthRequired(env);

  return {
    required,
    enabled: Boolean(token || (basicUsername && basicPassword)),
    ...(token ? { token } : {}),
    ...(basicUsername ? { basicUsername } : {}),
    ...(basicPassword ? { basicPassword } : {}),
    operatorIdentity: resolveOperatorIdentity(env as NodeJS.ProcessEnv),
  };
}

export function assertCommandCenterAuthConfig(
  env: EnvReader = process.env,
): CommandCenterAccessConfig {
  const config = resolveCommandCenterAccessConfig(env);
  const hasPartialBasic =
    Boolean(config.basicUsername) !== Boolean(config.basicPassword);

  if (hasPartialBasic) {
    throw new Error(
      'Command Center basic auth requires both COMMAND_CENTER_AUTH_USERNAME and COMMAND_CENTER_AUTH_PASSWORD.',
    );
  }

  if (config.required && !config.enabled) {
    throw new Error(
      'Command Center auth is required in production. Configure COMMAND_CENTER_AUTH_TOKEN or COMMAND_CENTER_AUTH_USERNAME/PASSWORD.',
    );
  }

  return config;
}

export function assertCommandCenterApiKeyConfig(
  env: EnvReader = process.env,
): void {
  if (!isCommandCenterAuthRequired(env)) {
    return;
  }

  if (!readEnv(env, 'UNIT_TALK_CC_API_KEY')) {
    throw new Error(
      'UNIT_TALK_CC_API_KEY is required for Command Center privileged API actions in production.',
    );
  }
}

export function authenticateCommandCenterRequest(input: {
  headers: HeaderReader;
  env?: EnvReader | undefined;
}): CommandCenterAuthResult {
  let config: CommandCenterAccessConfig;
  try {
    config = assertCommandCenterAuthConfig(input.env ?? process.env);
  } catch (error) {
    return {
      ok: false,
      status: 503,
      code: 'COMMAND_CENTER_AUTH_MISCONFIGURED',
      message:
        error instanceof Error
          ? error.message
          : 'Command Center auth is misconfigured.',
    };
  }

  if (!config.enabled) {
    return {
      ok: true,
      auth: {
        role: 'operator',
        actor: 'command-center:dev-bypass',
        method: 'dev_bypass',
      },
    };
  }

  const authorization = readHeader(input.headers, 'authorization');
  if (!authorization) {
    return denied(
      'COMMAND_CENTER_AUTH_REQUIRED',
      'Command Center authentication is required.',
    );
  }

  const bearer = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  if (bearer && config.token && constantTimeEqual(bearer, config.token)) {
    return {
      ok: true,
      auth: {
        role: 'operator',
        actor: config.operatorIdentity,
        method: 'bearer',
      },
    };
  }

  const basic = readBasicCredentials(authorization);
  if (
    basic &&
    config.basicUsername &&
    config.basicPassword &&
    constantTimeEqual(basic.username, config.basicUsername) &&
    constantTimeEqual(basic.password, config.basicPassword)
  ) {
    return {
      ok: true,
      auth: {
        role: 'operator',
        actor: config.operatorIdentity,
        method: 'basic',
      },
    };
  }

  return denied(
    'COMMAND_CENTER_AUTH_INVALID',
    'Command Center credentials are invalid.',
  );
}

export function createCommandCenterAuthChallenge(): string {
  return `Basic realm="${COMMAND_CENTER_AUTH_REALM}", charset="UTF-8"`;
}

export function logCommandCenterAuthFailure(input: {
  code: string;
  route: string;
  method: string;
  requestId?: string | undefined;
}): void {
  console.warn('command_center.auth_failed', {
    code: input.code,
    route: input.route,
    method: input.method,
    requestId: input.requestId ?? null,
  });
}

export function logCommandCenterPrivilegedAction(input: {
  route: string;
  method: string;
  actor: string;
  role: CommandCenterAuthRole;
  requestId?: string | undefined;
}): void {
  console.info('command_center.privileged_action', {
    route: input.route,
    method: input.method,
    actor: input.actor,
    role: input.role,
    requestId: input.requestId ?? null,
  });
}

function isCommandCenterAuthRequired(env: EnvReader): boolean {
  const explicitMode = (
    readEnv(env, 'UNIT_TALK_COMMAND_CENTER_AUTH_MODE') ||
    readEnv(env, 'COMMAND_CENTER_AUTH_MODE') ||
    readEnv(env, 'UNIT_TALK_OPERATOR_RUNTIME_MODE') ||
    ''
  ).toLowerCase();

  if (explicitMode === 'fail_open' || explicitMode === 'disabled') {
    return false;
  }

  if (explicitMode === 'fail_closed' || explicitMode === 'required') {
    return true;
  }

  const appEnv = readEnv(env, 'UNIT_TALK_APP_ENV')?.toLowerCase();
  const nodeEnv = readEnv(env, 'NODE_ENV')?.toLowerCase();
  return (
    appEnv === 'production' || appEnv === 'staging' || nodeEnv === 'production'
  );
}

function denied(code: string, message: string): CommandCenterAuthResult {
  return {
    ok: false,
    status: 401,
    code,
    message,
    challenge: createCommandCenterAuthChallenge(),
  };
}

function readEnv(env: EnvReader, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function readHeader(headers: HeaderReader, name: string): string | null {
  if ('get' in headers && typeof headers.get === 'function') {
    return headers.get(name);
  }

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) {
      continue;
    }

    if (Array.isArray(value)) {
      return value[0] ?? null;
    }

    return value ?? null;
  }

  return null;
}

function readBasicCredentials(
  authorization: string,
): { username: string; password: string } | null {
  const encoded = /^Basic\s+(\S+)$/i.exec(authorization)?.[1];
  if (!encoded) {
    return null;
  }

  try {
    const decoded = globalThis.atob(encoded);
    const separator = decoded.indexOf(':');
    if (separator === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const maxLength = Math.max(a.length, b.length);

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }

  return diff === 0;
}
