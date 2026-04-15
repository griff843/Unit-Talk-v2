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
  manualOverrideFields?: string[];
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
    marketKey.includes('pts_rebs') ||
    marketKey.includes('pr-') ||
    marketKey.includes('pr-all-game-ou')
  ) {
    return 'Points + Rebounds';
  }
  if (
    marketKey.includes('rebounds + assists') ||
    marketKey.includes('rebounds_assists') ||
    marketKey.includes('rebs_asts') ||
    marketKey.includes('ra-') ||
    marketKey.includes('ra-all-game-ou')
  ) {
    return 'Rebounds + Assists';
  }
  if (marketKey.includes('pitcher_outs') || marketKey.includes('pitching_outs') || marketKey.includes('pitching-outs')) {
    return 'Pitcher Outs';
  }
  if (marketKey.includes('innings') || marketKey.includes('innings_pitched')) {
    return 'Pitching Innings Pitched';
  }
  if (marketKey.includes('strikeouts')) {
    return marketKey.includes('pitch') ? 'Pitching Strikeouts' : 'Strikeouts';
  }
  if (marketKey.includes('earned runs') || marketKey.includes('earned_runs')) {
    return 'Earned Runs';
  }
  if (marketKey.includes('hits + runs + rbis') || marketKey.includes('hits_runs_rbis') || marketKey.includes('hrr')) {
    return 'Hits + Runs + RBIs';
  }
  if (marketKey.includes('hits allowed') || marketKey.includes('hits_allowed')) {
    return 'Hits Allowed';
  }
  if (
    marketKey.includes('singles') ||
    marketKey.includes('batter_singles') ||
    marketKey.includes('player_singles')
  ) {
    return 'Singles';
  }
  if (
    marketKey.includes('doubles') ||
    marketKey.includes('batter_doubles') ||
    marketKey.includes('player_doubles')
  ) {
    return 'Doubles';
  }
  if (
    marketKey.includes('triples') ||
    marketKey.includes('batter_triples') ||
    marketKey.includes('player_triples')
  ) {
    return 'Triples';
  }
  if (marketKey.includes('home runs') || marketKey.includes('home_runs')) {
    return 'Home Runs';
  }
  if (marketKey.includes('total bases') || marketKey.includes('total_bases')) {
    return 'Total Bases';
  }
  if (marketKey.includes('walks')) {
    return 'Walks';
  }
  if (marketKey.includes('rbi')) {
    return 'RBI';
  }
  if (marketKey.includes('hits')) {
    return 'Hits';
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
  if (marketKey.includes('turnovers')) {
    return 'Turnovers';
  }
  if (
    marketKey.includes('shots on goal') ||
    marketKey.includes('shots_on_goal') ||
    marketKey.includes('sog')
  ) {
    return 'Shots on Goal';
  }
  if (marketKey.includes('saves')) {
    return 'Saves';
  }
  if (marketKey.includes('goals')) {
    return 'Goals';
  }
  if (marketKey.includes('blocked shots') || marketKey.includes('blocked_shots')) {
    return 'Blocked Shots';
  }
  if (marketKey.includes('passing yards') || marketKey.includes('passing_yards')) {
    return 'Passing Yards';
  }
  if (marketKey.includes('passing touchdowns') || marketKey.includes('passing_touchdowns') || marketKey.includes('pass_tds')) {
    return 'Passing Touchdowns';
  }
  if (marketKey.includes('passing attempts') || marketKey.includes('passing_attempts') || marketKey.includes('pass_attempts')) {
    return 'Passing Attempts';
  }
  if (marketKey.includes('rushing yards') || marketKey.includes('rushing_yards')) {
    return 'Rushing Yards';
  }
  if (marketKey.includes('rushing attempts') || marketKey.includes('rushing_attempts') || marketKey.includes('rush_attempts')) {
    return 'Rushing Attempts';
  }
  if (
    marketKey.includes('rush + rec') ||
    marketKey.includes('rush_rec') ||
    marketKey.includes('rushing + receiving')
  ) {
    return 'Rush + Rec Yards';
  }
  if (marketKey.includes('receiving yards') || marketKey.includes('receiving_yards')) {
    return 'Receiving Yards';
  }
  if (marketKey.includes('receptions')) {
    return 'Receptions';
  }
  if (marketKey.includes('interceptions')) {
    return 'Interceptions';
  }
  if (marketKey.includes('touchdowns')) {
    return 'Touchdowns';
  }
  if (marketKey.includes('tackles')) {
    return 'Tackles';
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
  const market = resolveSubmissionMarketKey(values, context);
  const selection = buildSelectionString(values);
  const trustScore = values.capperConviction * 10;

  const manualOverrideFields = context.manualOverrideFields ?? [];
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
      participantId: context.playerId ?? null,
      statType: values.statType,
      overUnder: values.direction,
      team: values.team,
      teamId: context.teamId ?? null,
      eventName: values.eventName,
      eventId: context.eventId ?? null,
      leagueId: context.leagueId ?? null,
      marketTypeId: context.canonicalMarketTypeId ?? null,
      submissionMode: context.submissionMode ?? 'manual',
      manualEntry: manualOverrideFields.length > 0,
      manualOverrideFields,
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

function resolveSubmissionMarketKey(
  values: BetFormValues,
  context: SubmissionContext,
) {
  if (context.canonicalMarketTypeId) {
    return context.canonicalMarketTypeId;
  }

  if (values.marketType === 'moneyline') {
    return 'moneyline';
  }
  if (values.marketType === 'spread') {
    return 'spread';
  }
  if (values.marketType === 'total') {
    return 'game_total_ou';
  }
  if (values.marketType === 'team-total') {
    return 'team_total_ou';
  }

  const statType = (values.statType ?? '').trim().toLowerCase();
  const statDrivenMarketKey = STAT_TYPE_TO_SUBMISSION_MARKET_KEY[statType];
  if (statDrivenMarketKey) {
    return statDrivenMarketKey;
  }

  const marketLabel = MARKET_TYPE_LABELS[values.marketType];
  return `${values.sport} - ${marketLabel}`;
}

const STAT_TYPE_TO_SUBMISSION_MARKET_KEY: Record<string, string> = {
  points: 'player.points',
  rebounds: 'player.rebounds',
  assists: 'player.assists',
  threes: 'player.threes',
  steals: 'player.steals',
  blocks: 'player.blocks',
  turnovers: 'player.turnovers',
  'points + rebounds + assists': 'player.pra',
  'points + rebounds': 'player.points_rebounds',
  'points + assists': 'player.points_assists',
  'rebounds + assists': 'player.rebounds_assists',
  hits: 'player.hits',
  'home runs': 'player.home_runs',
  rbi: 'player.rbi',
  walks: 'player.walks',
  'total bases': 'player.total_bases',
  'pitching strikeouts': 'player.pitching_strikeouts',
  'pitching innings pitched': 'player.pitching_innings_pitched',
};
