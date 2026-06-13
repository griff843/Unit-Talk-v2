import type { AppEnv } from '@unit-talk/config';
import { fetchSGOAccountUsage, type SGOAccountUsage } from './sgo-fetcher.js';

export interface SgoApiKeyCandidate {
  apiKey: string;
  source: string;
  tag: string;
}

export interface SgoApiKeyProbe {
  source: string;
  tag: string;
  status: 'active' | 'invalid' | 'error';
  reason?: string;
  usage?: {
    plan: string | null;
    objectsUsed: number | null;
    objectsLimit: number | null;
    creditsUsed: number | null;
    creditsLimit: number | null;
    resetAt: string | null;
  };
}

export async function resolveActiveSgoApiKey(
  candidates: readonly SgoApiKeyCandidate[],
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<{
  active: SgoApiKeyCandidate | null;
  probes: SgoApiKeyProbe[];
}> {
  const probes: SgoApiKeyProbe[] = [];

  for (const candidate of candidates) {
    try {
      const usage = await fetchWithTimeout(
        fetchSGOAccountUsage(candidate.apiKey, options.fetchImpl ?? fetch),
        options.timeoutMs ?? 5_000,
        'SGO account usage probe timed out',
      );
      probes.push({
        source: candidate.source,
        tag: candidate.tag,
        status: 'active',
        usage: summarizeUsage(usage),
      });
      return {
        active: candidate,
        probes,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      probes.push({
        source: candidate.source,
        tag: candidate.tag,
        status: classifyProbeFailure(reason),
        reason,
      });
    }
  }

  return {
    active: null,
    probes,
  };
}

export function collectConfiguredSgoApiKeyCandidates(
  env: Pick<AppEnv, 'SGO_API_KEY' | 'SGO_API_KEY_FALLBACK' | 'SGO_API_KEYS'>,
): SgoApiKeyCandidate[] {
  const ordered = [
    ...(env.SGO_API_KEYS ?? []).map((apiKey, index) => ({
      apiKey,
      source: `SGO_API_KEYS[${index}]`,
    })),
    ...(env.SGO_API_KEY ? [{ apiKey: env.SGO_API_KEY, source: 'SGO_API_KEY' }] : []),
    ...(env.SGO_API_KEY_FALLBACK
      ? [{ apiKey: env.SGO_API_KEY_FALLBACK, source: 'SGO_API_KEY_FALLBACK' }]
      : []),
  ];

  const seen = new Set<string>();
  const candidates: SgoApiKeyCandidate[] = [];
  for (const entry of ordered) {
    const apiKey = entry.apiKey.trim();
    if (!apiKey || seen.has(apiKey)) {
      continue;
    }
    seen.add(apiKey);
    candidates.push({
      apiKey,
      source: entry.source,
      tag: describeSgoApiKey(apiKey),
    });
  }

  return candidates;
}

export interface SgoKeyResolutionDiagnostic {
  healthCode: 'SGO_KEY_UNCONFIGURED' | 'SGO_KEY_PROBE_FAILED';
  message: string;
  sgoKeyCandidateCount: number;
  probes: Array<{
    source: string;
    tag: string;
    status: SgoApiKeyProbe['status'];
    reason?: string;
  }>;
}

/**
 * Build a structured diagnostic when no active SGO key was resolved (UTV2-1272).
 *
 * Distinguishes a genuinely-unconfigured environment (`SGO_KEY_UNCONFIGURED`)
 * from one where keys ARE configured but failed the live account probe this
 * cycle (`SGO_KEY_PROBE_FAILED`). The latter is a transient/credential
 * condition, NOT a missing key — so the downstream per-league
 * "SGO_API_KEY missing; skipping ingest" warning must not be read as
 * misconfiguration. Returns null when an active key exists.
 *
 * Never emits raw key material: `probe.tag` is already masked via
 * {@link describeSgoApiKey}, and the SGO key is sent as a request header (never
 * embedded in probe failure reasons).
 */
export function buildSgoKeyResolutionDiagnostic(input: {
  candidateCount: number;
  active: SgoApiKeyCandidate | null;
  probes: readonly SgoApiKeyProbe[];
}): SgoKeyResolutionDiagnostic | null {
  if (input.active) {
    return null;
  }

  const probes = input.probes.map((probe) => ({
    source: probe.source,
    tag: probe.tag,
    status: probe.status,
    ...(probe.reason ? { reason: probe.reason } : {}),
  }));

  if (input.candidateCount === 0) {
    return {
      healthCode: 'SGO_KEY_UNCONFIGURED',
      message:
        'No SGO API keys configured; ingest will skip all leagues until a key is provided.',
      sgoKeyCandidateCount: 0,
      probes,
    };
  }

  return {
    healthCode: 'SGO_KEY_PROBE_FAILED',
    message:
      `${input.candidateCount} SGO API key candidate(s) configured but none passed the ` +
      'account probe this cycle; this is a transient/credential condition, not a missing key.',
    sgoKeyCandidateCount: input.candidateCount,
    probes,
  };
}

export function describeSgoApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return trimmed;
  }

  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function summarizeUsage(usage: SGOAccountUsage) {
  return {
    plan: usage.plan,
    objectsUsed: usage.objectsUsed,
    objectsLimit: usage.objectsLimit,
    creditsUsed: usage.creditsUsed,
    creditsLimit: usage.creditsLimit,
    resetAt: usage.resetAt,
  };
}

function classifyProbeFailure(reason: string): SgoApiKeyProbe['status'] {
  const normalized = reason.toLowerCase();
  if (normalized.includes('401') || normalized.includes('403')) {
    return 'invalid';
  }
  return 'error';
}

function fetchWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
