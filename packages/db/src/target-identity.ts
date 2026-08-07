/**
 * Which database am I actually pointed at?
 *
 * These primitives were introduced by UTV2-1630 in
 * `scripts/ci/isolated-proof-attestation.ts` to gate the writable npm scripts.
 * UTV2-1628 needs the same question answered one layer lower — inside the
 * client constructor itself — and `packages/db` cannot import from `scripts/`.
 *
 * So the implementation lives here and `scripts/ci/isolated-proof-attestation.ts`
 * re-exports it. There is exactly one identity check in the repository; moving
 * it did not fork it. Every original importer still resolves to this code.
 *
 * Nothing here reads the environment, opens a socket, or touches a credential.
 * It is pure string analysis over a URL, which is what makes it safe to call
 * from the constructor path in production as well as in CI.
 */

/** Canonical production. Never a valid test or proof target. */
export const CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';

/** The staging/CI project UTV2-1630 provisioned. The only valid proof target. */
export const EXPECTED_STAGING_SUPABASE_PROJECT_REF = 'xskgrzbteyqdufktjrjx';

/**
 * Supabase project hosts are `<ref>.supabase.co`. `.supabase.in` appeared in an
 * earlier draft on no evidence and is deliberately absent — widening the
 * trusted-suffix set is the wrong direction for a containment control.
 */
const SUPABASE_PROJECT_HOST_SUFFIX = '.supabase.co';

/** A Supabase project ref is exactly 20 lowercase alphanumerics. */
export const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;

/**
 * Extract the project ref from a Supabase URL by host STRUCTURE.
 *
 * Not a substring search: a short declared ref would "match" any host
 * containing it, and any host carrying a 20-character alphanumeric run
 * (`https://abcdefghijklmnopqrst.evil.example`) would look ref-shaped. Only the
 * single leftmost label of a genuine `*.supabase.co` host counts.
 */
export function extractProjectRefFromUrl(rawUrl: string | undefined): {
  projectRef: string | null;
  host: string | null;
} {
  if (!rawUrl || !rawUrl.trim()) return { projectRef: null, host: null };

  let host: string;
  try {
    // `new URL().hostname` normalizes percent-encoding, so a disguised host
    // such as `zfzdnfwdarxucxtaojx%6d.supabase.co` — a live production URL —
    // resolves to the real host instead of slipping past unrecognized.
    host = new URL(rawUrl.trim()).hostname.toLowerCase();
  } catch {
    return { projectRef: null, host: null };
  }
  // A trailing-dot FQDN resolves identically, so strip it rather than letting
  // `<ref>.supabase.co.` evade the suffix test.
  if (host.endsWith('.')) host = host.slice(0, -1);

  if (!host.endsWith(SUPABASE_PROJECT_HOST_SUFFIX)) return { projectRef: null, host };
  const label = host.slice(0, -SUPABASE_PROJECT_HOST_SUFFIX.length);
  // Exactly one label: `<ref>.supabase.co`, never `db.<ref>.supabase.co`.
  if (!label || label.includes('.')) return { projectRef: null, host };
  if (!PROJECT_REF_PATTERN.test(label)) return { projectRef: null, host };
  return { projectRef: label, host };
}

/**
 * True only when a target is POSITIVELY identified as the expected staging
 * project.
 *
 * An unidentifiable target returns false. An earlier writer-side check refused
 * only positively-identified production, so custom domains, poolers, tunnels,
 * `db.<ref>.supabase.co` and empty values all fell through and the smoke test
 * ran and wrote — protecting the paperwork while leaving the database exposed.
 */
export function isApprovedStagingTarget(
  supabaseUrl: string | undefined,
  expected: string = EXPECTED_STAGING_SUPABASE_PROJECT_REF,
): boolean {
  const { projectRef } = extractProjectRefFromUrl(supabaseUrl);
  if (!projectRef) return false;
  if (projectRef === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF) return false;
  return projectRef === expected;
}

/**
 * True when the target is unambiguously a loopback address on this machine.
 *
 * This is the one class of target a restricted context may reach that is not
 * the staging project: the offline unit suite points `SUPABASE_URL` at
 * `http://127.0.0.1:1` precisely so that any accidental network call fails
 * immediately. Refusing it would break the suite without protecting anything —
 * a loopback address cannot be production.
 *
 * Hostnames that merely *resolve* to loopback (a `/etc/hosts` alias, a tunnel)
 * are deliberately not accepted. Only literal loopback forms count, so this
 * cannot be widened by DNS.
 */
export function isLoopbackTarget(rawUrl: string | undefined): boolean {
  if (!rawUrl || !rawUrl.trim()) return false;
  let host: string;
  try {
    host = new URL(rawUrl.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '[::1]' || host === '::1') return true;
  // 127.0.0.0/8 in dotted-quad form.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host);
}
