export function resolveApiBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const configured =
    env['API_BASE_URL']?.trim() ||
    env['UNIT_TALK_API_URL']?.trim();

  if (configured) {
    return configured;
  }

  return 'http://localhost:4000';
}

export function resolveCommandCenterApiHeaders(env: NodeJS.ProcessEnv = process.env) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const apiKey = env['UNIT_TALK_CC_API_KEY']?.trim();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

export function resolveOperatorIdentity(env: NodeJS.ProcessEnv = process.env) {
  return env['OPERATOR_IDENTITY']?.trim() || 'command-center';
}
