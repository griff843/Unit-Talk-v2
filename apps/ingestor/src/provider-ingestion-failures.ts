import type {
  ProviderIngestionFailureCategory,
  ProviderIngestionFailureScope,
} from '@unit-talk/db';

export interface ProviderIngestionFailureRecord {
  category: ProviderIngestionFailureCategory;
  scope: ProviderIngestionFailureScope;
  message: string;
  affectedProviderKey?: string | null;
  affectedSportKey?: string | null;
  affectedMarketKey?: string | null;
  retryable: boolean;
}

export function classifyProviderIngestionFailure(
  error: unknown,
  context: {
    providerKey: string;
    sportKey?: string | null;
    marketKey?: string | null;
  },
): ProviderIngestionFailureRecord {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes('statement timeout') ||
    normalized.includes('canceling statement due to statement timeout')
  ) {
    return {
      category: 'db_statement_timeout',
      scope: 'db',
      message,
      affectedProviderKey: context.providerKey,
      affectedSportKey: context.sportKey ?? null,
      affectedMarketKey: context.marketKey ?? null,
      retryable: true,
    };
  }

  if (normalized.includes('lock timeout')) {
    return {
      category: 'db_lock_timeout',
      scope: 'db',
      message,
      affectedProviderKey: context.providerKey,
      affectedSportKey: context.sportKey ?? null,
      affectedMarketKey: context.marketKey ?? null,
      retryable: true,
    };
  }

  if (normalized.includes('deadlock detected')) {
    return {
      category: 'db_deadlock',
      scope: 'db',
      message,
      affectedProviderKey: context.providerKey,
      affectedSportKey: context.sportKey ?? null,
      affectedMarketKey: context.marketKey ?? null,
      retryable: true,
    };
  }

  if (
    normalized.includes('unexpected token') ||
    normalized.includes('json') ||
    normalized.includes('normalize')
  ) {
    return {
      category: 'parse_failure',
      scope: context.marketKey ? 'market' : 'provider',
      message,
      affectedProviderKey: context.providerKey,
      affectedSportKey: context.sportKey ?? null,
      affectedMarketKey: context.marketKey ?? null,
      retryable: false,
    };
  }

  if (
    normalized.includes('503') ||
    normalized.includes('502') ||
    normalized.includes('504') ||
    normalized.includes('rate limit') ||
    normalized.includes('forbidden') ||
    normalized.includes('provider api')
  ) {
    return {
      category: 'provider_api_failure',
      scope: 'provider',
      message,
      affectedProviderKey: context.providerKey,
      affectedSportKey: context.sportKey ?? null,
      affectedMarketKey: context.marketKey ?? null,
      retryable: true,
    };
  }

  if (normalized.includes('archive')) {
    return {
      category: 'archive_failure',
      scope: 'archive',
      message,
      affectedProviderKey: context.providerKey,
      affectedSportKey: context.sportKey ?? null,
      affectedMarketKey: context.marketKey ?? null,
      retryable: true,
    };
  }

  return {
    category: 'unknown_failure',
    scope: 'cycle',
    message,
    affectedProviderKey: context.providerKey,
    affectedSportKey: context.sportKey ?? null,
    affectedMarketKey: context.marketKey ?? null,
    retryable: false,
  };
}

export function createZeroOffersFailure(
  providerKey: string,
  sportKey: string,
): ProviderIngestionFailureRecord {
  return {
    category: 'zero_offers',
    scope: 'sport',
    message: `Provider returned zero offers for ${providerKey}/${sportKey}`,
    affectedProviderKey: providerKey,
    affectedSportKey: sportKey,
    affectedMarketKey: null,
    retryable: false,
  };
}

export function createPartialMarketFailure(
  providerKey: string,
  sportKey: string,
  marketKey: string | null,
  message: string,
): ProviderIngestionFailureRecord {
  return {
    category: 'partial_market_failure',
    scope: marketKey ? 'market' : 'sport',
    message,
    affectedProviderKey: providerKey,
    affectedSportKey: sportKey,
    affectedMarketKey: marketKey,
    retryable: false,
  };
}

export function createStaleAfterCycleFailure(
  providerKey: string,
  sportKey: string,
  message: string,
): ProviderIngestionFailureRecord {
  return {
    category: 'stale_after_cycle',
    scope: 'sport',
    message,
    affectedProviderKey: providerKey,
    affectedSportKey: sportKey,
    affectedMarketKey: null,
    retryable: false,
  };
}
