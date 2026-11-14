/** Pure, fail-closed interpretation of the documented Odds API /scores shape. */
export type ScoresLeague = 'NFL' | 'NBA' | 'NHL' | 'MLB';
export const SCORES_SPORT_KEYS: Readonly<Record<ScoresLeague, string>> = {
  NFL: 'americanfootball_nfl', NBA: 'basketball_nba', NHL: 'icehockey_nhl', MLB: 'baseball_mlb',
};
export interface ScoresEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{ name: string; score: string }> | null;
  last_update: string | null;
}
export type ParsedScore =
  | { status: 'final'; eventId: string; event: ScoresEvent; homeTeam: string; awayTeam: string;
      homeScore: number; awayScore: number; commenceTime: string; lastUpdate: string; sportKey: string }
  | { status: 'not_final'; eventId: string; event: ScoresEvent; reason: string }
  | { status: 'rejected'; eventId: string | null; event: unknown; reason: string };

export function parseOddsApiScores(raw: unknown, league: ScoresLeague, now: Date): ParsedScore[] {
  if (!Array.isArray(raw)) throw new Error('Scores payload must be an array');
  return raw.map((input: unknown): ParsedScore => {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const eventId = typeof value.id === 'string' ? value.id : null;
    const rejected = (reason: string): ParsedScore => ({ status: 'rejected', eventId, event: input, reason });
    if (!eventId || eventId.length !== 32) return rejected('invalid_event_id');
    if (value.sport_key !== SCORES_SPORT_KEYS[league]) return rejected('sport_key_mismatch');
    if (typeof value.home_team !== 'string' || !value.home_team ||
        typeof value.away_team !== 'string' || !value.away_team || value.home_team === value.away_team)
      return rejected('invalid_teams');
    if (typeof value.commence_time !== 'string' || !Number.isFinite(Date.parse(value.commence_time)))
      return rejected('invalid_commence_time');
    if (typeof value.completed !== 'boolean') return rejected('invalid_completed');
    const event = input as ScoresEvent;
    const pending = (reason: string): ParsedScore => ({ status: 'not_final', eventId, event, reason });
    if (!event.completed) return pending('not_completed');
    if (!Array.isArray(event.scores) || event.scores.length !== 2) return rejected('invalid_scores');
    const scores: unknown[] = event.scores;
    if (!scores.every((s) => s !== null && typeof s === 'object')) return rejected('invalid_scores');
    const home = event.scores.filter((s) => s.name === event.home_team);
    const away = event.scores.filter((s) => s.name === event.away_team);
    if (home.length !== 1 || away.length !== 1) return rejected('score_name_mismatch');
    const homeText = home[0]!.score, awayText = away[0]!.score;
    if (typeof homeText !== 'string' || typeof awayText !== 'string' ||
        !/^\d+$/.test(homeText) || !/^\d+$/.test(awayText)) return rejected('invalid_score');
    const homeScore = Number(homeText), awayScore = Number(awayText);
    if (!Number.isSafeInteger(homeScore) || !Number.isSafeInteger(awayScore)) return rejected('invalid_score');
    if (homeScore === awayScore && league !== 'NFL') return rejected('tie_not_possible');
    const update = typeof event.last_update === 'string' ? Date.parse(event.last_update) : NaN;
    if (!Number.isFinite(update) || update <= Date.parse(event.commence_time) ||
        !Number.isFinite(now.getTime()) || update > now.getTime()) return pending('invalid_last_update');
    if (now.getTime() - update < 15 * 60_000) return pending('settle_delay');
    return { status: 'final', eventId, event, homeTeam: event.home_team, awayTeam: event.away_team,
      homeScore, awayScore, commenceTime: event.commence_time, lastUpdate: event.last_update!, sportKey: event.sport_key };
  });
}
