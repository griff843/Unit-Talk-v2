import { createHmac } from 'node:crypto';

function base64UrlEncode(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function createCapperSessionToken(
  claims: { sub: string; capperId: string; displayName?: string; email?: string },
  secret: string,
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    ...claims,
    role: 'capper',
    iat: Math.floor(Date.now() / 1000),
  }));
  const body = `${header}.${payload}`;
  const signature = createHmac('sha256', secret)
    .update(body)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${body}.${signature}`;
}
