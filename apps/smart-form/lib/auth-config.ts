const LOCAL_AUTH_SECRET = 'unit-talk-smart-form-local-auth-secret';

function readTrimmed(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env) {
  const configured = readTrimmed(env, 'AUTH_SECRET') ?? readTrimmed(env, 'NEXTAUTH_SECRET');
  if (configured) {
    return configured;
  }

  if (env['NODE_ENV'] !== 'production') {
    return LOCAL_AUTH_SECRET;
  }

  throw new Error('AUTH_SECRET or NEXTAUTH_SECRET is required in production.');
}

export function isLocalAuthFallbackActive(env: NodeJS.ProcessEnv = process.env) {
  return (
    env['NODE_ENV'] !== 'production' &&
    readTrimmed(env, 'AUTH_SECRET') === null &&
    readTrimmed(env, 'NEXTAUTH_SECRET') === null
  );
}

export function isQaAuthBypassEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env['NODE_ENV'] === 'production') {
    return false;
  }

  const configured =
    env['NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS'] ??
    env['SMART_FORM_QA_AUTH_BYPASS'];

  if (configured === undefined) {
    return true;
  }

  return !['0', 'false', 'off', 'no'].includes(configured.trim().toLowerCase());
}
