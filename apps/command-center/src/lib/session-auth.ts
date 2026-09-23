import {
  assertCommandCenterAuthConfig,
  authenticateCommandCenterRequest,
  type CommandCenterAuthResult,
} from './server-api';

export const SESSION_COOKIE = 'cc_operator_session';
export const SESSION_SECONDS = 8 * 60 * 60;
type Env = Record<string, string | undefined>;
type HeaderBag = { get(name: string): string | null | undefined };
const encoder = new TextEncoder();

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid session encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
}

async function signingKey(env: Env) {
  const config = assertCommandCenterAuthConfig(env);
  if (!config.enabled) throw new Error('Sessions require configured credentials');
  // Domain-separated key material. Rotating credentials or changing the mapped
  // operator identity invalidates every existing session. No new secret store.
  const material = JSON.stringify([
    'command-center/browser-session/v1', config.token ?? '',
    config.basicUsername ?? '', config.basicPassword ?? '', config.operatorIdentity,
  ]);
  return crypto.subtle.importKey('raw', encoder.encode(material), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Mint only after validating request credentials; never from an actor header. */
export async function issueOperatorSession(headers: HeaderBag, env: Env = process.env, now = Date.now()): Promise<string> {
  const auth = authenticateCommandCenterRequest({ headers: { get: (name) => headers.get(name) ?? null }, env });
  if (!auth.ok || auth.auth.method === 'dev_bypass') throw new Error('Valid operator credentials required');
  const issued = Math.floor(now / 1000);
  const payload = encode(encoder.encode(JSON.stringify({
    version: 1, actor: auth.auth.actor, issued, expires: issued + SESSION_SECONDS,
    nonce: crypto.randomUUID(),
  })));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}

/** Independently verify the server-issued credential at every privileged boundary. */
export async function authenticateSessionOrHeader(
  headers: HeaderBag, env: Env = process.env, now = Date.now(),
): Promise<CommandCenterAuthResult> {
  const direct = authenticateCommandCenterRequest({ headers: { get: (name) => headers.get(name) ?? null }, env });
  // An explicit invalid Authorization header cannot fall back to a session.
  if (direct.ok || headers.get('authorization') || direct.status === 503) return direct;
  const cookies = (headers.get('cookie') ?? '').split(';').map((part) => part.trim());
  const matches = cookies.filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) return direct;
  const credential = matches[0]!.slice(SESSION_COOKIE.length + 1);
  if (credential.length > 2048) return direct;
  try {
    const parts = credential.split('.');
    if (parts.length !== 2) return direct;
    const [payload, signature] = parts as [string, string];
    if (!await crypto.subtle.verify('HMAC', await signingKey(env), decode(signature), encoder.encode(payload))) return direct;
    const data: unknown = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (!data || typeof data !== 'object') return direct;
    const value = data as Record<string, unknown>;
    const current = Math.floor(now / 1000);
    const config = assertCommandCenterAuthConfig(env);
    if (value.version !== 1 || value.actor !== config.operatorIdentity ||
      typeof value.issued !== 'number' || !Number.isInteger(value.issued) ||
      typeof value.expires !== 'number' || !Number.isInteger(value.expires) ||
      value.issued > current || value.expires <= current ||
      value.expires - value.issued !== SESSION_SECONDS || typeof value.nonce !== 'string') return direct;
    return { ok: true, auth: { actor: config.operatorIdentity, role: 'operator', method: 'session' } };
  } catch {
    return direct;
  }
}

/** Session creation/destruction is browser-only and refuses cross-origin requests. */
export function isSameOriginSessionRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const target = new URL(request.url);
    const source = new URL(origin);
    // Next may normalize request.url to the server's bind address. The Host
    // header remains the browser's destination (and cannot be set by browser JS).
    const protocol = request.headers.get('x-forwarded-proto') === 'https' ? 'https:' : target.protocol;
    const destination = new URL(`${protocol}//${request.headers.get('host') ?? target.host}`);
    return source.origin === destination.origin &&
      (!request.headers.get('sec-fetch-site') || request.headers.get('sec-fetch-site') === 'same-origin');
  } catch {
    return false;
  }
}

export function sessionCookieOptions(url: string, headers?: HeaderBag) {
  const target = new URL(url);
  if (headers?.get('host')) target.host = headers.get('host')!;
  if (headers?.get('x-forwarded-proto') === 'https') target.protocol = 'https:';
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  return { httpOnly: true, secure: target.protocol === 'https:' || !loopback, sameSite: 'strict' as const, path: '/', maxAge: SESSION_SECONDS };
}
