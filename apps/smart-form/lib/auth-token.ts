/**
 * Capper token storage and decode utilities (UTV2-658).
 *
 * Tokens are HS256 JWTs issued by the API. The smart-form decodes the payload
 * client-side for display purposes only — cryptographic verification happens
 * on the server for every submission.
 */

export const CAPPER_TOKEN_KEY = 'ut_capper_token';

export interface CapperTokenClaims {
  sub: string;
  capperId: string;
  displayName: string;
  email?: string;
  iat?: number;
  exp?: number;
}

/**
 * Decode a JWT payload without verifying the signature.
 * Used only for display (showing displayName in the form header).
 * The server verifies the signature on every submission.
 */
export function decodeCapperToken(token: string): CapperTokenClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1];
    if (!payloadB64) return null;
    // Base64url → base64 → JSON
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    const claims = JSON.parse(json) as Record<string, unknown>;
    if (typeof claims['capperId'] !== 'string' || !claims['capperId']) return null;
    if (claims['role'] !== 'capper') return null;
    return {
      sub: typeof claims['sub'] === 'string' ? claims['sub'] : (claims['capperId'] as string),
      capperId: claims['capperId'] as string,
      displayName: typeof claims['displayName'] === 'string' && claims['displayName']
        ? (claims['displayName'] as string)
        : (claims['capperId'] as string),
      email: typeof claims['email'] === 'string' ? claims['email'] : undefined,
      iat: typeof claims['iat'] === 'number' ? claims['iat'] : undefined,
      exp: typeof claims['exp'] === 'number' ? claims['exp'] : undefined,
    };
  } catch {
    return null;
  }
}

/** True if the token is structurally a JWT with a capper role claim (no sig verification). */
export function isCapperToken(token: string): boolean {
  return decodeCapperToken(token) !== null;
}

/** True if the token has an exp claim that is in the past. */
export function isTokenExpired(claims: CapperTokenClaims): boolean {
  if (!claims.exp) return false;
  return Date.now() / 1000 > claims.exp;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(CAPPER_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(CAPPER_TOKEN_KEY, token);
  } catch {
    // Ignore storage errors
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(CAPPER_TOKEN_KEY);
  } catch {
    // Ignore storage errors
  }
}

/** Get the stored token and decode its claims, or return null. */
export function getStoredCapperClaims(): CapperTokenClaims | null {
  const token = getStoredToken();
  if (!token) return null;
  const claims = decodeCapperToken(token);
  if (!claims) return null;
  if (isTokenExpired(claims)) {
    clearStoredToken();
    return null;
  }
  return claims;
}
