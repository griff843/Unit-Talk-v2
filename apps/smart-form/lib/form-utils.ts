import type { CatalogData } from './catalog';
import type { EventOfferBrowseResult } from './api-client';
import type { BetFormValues } from './form-schema';
import type { SubmitPickPayload } from './api-client';
import type {
  SmartFormDistributionMode,
  SmartFormParticipantResolution,
} from '@unit-talk/contracts';
import {
  getMarketTypeFamily,
  getSupportedMarketTypesForSport,
  isMarketTypeId,
  type MarketTypeId,
} from './market-types';

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
  distributionMode?: SmartFormDistributionMode;
  participantResolution?: SmartFormParticipantResolution;
}

export function getMarketTypesForSport(
  catalog: CatalogData,
  sportId: string,
): MarketTypeId[] {
  const sport = catalog.sports.find((s) => s.id === sportId);
  return getSupportedMarketTypesForSport(sportId, sport?.marketTypes ?? []);
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
  const marketFamily = getMarketTypeFamily(marketType);

  if (marketFamily === 'player-prop') {
    const dirLabel = direction === 'over' ? 'O' : direction === 'under' ? 'U' : '';
    const parts = [playerName, statType, dirLabel, line !== undefined ? String(line) : ''];
    return parts.filter(Boolean).join(' ');
  }

  if (marketFamily === 'moneyline') {
    return team ?? '';
  }

  if (marketFamily === 'spread') {
    const parts = [team, line !== undefined ? (line > 0 ? `+${line}` : String(line)) : ''];
    return parts.filter(Boolean).join(' ');
  }

  if (marketFamily === 'team-total') {
    const dirLabel = direction === 'over' ? 'Over' : direction === 'under' ? 'Under' : '';
    const parts = [team, dirLabel, line !== undefined ? String(line) : ''];
    return parts.filter(Boolean).join(' ');
  }

  if (marketFamily === 'total') {
    const dirLabel = values.direction === 'over' ? 'O' : values.direction === 'under' ? 'U' : '';
    return [dirLabel, line !== undefined ? String(line) : ''].filter(Boolean).join(' ');
  }

  return '';
}

export function mapOfferToFormMarketType(offer: Pick<EventOfferBrowseResult, 'marketTypeId' | 'participantId' | 'providerParticipantId'>): MarketTypeId {
  const marketTypeId = offer.marketTypeId?.toLowerCase() ?? '';
  if (isMarketTypeId(marketTypeId)) {
    return marketTypeId;
  }
  if (marketTypeId === 'moneyline') {
    return 'moneyline';
  }
  if (marketTypeId.includes('spread')) {
    return 'spread';
  }
  if (marketTypeId.includes('team-total') || marketTypeId.includes('team_total')) {
    return 'team-total';
  }
  // Market type IDs starting with "player_" or "player." are player props regardless
  // of whether a canonical entity alias exists (providerParticipantId may be set but
  // participantId is null when provider_entity_aliases has no row for the player).
  if (marketTypeId.startsWith('player_') || marketTypeId.startsWith('player.')) {
    return 'player-prop';
  }
  if (offer.participantId || offer.providerParticipantId) {
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

  // UTV2-1379: capperConviction=10 maps to confidence=1.0 exactly, which fails
  // the strict confidence<1 guard downstream (domain-analysis-service.ts,
  // submission-service.ts) and silently skips domainAnalysis entirely for
  // max-conviction picks. Cap at 0.99 — the capper's displayed conviction
  // stays 10/10 (capperConviction field, unchanged); only the internal
  // probability-like confidence value is capped below 1.0. No fake certainty:
  // 0.99 is still an honest "very high but not absolute" probability, not a
  // rounding trick.
  const confidence = values.capperConviction >= 10 ? 0.99 : values.capperConviction / 10;

  const manualOverrideFields = context.manualOverrideFields ?? [];
  return {
    source: 'smart-form',
    submittedBy: values.capper,
    market,
    selection,
    line: values.line,
    odds: values.odds,
    stakeUnits: values.units,
    confidence,
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
      distributionMode: context.distributionMode ?? (values.trackOnly ? 'track-only' : 'delivery-eligible'),
      participantResolution: context.participantResolution ?? {
        resolution: 'manual',
        sportId: values.sport,
        eventId: null,
        manualOverride: true,
        reason: 'canonical-coverage-gap',
        enteredEventName: values.eventName,
        enteredParticipants: [
          values.team ? { role: 'team' as const, displayName: values.team, canonicalParticipantId: null } : null,
          values.playerName ? { role: 'player' as const, displayName: values.playerName, canonicalParticipantId: null } : null,
        ].filter((value): value is NonNullable<typeof value> => value !== null),
      },
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
      // UTV2-1379: explicit provenance — this confidence value is a linear
      // mapping of the capper's self-reported conviction (1-10), not a
      // market-derived or implicitly-inferred value.
      confidenceSource: 'capper-conviction',
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

  const marketFamily = getMarketTypeFamily(values.marketType);
  if (isMarketTypeId(values.marketType) && values.marketType.includes('_')) {
    return values.marketType;
  }

  if (marketFamily === 'moneyline') {
    return 'moneyline';
  }
  if (marketFamily === 'spread') {
    return 'spread';
  }
  if (marketFamily === 'total') {
    return 'game_total_ou';
  }
  if (marketFamily === 'team-total') {
    return 'team_total_ou';
  }

  const statType = (values.statType ?? '').trim().toLowerCase();
  const statDrivenMarketKey = STAT_TYPE_TO_SUBMISSION_MARKET_KEY[statType];
  if (statDrivenMarketKey) {
    return statDrivenMarketKey;
  }

  throw new Error(
    `Cannot resolve canonical market key: sport=${values.sport}, marketType=${values.marketType}, statType=${values.statType ?? 'none'}. Add this combination to STAT_TYPE_TO_SUBMISSION_MARKET_KEY.`,
  );
}

const STAT_TYPE_TO_SUBMISSION_MARKET_KEY: Record<string, string> = {
  // NBA / basketball
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
  // MLB / baseball
  hits: 'player.hits',
  'home runs': 'player.home_runs',
  rbi: 'player.rbi',
  walks: 'player.walks',
  'total bases': 'player.total_bases',
  singles: 'player.singles',
  doubles: 'player.doubles',
  triples: 'player.triples',
  'hits + runs + rbis': 'player.hits_runs_rbis',
  'earned runs': 'player.earned_runs',
  'hits allowed': 'player.hits_allowed',
  'pitcher outs': 'player.pitcher_outs',
  'pitching strikeouts': 'player.pitching_strikeouts',
  'pitching innings pitched': 'player.pitching_innings_pitched',
  strikeouts: 'player.strikeouts',
  // NHL / hockey
  goals: 'player.goals',
  'shots on goal': 'player.shots',
  'blocked shots': 'player.blocked_shots',
  saves: 'player.saves',
  'penalty minutes': 'player.pim',
  // NFL / football
  'passing yards': 'player.passing_yards',
  'passing touchdowns': 'player.passing_touchdowns',
  'passing attempts': 'player.passing_attempts',
  'rushing yards': 'player.rushing_yards',
  'rushing attempts': 'player.rushing_attempts',
  'rush + rec yards': 'player.rush_rec_yards',
  'receiving yards': 'player.receiving_yards',
  receptions: 'player.receptions',
  touchdowns: 'player.touchdowns',
  tackles: 'player.tackles',
  interceptions: 'player.interceptions',
};

// UTV2-1786 SUBMISSION_GUARD_START
//
// The API's Smart Form contract (`apps/api/src/smart-form-validation.ts`)
// refuses several payload shapes this form was happy to build. Each refusal
// below mirrors a specific server rule, so an operator is stopped in the UI
// with an actionable message instead of getting a 400 after the fact.
//
// These live here, as pure functions over form state, so they can be executed
// in the unit suite. `BetForm` calls them; it does not restate the rules.

/**
 * Mirror of `TEAM_SPORTS` in `apps/api/src/smart-form-validation.ts:9`.
 *
 * It cannot be imported: `apps` never import from `apps`, and the list is not
 * in a shared package. `submissionGuardsMatchServerTeamSports` in the unit
 * suite pins this copy so a server-side change to the list fails here rather
 * than silently splitting client and server behaviour.
 */
export const CLIENT_TEAM_SPORT_IDS: ReadonlySet<string> = new Set([
  'NFL',
  'NCAAF',
  'NBA',
  'NCAAB',
  'MLB',
  'NHL',
  'SOCCER',
]);

export function isTeamSportId(sportId: string | null | undefined): boolean {
  return CLIENT_TEAM_SPORT_IDS.has((sportId ?? '').trim().toUpperCase());
}

/**
 * Client-side approximation of the server's `aliasKey`: NFKD-fold, drop
 * diacritics, lower-case, then keep only `[a-z0-9]`.
 *
 * The server additionally maps Cyrillic and Greek look-alikes back to ASCII
 * (`foldConfusables`), which this copy does not do. The consequence is
 * one-directional and worth stating precisely, because the obvious guess about
 * it is wrong: the server's non-ASCII refusal is `hasNonAscii(foldConfusables(
 * name))`, so a look-alike that IS in the confusable table folds to ASCII and
 * passes that check rather than being refused by it. What actually catches the
 * duplicate is `aliasKey`, which folds as well.
 *
 * So a manual entry spelling one side with a Cyrillic look-alike is still
 * refused — by the server, fail-closed — but this client does not collapse the
 * pair and will not stop it first. The cost is a raw 400 instead of the
 * pre-submit toast; there is no path where the client admits something the
 * server accepts. The reverse direction cannot happen: dropping an unmapped
 * character removes it rather than mapping two distinct names onto one key.
 */
export function participantAliasKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, '');
}

export type ManualParticipantRole = 'away' | 'home' | 'team' | 'player';

export interface ManualEnteredParticipant {
  role: ManualParticipantRole;
  displayName: string;
  canonicalParticipantId: null;
}

export interface ManualParticipantNames {
  awayParticipantName?: string | null;
  homeParticipantName?: string | null;
  team?: string | null;
  playerName?: string | null;
}

/**
 * Build manual provenance from *distinct* entered names.
 *
 * `values.team` normally repeats whichever side the operator bet, so appending
 * it unconditionally emitted the same display name under two roles — which
 * `validateManualResolution` rejects outright ("manual participants must be
 * distinct"). The market side is already carried by the payload's own
 * `selection`/`team` fields, so dropping the duplicate provenance entry loses
 * no information the server needs.
 *
 * Order is away, home, team, player: the first occurrence of a name keeps its
 * role, matching the server's first-wins `seen` map.
 */
export function buildManualEnteredParticipants(
  values: ManualParticipantNames,
): ManualEnteredParticipant[] {
  const candidates: Array<{ role: ManualParticipantRole; displayName: string | null | undefined }> = [
    { role: 'away', displayName: values.awayParticipantName },
    { role: 'home', displayName: values.homeParticipantName },
    { role: 'team', displayName: values.team },
    { role: 'player', displayName: values.playerName },
  ];

  const seen = new Set<string>();
  const participants: ManualEnteredParticipant[] = [];
  for (const candidate of candidates) {
    const displayName = candidate.displayName?.trim();
    if (!displayName) continue;
    const key = participantAliasKey(displayName);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    participants.push({ role: candidate.role, displayName, canonicalParticipantId: null });
  }
  return participants;
}

export interface SubmissionGuardFailure {
  code:
    | 'manual-team-sport-requires-both-sides'
    | 'manual-requires-a-participant'
    | 'canonical-requires-event'
    | 'canonical-player-requires-event'
    | 'canonical-without-event-requires-team-sport';
  title: string;
  description: string;
}

export type SmartFormIdentityMode = 'canonical' | 'structured-fallback' | 'manual';

export interface SubmissionGuardInput {
  sportId: string;
  identityMode: SmartFormIdentityMode;
  awayParticipantName?: string | null;
  homeParticipantName?: string | null;
  team?: string | null;
  playerName?: string | null;
  /** The canonical event backing this submission, or null when none is selected. */
  canonicalEventId?: string | null;
  /** A canonical player participant id, set only when one was chosen from search. */
  selectedPlayerId?: string | null;
}

/**
 * Returns the first server rule this submission would violate, or null when the
 * payload shape is acceptable. Each branch cites the rule it mirrors.
 */
export function evaluateSubmissionGuards(
  input: SubmissionGuardInput,
): SubmissionGuardFailure | null {
  const teamSport = isTeamSportId(input.sportId);

  if (input.identityMode === 'manual') {
    const participants = buildManualEnteredParticipants(input);

    // smart-form-validation.ts:126 — at least one entered participant.
    if (participants.length === 0) {
      return {
        code: 'manual-requires-a-participant',
        title: 'Enter the matchup participants',
        description:
          'A manual override must name the participants it is standing in for.',
      };
    }

    // smart-form-validation.ts:129 — team sports need both sides, counted
    // after the duplicate rule, because two entries with the same name collapse
    // to one and would be refused as a duplicate rather than accepted as two.
    if (teamSport && participants.length < 2) {
      return {
        code: 'manual-team-sport-requires-both-sides',
        title: 'Enter both sides of the matchup',
        description:
          'A manual team-sport override must name two distinct participants: enter both the away and the home side.',
      };
    }

    return null;
  }

  if (input.identityMode === 'canonical') {
    if (input.canonicalEventId) {
      return null;
    }

    return {
      code: 'canonical-requires-event',
      title: 'Select a canonical matchup',
      description: 'Canonical mode requires a matchup selected from the browse results.',
    };
  }

  if (input.canonicalEventId) {
    return null;
  }

  // smart-form-validation.ts:203 — `validateStructuredTeamFallback` refuses any
  // canonical player selection without a canonical event, because team
  // membership cannot be verified.
  if (input.selectedPlayerId) {
    return {
      code: 'canonical-player-requires-event',
      title: 'Select a canonical matchup',
      description:
        'A canonical player prop needs the matchup it belongs to. Select a matchup, or use the verified coverage-gap path.',
    };
  }

  // smart-form-validation.ts:70 — outside team sports there is no structured
  // fallback at all, so a canonical resolution without an event is refused.
  if (!teamSport) {
    return {
      code: 'canonical-without-event-requires-team-sport',
      title: 'Select a canonical matchup',
      description:
        'This sport has no structured fallback. Select a matchup, or use the verified coverage-gap path.',
    };
  }

  return null;
}
// UTV2-1786 SUBMISSION_GUARD_END
