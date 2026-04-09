/**
 * System Pick Scanner
 *
 * Polls provider_offers for recent is_opening=true player prop rows, resolves the
 * canonical market key via provider_market_aliases, and auto-submits picks to
 * POST /api/submissions. Designed to keep the grading/CLV pipeline fed with
 * picks during the G12 canary period without manual submission.
 *
 * Gate: SYSTEM_PICK_SCANNER_ENABLED=true (default: off)
 * Interval: wired in index.ts (default 5 minutes)
 */

import { americanToImplied, applyDevig } from '@unit-talk/domain';
import type { AppEnv } from '@unit-talk/config';
import type {
  EventRepository,
  ParticipantRepository,
  ProviderOfferRecord,
  ProviderOfferRepository,
} from '@unit-talk/db';

export interface SystemPickScanOptions {
  enabled: boolean;
  apiUrl: string;
  apiKey?: string | undefined;
  /** How far back to look for opening lines. Default: 24 hours. */
  lookbackHours?: number;
  /** Max picks to submit per run. Default: 100. */
  maxPicksPerRun?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface SystemPickScanResult {
  scanned: number;
  submitted: number;
  skipped: number;
  errors: number;
}

export function loadSystemPickScannerConfig(env: Pick<
  AppEnv,
  | 'SYSTEM_PICK_SCANNER_ENABLED'
  | 'SYSTEM_PICK_SCANNER_LOOKBACK_HOURS'
  | 'SYSTEM_PICK_SCANNER_MAX_PICKS'
  | 'UNIT_TALK_API_URL'
  | 'UNIT_TALK_API_KEY_SUBMITTER'
>): Pick<SystemPickScanOptions, 'enabled' | 'apiUrl' | 'apiKey' | 'lookbackHours' | 'maxPicksPerRun'> {
  return {
    enabled: env.SYSTEM_PICK_SCANNER_ENABLED === 'true',
    apiUrl: (env.UNIT_TALK_API_URL ?? '').replace(/\/+$/, ''),
    apiKey: env.UNIT_TALK_API_KEY_SUBMITTER?.trim() || undefined,
    lookbackHours: parsePositiveInt(env.SYSTEM_PICK_SCANNER_LOOKBACK_HOURS, 24),
    maxPicksPerRun: parsePositiveInt(env.SYSTEM_PICK_SCANNER_MAX_PICKS, 100),
  };
}

export async function runSystemPickScan(
  repositories: {
    providerOffers: ProviderOfferRepository;
    participants: ParticipantRepository;
    events: EventRepository;
  },
  options: SystemPickScanOptions,
): Promise<SystemPickScanResult> {
  if (!options.enabled) {
    return { scanned: 0, submitted: 0, skipped: 0, errors: 0 };
  }

  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  if (!apiUrl) {
    options.logger?.warn?.('system-pick-scanner: UNIT_TALK_API_URL not set — skipping scan');
    return { scanned: 0, submitted: 0, skipped: 0, errors: 0 };
  }

  const lookbackHours = options.lookbackHours ?? 24;
  const maxPicksPerRun = options.maxPicksPerRun ?? 100;
  const fetchImpl = options.fetchImpl ?? fetch;

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const offers = await repositories.providerOffers.listOpeningOffers(since, 'sgo', maxPicksPerRun);

  let submitted = 0;
  let skipped = 0;
  let errors = 0;

  for (const offer of offers) {
    try {
      const result = await processOffer(offer, repositories, {
        apiUrl,
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        fetchImpl,
        ...(options.logger ? { logger: options.logger } : {}),
      });
      if (result === 'submitted') submitted++;
      else skipped++;
    } catch (err) {
      errors++;
      options.logger?.error?.(
        JSON.stringify({
          service: 'system-pick-scanner',
          event: 'offer_processing_error',
          offerId: offer.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  options.logger?.info?.(
    JSON.stringify({
      service: 'system-pick-scanner',
      event: 'scan.completed',
      scanned: offers.length,
      submitted,
      skipped,
      errors,
    }),
  );

  return { scanned: offers.length, submitted, skipped, errors };
}

async function processOffer(
  offer: ProviderOfferRecord,
  repositories: {
    providerOffers: ProviderOfferRepository;
    participants: ParticipantRepository;
    events: EventRepository;
  },
  ctx: { apiUrl: string; apiKey?: string; fetchImpl: (input: string, init?: RequestInit) => Promise<Response>; logger?: Pick<Console, 'info' | 'warn' | 'error'> },
): Promise<'submitted' | 'skipped'> {
  // Resolve canonical market key from SGO native key
  const canonicalMarketKey = await repositories.providerOffers.resolveCanonicalMarketKey(
    offer.provider_market_key,
    offer.provider_key,
  );
  if (!canonicalMarketKey) {
    return 'skipped'; // No canonical mapping — not a gradeable player prop
  }

  // Compute devigged fair probability
  const overImplied = americanToImplied(offer.over_odds as number);
  const underImplied = americanToImplied(offer.under_odds as number);
  const devigged = applyDevig(overImplied, underImplied, 'proportional');
  if (!devigged) {
    return 'skipped';
  }

  // Pick the higher-probability side
  const side = devigged.overFair >= devigged.underFair ? 'over' : 'under';
  const odds = side === 'over' ? (offer.over_odds as number) : (offer.under_odds as number);
  const line = offer.line as number;
  const selection = side === 'over' ? `Over ${line}` : `Under ${line}`;

  // Resolve participant display name (needed for grading's fuzzy match)
  const participant = offer.provider_participant_id
    ? await repositories.participants.findByExternalId(offer.provider_participant_id)
    : null;
  if (!participant) {
    return 'skipped'; // No participant record — grading can't resolve it
  }

  // Resolve event name (best-effort — improves grading event matching)
  const event = await repositories.events.findByExternalId(offer.provider_event_id);

  const idempotencyKey = `system-pick:sgo:${offer.provider_event_id}:${offer.provider_participant_id}:${offer.provider_market_key}:${side}`;

  const payload = {
    source: 'system-pick-scanner' as const,
    submittedBy: 'system:pick-scanner',
    market: canonicalMarketKey,
    selection,
    line,
    odds,
    confidence: roundTo(side === 'over' ? devigged.overFair : devigged.underFair, 4),
    eventName: event?.event_name ?? undefined,
    metadata: {
      idempotencyKey,
      player: participant.display_name,
      sport: participant.sport ?? undefined,
      providerEventId: offer.provider_event_id,
      providerMarketKey: offer.provider_market_key,
      providerParticipantId: offer.provider_participant_id,
      systemGenerated: true,
    },
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ctx.apiKey) {
    headers['Authorization'] = `Bearer ${ctx.apiKey}`;
  }

  const response = await ctx.fetchImpl(`${ctx.apiUrl}/api/submissions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (response.status === 409) {
    // Already submitted — idempotent skip
    return 'skipped';
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Submission API returned ${response.status}: ${body.slice(0, 200)}`);
  }

  ctx.logger?.info?.(
    JSON.stringify({
      service: 'system-pick-scanner',
      event: 'pick.submitted',
      canonicalMarketKey,
      participant: participant.display_name,
      side,
      line,
      odds,
    }),
  );

  return 'submitted';
}

function roundTo(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
