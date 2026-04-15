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
