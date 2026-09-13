export interface MatchupTeamChoice {
  key: string;
  label: string;
  participantId: string | null;
  role: 'away' | 'home';
}

/** Use existing side identities only; a display name never creates a canonical ID. */
export function deriveMatchupTeamChoices(input: {
  manualIdentity: boolean;
  awayName?: string;
  homeName?: string;
  awayId: string | null;
  homeId: string | null;
}): MatchupTeamChoice[] {
  const away = input.awayName?.trim() ?? '';
  const home = input.homeName?.trim() ?? '';
  if (!away || !home || away.toLocaleLowerCase() === home.toLocaleLowerCase()) return [];
  if (!input.manualIdentity && (!input.awayId || !input.homeId || input.awayId === input.homeId)) return [];
  return [
    { key: 'away', label: away, participantId: input.manualIdentity ? null : input.awayId, role: 'away' },
    { key: 'home', label: home, participantId: input.manualIdentity ? null : input.homeId, role: 'home' },
  ];
}

/** QA cannot infer who an anonymous visitor is. Production auth remains separate. */
export function isMissingQaIdentity(qaEnabled: boolean, capperId?: string | null): boolean {
  return qaEnabled && !capperId?.trim();
}
