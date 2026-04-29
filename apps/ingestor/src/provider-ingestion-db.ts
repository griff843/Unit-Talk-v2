import type { ProviderIngestionDbWritePolicy } from './provider-ingestion-policy.js';
import { classifyProviderIngestionFailure } from './provider-ingestion-failures.js';

export async function withProviderDbRetry<T>(
  operation: () => Promise<T>,
  policy: ProviderIngestionDbWritePolicy,
  context: {
    providerKey: string;
    sportKey?: string | null;
    marketKey?: string | null;
  },
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < policy.retryMaxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const failure = classifyProviderIngestionFailure(error, context);
      if (!failure.retryable || attempt >= policy.retryMaxAttempts) {
        throw error;
      }
      await sleep(policy.retryBackoffMs * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function chunkByPolicy<T>(
  values: T[],
  chunkSize: number,
): T[][] {
  if (values.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
