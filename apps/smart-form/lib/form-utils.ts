import type { CatalogData, MarketTypeId } from './catalog';
import type { EventOfferBrowseResult } from './api-client';
import type { BetFormValues } from './form-schema';
import { MARKET_TYPE_LABELS } from './form-schema';
import type { SubmitPickPayload } from './api-client';

export interface SubmissionContext {
  submissionMode?: 'live-offer' | 'manual';
  eventId?: string | null;
  leagueId?: string | null;
  teamId?: string | null;
  playerId?: string | null;
  canonicalMarketTypeId?: string | null;
  sportsbookId?: string | null;
  selectedOffer?: Pick<EventOfferBrowseResult, 'providerKey' | 'providerMarketKey' | 'providerParticipantId' | 'snapshotAt'> | null;
}

export function getMarketTypesForSport(
  catalog: CatalogData,
  sportId: string,
): MarketTypeId[] {
  const sport = catalog.sports.find((s) => s.id === sportId);
  return (sport?.marketTypes ?? []) as MarketTypeId[];
}

export function getStatTypesForSport(
  catalog: CatalogData,
  sportId: string,
): string[] {
  const sport = catalog.sports.find((s) => s.id === sportId);
  return sport?.statTypes ?? [];
}

/**
 * Calculates potential profit (not total payout) from American odds + units.
 * Returns null if inputs are invalid.
 */
export function calcPayout(units: number, odds: number): number | null {
  if (!units || !odds || units <= 0) return null;
  if (odds >= 100) return units * (odds / 100);
  if (odds <= -100) return units * (100 / Math.abs(odds));
  return null;
}

export function buildSelectionString(values: BetFormValues): string {
  const { marketType, playerName, statType, direction, line, team } = values;

  if (marketType === 'player-prop') {
    const dirLabel = direction === 'over' ? 'O' : direction === 'under' ? 'U' : '';
    const parts = [playerName, statType, dirLabel, line !== undefined ? String(line) : ''];
    return parts.filter(Boolean).join(' ');
  }

  if (marketType === 'moneyline') {
    return team ?? '';
  }

  if (marketType === 'spread') {
    const parts = [team, line !== undefined ? (line > 0 ? `+${line}` : String(line)) : ''];
    return parts.filter(Boolean).join(' ');
  }

  if (marketType === 'team-total') {
    const dirLabel = direction === 'over' ? 'Over' : direction === 'under' ? 'Under' : '';
    const parts = [team, dirLabel, line !== undefined ? String(line) : ''];
    return parts.filter(Boolean).join(' ');
  }

  if (marketType === 'total') {
    const dirLabel = values.direction === 'over' ? 'O' : values.direction === 'under' ? 'U' : '';
    return [dirLabel, line !== undefined ? String(line) : ''].filter(Boolean).join(' ');
  }

  return '';
}

export function mapOfferToFormMarketType(offer: Pick<EventOfferBrowseResult, 'marketTypeId' | 'participantId'>): MarketTypeId {
  const marketTypeId = offer.marketTypeId?.toLowerCase() ?? '';
  if (marketTypeId === 'moneyline') {
    return 'moneyline';
  }
  if (marketTypeId.includes('spread')) {
    return 'spread';
  }
  if (marketTypeId.includes('team-total') || marketTypeId.includes('team_total')) {
    return 'team-total';
  }
  if (offer.participantId) {
    return 'player-prop';
  }
  return 'total';
}

export function inferStatTypeFromMarketTypeId(
  marketTypeId: string | null | undefined,
  marketDisplayName?: string | null,
): string | undefined {
  const marketKey = marketTypeId?.toLowerCase() ?? marketDisplayName?.toLowerCase() ?? '';
  if (
    marketKey.includes('points + assists') ||
    marketKey.includes('points_assists') ||
    marketKey.includes('pa-') ||
    marketKey.includes('pa-all-game-ou')
  ) {
    return 'Points + Assists';
  }
  if (
    marketKey.includes('points + rebounds + assists') ||
    marketKey.includes('points_rebounds_assists') ||
    marketKey.includes('pra')
  ) {
    return 'Points + Rebounds + Assists';
  }
  if (
    marketKey.includes('points + rebounds') ||
    marketKey.includes('points_rebounds') ||
    marketKey.includes('pr-') ||
    marketKey.includes('pr-all-game-ou')
  ) {
    return 'Points + Rebounds';
  }
  if (
    marketKey.includes('rebounds + assists') ||
    marketKey.includes('rebounds_assists') ||
    marketKey.includes('ra-') ||
    marketKey.includes('ra-all-game-ou')
  ) {
    return 'Rebounds + Assists';
  }
  if (marketKey.includes('points')) {
    return 'Points';
  }
  if (marketKey.includes('rebounds')) {
    return 'Rebounds';
  }
  if (marketKey.includes('assists')) {
    return 'Assists';
  }
  if (marketKey.includes('threes') || marketKey.includes('3pt')) {
    return 'Threes';
  }
  if (marketKey.includes('steals')) {
    return 'Steals';
  }
  if (marketKey.includes('blocks')) {
    return 'Blocks';
  }
  return undefined;
}

export function resolveSportsbookId(catalog: CatalogData, sportsbookValue: string | undefined): string | null {
  if (!sportsbookValue) {
    return null;
  }

  const exactId = catalog.sportsbooks.find((sportsbook) => sportsbook.id === sportsbookValue);
  if (exactId) {
    return exactId.id;
  }

  const byName = catalog.sportsbooks.find(
    (sportsbook) => sportsbook.name.toLowerCase() === sportsbookValue.toLowerCase(),
  );
  return byName?.id ?? null;
}

export function buildSubmissionPayload(
  values: BetFormValues,
  context: SubmissionContext = {},
): SubmitPickPayload {
  const marketLabel = MARKET_TYPE_LABELS[values.marketType];
  const market = context.canonicalMarketTypeId ?? `${values.sport} - ${marketLabel}`;
  const selection = buildSelectionString(values);
  const trustScore = values.capperConviction * 10;

  return {
    source: 'smart-form',
    submittedBy: values.capper,
    market,
    selection,
    line: values.line,
    odds: values.odds,
    stakeUnits: values.units,
    confidence: values.capperConviction / 10,
    eventName: values.eventName,
    metadata: {
      ticketType: 'single',
      sport: values.sport,
      marketType: values.marketType,
      date: values.gameDate,
      capper: values.capper,
      sportsbook: values.sportsbook,
      sportsbookId: context.sportsbookId ?? null,
      player: values.playerName,
      playerId: context.playerId ?? null,
      statType: values.statType,
      overUnder: values.direction,
      team: values.team,
      teamId: context.teamId ?? null,
      eventName: values.eventName,
      eventId: context.eventId ?? null,
      leagueId: context.leagueId ?? null,
      marketTypeId: context.canonicalMarketTypeId ?? null,
      submissionMode: context.submissionMode ?? 'manual',
      selectedOffer: context.selectedOffer
        ? {
            providerKey: context.selectedOffer.providerKey,
            providerMarketKey: context.selectedOffer.providerMarketKey,
            providerParticipantId: context.selectedOffer.providerParticipantId,
            snapshotAt: context.selectedOffer.snapshotAt,
          }
        : null,
      capperConviction: values.capperConviction,
      promotionScores: {
        trust: trustScore,
      },
    },
  };
}
