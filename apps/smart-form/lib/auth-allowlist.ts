export interface AllowedCapper {
  email: string;
  capperId: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Canonical capper IDs are matched, never repaired.
 *
 * UTV2-1824: the previous implementation derived the ID from the email
 * local-part and sanitised whatever it got by replacing every disallowed
 * character. That is why `griffadavi@gmail.com` silently resolved to
 * `griffadavi` instead of canonical `griff843` — and the value is not
 * cosmetic, because `apps/smart-form/auth.ts` puts it in the session JWT as
 * `capperId` and `apps/api/src/handlers/submit-pick.ts` prefers that claim
 * over whatever `submittedBy` the form sent. A derived ID therefore becomes
 * the persisted identity of a real pick.
 *
 * So this validates and refuses rather than rewrites: an ID that is not
 * already canonical is rejected outright, because silently repairing one is
 * exactly how a wrong identity reached the database in the first place.
 */
const CANONICAL_CAPPER_ID = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Parses `ALLOWED_CAPPER_EMAILS` into an allowlist.
 *
 * Each entry MUST carry its canonical capper ID explicitly:
 *
 *     ALLOWED_CAPPER_EMAILS="someone@example.com=griff843, other@example.com=other-capper"
 *
 * Fail closed at every step. An entry with no `=`, an empty email, an empty
 * ID, or an ID that is not already canonical is dropped — it does NOT fall
 * back to the email local-part and it does not admit the login. An unset,
 * empty or whitespace-only value admits nobody (UTV2-1786).
 *
 * The value is read server-side only and is never exposed to the browser
 * bundle; no email address or ID is compiled into this module.
 */
export function parseAllowedCapperEmails(value: string | undefined): AllowedCapper[] {
  if (!value) return [];

  const cappers = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): AllowedCapper | null => {
      // Split on the FIRST '=' only. An email cannot contain '=', but a
      // malformed entry with several must be rejected rather than guessed at,
      // which the canonical-ID test below does.
      const separator = entry.indexOf('=');
      if (separator === -1) return null;

      const email = normalizeEmail(entry.slice(0, separator));
      const capperId = entry.slice(separator + 1).trim().toLowerCase();
      if (!email || !email.includes('@')) return null;
      if (!CANONICAL_CAPPER_ID.test(capperId)) return null;

      return { email, capperId };
    })
    .filter((capper): capper is AllowedCapper => capper !== null);

  return Array.from(new Map(cappers.map((capper) => [capper.email, capper])).values());
}

export function findAllowedCapper(
  email: string | null | undefined,
  allowedCappers: readonly AllowedCapper[],
): AllowedCapper | null {
  if (!email) return null;
  const normalized = normalizeEmail(email);
  return allowedCappers.find((capper) => capper.email === normalized) ?? null;
}
