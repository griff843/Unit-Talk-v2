/**
 * UTV2-1630 — isolated proof execution.
 *
 * ## The problem this closes
 *
 * `proof-auditor-gate.ts` runs with `--require-executed-command "pnpm test:db"`
 * and is satisfied by TAP text (`# pass <n>`, `# fail 0`, `# skipped 0`)
 * appearing anywhere in the proof bundle. It never asks *which database the
 * test ran against*. Two consequences:
 *
 *   1. A receipt produced against **production** satisfies the T1 proof gate
 *      exactly as well as one from an isolated project. The gate cannot tell
 *      them apart, so "runtime proof" has never actually proven isolation.
 *   2. Because the only way to obtain that TAP was to hold live credentials, a
 *      T1 lane could satisfy its own proof gate *only* by holding production
 *      credentials — which is the capability UTV2-1627 exists to remove. The
 *      proof requirement and the containment requirement were in direct
 *      conflict.
 *
 * This module makes the target *mechanically proven* rather than declared. An
 * attestation is emitted by the process that actually ran the smoke test, and
 * the gate rejects any receipt whose target cannot be shown to be non-production.
 *
 * ## Why a declared label is not enough
 *
 * UTV2-1627 already established that `UNIT_TALK_DB_ACCESS_MODE:
 * production-read-only` is a *declaration*, not an enforcement — it grants
 * nothing and removes no capability. The same reasoning applies here: an
 * attestation that merely says "isolated" would be worthless. So the attestation
 * carries the observed project ref extracted from the *resolved connection
 * target*, and validation re-derives the verdict from that ref rather than
 * trusting any claim in the receipt.
 */

/** The canonical production Supabase project. Never a valid proof target. */
export const CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';

/** Supabase project hosts are `<ref>.supabase.co` — the ref is the leftmost label. */
const SUPABASE_PROJECT_HOST_SUFFIXES = ['.supabase.co', '.supabase.in'];

/** A Supabase project ref is exactly 20 lowercase alphanumerics. */
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;

export const ATTESTATION_MARKER = 'isolated-db-proof-attestation/v1';

export interface IsolatedProofAttestation {
  schema: typeof ATTESTATION_MARKER;
  /** Project ref extracted from the resolved target host. */
  observedProjectRef: string | null;
  /** Host the smoke test actually connected to. */
  targetHost: string | null;
  /** True only when the observed ref is the canonical production project. */
  canonicalProduction: boolean;
  /** Command whose TAP output this attestation covers. */
  command: string;
}

export interface AttestationVerdict {
  ok: boolean;
  reason: string;
}

/**
 * Extract the project ref from a Supabase URL by host STRUCTURE.
 *
 * Deliberately not a substring search. A substring test is defeated from both
 * directions: a two-character declared ref "matches" any host containing it, and
 * any host carrying a 20-character alphanumeric run
 * (`https://abcdefghijklmnopqrst.evil.example`) looks ref-shaped. Only the
 * leftmost label of a genuine Supabase project host counts.
 */
export function extractProjectRefFromUrl(rawUrl: string | undefined): {
  projectRef: string | null;
  host: string | null;
} {
  if (!rawUrl || !rawUrl.trim()) return { projectRef: null, host: null };

  let host: string;
  try {
    // `new URL().hostname` also normalizes percent-encoding, so a host such as
    // `zfzdnfwdarxucxtaojx%6d.supabase.co` resolves to the real production host
    // instead of slipping past as an unrecognized string.
    host = new URL(rawUrl.trim()).hostname.toLowerCase();
  } catch {
    return { projectRef: null, host: null };
  }

  const suffix = SUPABASE_PROJECT_HOST_SUFFIXES.find((candidate) =>
    host.endsWith(candidate),
  );
  if (!suffix) return { projectRef: null, host };

  const label = host.slice(0, -suffix.length);
  // Exactly one label: `<ref>.supabase.co`, never `a.b.supabase.co`.
  if (!label || label.includes('.')) return { projectRef: null, host };
  if (!PROJECT_REF_PATTERN.test(label)) return { projectRef: null, host };
  return { projectRef: label, host };
}

/** Build an attestation from the connection target actually used. */
export function buildIsolatedProofAttestation(
  supabaseUrl: string | undefined,
  command: string,
): IsolatedProofAttestation {
  const { projectRef, host } = extractProjectRefFromUrl(supabaseUrl);
  return {
    schema: ATTESTATION_MARKER,
    observedProjectRef: projectRef,
    targetHost: host,
    canonicalProduction:
      projectRef === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
    command,
  };
}

/** Serialize as a single greppable line for embedding in proof output. */
export function formatAttestationLine(
  attestation: IsolatedProofAttestation,
): string {
  return `[${ATTESTATION_MARKER}] ${JSON.stringify(attestation)}`;
}

/**
 * Recover every attestation embedded in a proof file.
 *
 * Returns [] when none is present — the caller must treat that as a failure,
 * not as permission. Absence of evidence is not evidence of isolation.
 */
export function parseAttestations(content: string): IsolatedProofAttestation[] {
  const found: IsolatedProofAttestation[] = [];
  const pattern = new RegExp(
    `\\[${ATTESTATION_MARKER.replace(/[/\\^$*+?.()|[\]{}]/gu, '\\$&')}\\]\\s*(\\{.*?\\})`,
    'gu',
  );
  for (const match of content.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1] as string) as IsolatedProofAttestation;
      if (parsed && parsed.schema === ATTESTATION_MARKER) found.push(parsed);
    } catch {
      // A malformed attestation is not a usable one; skip it. The caller still
      // fails closed if no VALID attestation remains.
    }
  }
  return found;
}

/**
 * Decide whether a proof bundle proves its DB evidence came from an isolated
 * target. Fails closed on every ambiguous case.
 *
 * The verdict is re-derived from `observedProjectRef`; the attestation's own
 * `canonicalProduction` field is never trusted, so a hand-edited receipt
 * claiming `false` for the production ref is still rejected.
 */
export function verifyIsolatedProofEvidence(
  content: string,
  command: string,
): AttestationVerdict {
  const attestations = parseAttestations(content).filter(
    (entry) => entry.command === command,
  );

  if (attestations.length === 0) {
    return {
      ok: false,
      reason:
        `no ${ATTESTATION_MARKER} found for "${command}". DB proof must carry a ` +
        'machine-checkable attestation of the project it ran against; TAP output ' +
        'alone cannot distinguish an isolated run from a production one.',
    };
  }

  for (const attestation of attestations) {
    const ref = attestation.observedProjectRef;
    if (!ref) {
      return {
        ok: false,
        reason:
          `attestation for "${command}" could not identify a Supabase project ref ` +
          `(host: ${attestation.targetHost ?? 'unparseable'}). A custom domain, ` +
          'pooler, or tunnel may front production, so the target is not provably isolated.',
      };
    }
    if (!PROJECT_REF_PATTERN.test(ref)) {
      return {
        ok: false,
        reason: `attestation for "${command}" carries a malformed project ref "${ref}".`,
      };
    }
    if (ref === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF) {
      return {
        ok: false,
        reason:
          `attestation for "${command}" proves the run targeted canonical production ` +
          `${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}. Production is never a valid ` +
          'proof target.',
      };
    }
  }

  return {
    ok: true,
    reason: `DB proof for "${command}" attested against isolated project ${attestations[0]?.observedProjectRef}`,
  };
}
